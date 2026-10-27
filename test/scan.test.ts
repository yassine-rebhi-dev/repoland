import { describe, expect, it } from "vitest";
import { MemoryRepo } from "../src/repo.js";
import { scan } from "../src/scan.js";
import { parseScene } from "../src/scene.js";

const pkg = (o: object) => JSON.stringify(o);
const kinds = (s: ReturnType<typeof scan>) => Object.fromEntries(s.nodes.map((n) => [n.id, n.kind]));
const edges = (s: ReturnType<typeof scan>) => s.edges.map((e) => `${e.from}->${e.to}`).sort();

describe("scan: docker compose", () => {
  const repo = new MemoryRepo("shop", {
    "docker-compose.yml": `
services:
  web:
    build: ./web
    ports: ["3000:3000"]
    depends_on:
      - api
  api:
    build:
      context: ./api
    depends_on: [db, cache]
  worker:
    build: ./api
    command: node worker.js
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started
  db:
    image: postgres:16-alpine
  cache:
    image: redis:7
volumes:
  data: {}
`,
    "web/package.json": pkg({ name: "web", dependencies: { next: "15" } }),
    "api/package.json": pkg({ name: "api", dependencies: { fastify: "5" } }),
  });
  const s = scan(repo);
  it("turns services into typed buildings", () => {
    expect(kinds(s)).toMatchObject({ web: "frontend", api: "service", worker: "worker", db: "database", cache: "cache" });
  });
  it("turns depends_on (list, flow list and map forms) into pipes", () => {
    expect(edges(s)).toEqual(expect.arrayContaining(["api->cache", "api->db", "web->api", "worker->cache", "worker->db"]));
  });
  it("records build contexts as owned paths and images as notes", () => {
    const n = Object.fromEntries(s.nodes.map((x) => [x.id, x]));
    expect(n.api!.paths).toEqual(["api/**"]);
    expect(n.db!.note).toBe("postgres:16-alpine");
  });
  it("produces a valid scene", () => expect(() => parseScene(s)).not.toThrow());
});

describe("scan: pnpm monorepo with infrastructure dependencies", () => {
  const repo = new MemoryRepo("acme", {
    "package.json": pkg({ name: "acme", description: "Acme commerce platform" }),
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n  - \"packages/*\"\n",
    "apps/web/package.json": pkg({ name: "@acme/web", dependencies: { next: "15", "@acme/ui": "workspace:*" } }),
    "apps/api/package.json": pkg({ name: "@acme/api", dependencies: { fastify: "5", pg: "8", bullmq: "5", stripe: "17", "@acme/db": "workspace:*" } }),
    "packages/ui/package.json": pkg({ name: "@acme/ui", dependencies: { react: "19" } }),
    "packages/db/package.json": pkg({ name: "@acme/db", dependencies: { pg: "8" } }),
    "packages/cli/package.json": pkg({ name: "@acme/cli", bin: { acme: "bin.js" } }),
  });
  const s = scan(repo);
  it("finds workspace packages with sensible kinds", () => {
    expect(kinds(s)).toMatchObject({ web: "frontend", api: "service", ui: "library", db: "library", cli: "cli" });
  });
  it("adds infrastructure implied by dependencies, once each", () => {
    const k = kinds(s);
    expect(k.postgres).toBe("database");
    expect(k.queue).toBe("queue");
    expect(k.stripe).toBe("external");
    expect(s.nodes.filter((n) => n.label === "Postgres")).toHaveLength(1);
  });
  it("wires workspace and infrastructure dependencies", () => {
    expect(edges(s)).toEqual(expect.arrayContaining(["web->ui", "api->db", "api->postgres", "api->queue", "api->stripe", "db->postgres", "users->web"]));
  });
  it("uses the root package for the title and subtitle", () => {
    expect(s.title).toBe("acme");
    expect(s.subtitle).toBe("Acme commerce platform");
  });
});

describe("scan: cargo, go and python", () => {
  it("cargo workspace members and path dependencies", () => {
    const s = scan(new MemoryRepo("rs", {
      "Cargo.toml": '[workspace]\nmembers = ["crates/*"]\n',
      "crates/cli/Cargo.toml": '[package]\nname = "tool-cli"\n[dependencies]\ncore = { path = "../core" }\nserde = "1"\n',
      "crates/cli/src/main.rs": "fn main() {}",
      "crates/core/Cargo.toml": '[package]\nname = "tool-core"\n',
      "crates/core/src/lib.rs": "",
    }));
    expect(kinds(s)).toMatchObject({ cli: "cli", core: "library" });
    expect(edges(s)).toContain("cli->core");
  });
  it("go cmd/ entry points: servers vs CLIs", () => {
    const s = scan(new MemoryRepo("svc", {
      "go.mod": "module example.com/svc\n",
      "cmd/server/main.go": "package main\nfunc main(){ http.ListenAndServe(\":8080\", nil) }",
      "cmd/migrate/main.go": "package main\nfunc main(){}",
    }));
    expect(kinds(s)).toMatchObject({ server: "service", migrate: "cli" });
  });
  it("python project with web framework, database, cache and workers", () => {
    const s = scan(new MemoryRepo("pyapp", {
      "pyproject.toml": '[project]\nname = "pyapp"\ndependencies = ["fastapi>=0.110", "sqlalchemy", "psycopg[binary]", "redis", "celery"]\n',
    }));
    expect(kinds(s)).toMatchObject({ pyapp: "service", postgres: "database", redis: "cache", celery: "worker" });
    expect(edges(s)).toEqual(expect.arrayContaining(["pyapp->postgres", "pyapp->redis", "pyapp->celery"]));
  });
  it("an empty repo still yields a valid one-node scene", () => {
    const s = scan(new MemoryRepo("empty", { "README.md": "# hi" }));
    expect(s.nodes).toHaveLength(1);
    expect(() => parseScene(s)).not.toThrow();
  });
});

describe("tomlArray", () => {
  it("is not fooled by brackets inside quoted extras", async () => {
    const { tomlArray } = await import("../src/scan.js");
    expect(tomlArray('dependencies = [\n  "psycopg[binary]>=3",\n  "redis",\n]\nother = ["x"]', "dependencies")).toEqual(["psycopg[binary]>=3", "redis"]);
  });
});

describe("scan: real-world regressions (immich, n8n, documenso, uv)", () => {
  it("prefers the deployment compose file over e2e/test ones", () => {
    const s = scan(new MemoryRepo("immich", {
      "e2e/docker-compose.yml": "services:\n  e2e-auth-server:\n    build: ./auth\n",
      "docker/docker-compose.yml": "services:\n  immich-server:\n    image: ghcr.io/immich-app/immich-server:release\n  immich-machine-learning:\n    image: ghcr.io/immich-app/immich-machine-learning:release\n",
    }));
    expect(s.nodes.map((n) => n.id)).toContain("immich-machine-learning");
    expect(s.nodes.map((n) => n.id)).not.toContain("e2e-auth-server");
  });
  it("merges an image-only compose service with the package whose folder it names", () => {
    const s = scan(new MemoryRepo("immich", {
      "docker/docker-compose.yml": "services:\n  immich-server:\n    image: ghcr.io/immich-app/immich-server:release\n    depends_on: [redis]\n  redis:\n    image: valkey/valkey:9\n",
      "package.json": pkg({ workspaces: ["server", "web"] }),
      "server/package.json": pkg({ name: "immich", dependencies: { "@nestjs/core": "11", ioredis: "5" } }),
    }));
    const server = s.nodes.find((n) => n.id === "immich-server")!;
    expect(server.paths).toEqual(["server/**"]);
    expect(s.nodes.some((n) => n.id === "immich")).toBe(false);
    expect(s.edges.filter((e) => e.from === "immich-server" && e.to === "redis")).toHaveLength(1);
  });
  it("leaves out tooling packages (e2e, docs, configs, storybook, test utils)", () => {
    const files: Record<string, string> = { "package.json": pkg({ workspaces: ["packages/*", "apps/*"] }) };
    for (const n of ["e2e", "docs", "tsconfig", "eslint-config", "tailwind-config", "storybook", "test-utils", "playwright-janitor", "scripts"])
      files[`packages/${n}/package.json`] = pkg({ name: `@x/${n}` });
    files["apps/api/package.json"] = pkg({ name: "@x/api", dependencies: { express: "4" } });
    expect(scan(new MemoryRepo("x", files)).nodes.map((n) => n.id)).toEqual(["api"]);
  });
  it("UI component libraries are libraries, not frontends; apps with a framework or index.html are frontends", () => {
    const s = scan(new MemoryRepo("x", {
      "package.json": pkg({ workspaces: ["packages/*"] }),
      "packages/design-system/package.json": pkg({ name: "design-system", dependencies: { vue: "3" }, devDependencies: { vite: "5" } }),
      "packages/editor-ui/package.json": pkg({ name: "editor-ui", dependencies: { vue: "3" }, devDependencies: { vite: "5" } }),
      "packages/editor-ui/index.html": "<div id=app></div>",
    }));
    expect(kinds(s)).toMatchObject({ "design-system": "library", "editor-ui": "frontend" });
  });
  it("devDependencies don't create pipes or infrastructure", () => {
    const s = scan(new MemoryRepo("x", {
      "package.json": pkg({ workspaces: ["packages/*"] }),
      "packages/a/package.json": pkg({ name: "a", dependencies: { express: "4" }, devDependencies: { b: "*", pg: "8" } }),
      "packages/b/package.json": pkg({ name: "b" }),
    }));
    expect(s.edges).toEqual([]);
    expect(s.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });
  it("cargo `workspace = true` dependencies resolve through [workspace.dependencies]", () => {
    const s = scan(new MemoryRepo("rs", {
      "Cargo.toml": '[workspace]\nmembers = ["crates/*"]\n[workspace.dependencies]\nuv-client = { path = "crates/uv-client" }\n',
      "crates/uv/Cargo.toml": '[package]\nname = "uv"\n[dependencies]\nuv-client = { workspace = true }\n',
      "crates/uv/src/main.rs": "",
      "crates/uv-client/Cargo.toml": '[package]\nname = "uv-client"\n',
    }));
    expect(edges(s)).toContain("uv->uv-client");
  });
  it("keeps big repos readable: at most 16 parts by default, hubs first", () => {
    const files: Record<string, string> = { "Cargo.toml": '[workspace]\nmembers = ["crates/*"]\n' };
    for (let i = 0; i < 40; i++) files[`crates/c${i}/Cargo.toml`] = `[package]\nname = "c${i}"\n[dependencies]\n${i ? 'c0 = { path = "../c0" }' : ""}\n`;
    const s = scan(new MemoryRepo("big", files));
    expect(s.nodes.length).toBe(16);
    expect(s.nodes.map((n) => n.id)).toContain("c0");
    expect(scan(new MemoryRepo("big", files), { maxParts: 30 }).nodes.length).toBe(30);
  });
});

describe("scan: second round of real-world regressions", () => {
  it("normalises '..' in compose build contexts and merges with the package there", () => {
    const s = scan(new MemoryRepo("immich", {
      "docker/docker-compose.yml": "services:\n  immich-server:\n    build:\n      context: ../server\n",
      "package.json": pkg({ workspaces: ["server"] }),
      "server/package.json": pkg({ name: "immich", dependencies: { "@nestjs/core": "11" } }),
    }));
    expect(s.nodes.filter((n) => n.kind !== "user").map((n) => [n.id, n.paths[0]])).toEqual([["immich-server", "server/**"]]);
  });
  it("classifies compose services by name when the image tag is a variable", () => {
    const s = scan(new MemoryRepo("x", {
      "docker-compose.yml": "services:\n  postgres:\n    image: ${PG_IMAGE}\n  app:\n    build: ./app\n    depends_on: [postgres]\n",
      "app/package.json": pkg({ name: "app", dependencies: { express: "4", pg: "8" } }),
    }));
    expect(kinds(s).postgres).toBe("database");
    expect(s.nodes.filter((n) => n.kind === "database")).toHaveLength(1);
  });
  it("a package with a bin AND a server framework is a service", () => {
    const s = scan(new MemoryRepo("n8n", {
      "package.json": pkg({ workspaces: ["packages/*"] }),
      "packages/cli/package.json": pkg({ name: "n8n", bin: { n8n: "bin/n8n" }, dependencies: { express: "5" } }),
    }));
    expect(kinds(s).n8n).toBe("service");
  });
  it("a maturin pyproject (Python packaging for a Rust binary) adds no Python node", () => {
    const s = scan(new MemoryRepo("uv", {
      "pyproject.toml": '[project]\nname = "uv"\n[build-system]\nbuild-backend = "maturin"\n',
      "Cargo.toml": '[package]\nname = "uv"\n',
      "src/main.rs": "",
    }));
    expect(s.nodes.map((n) => n.id)).toEqual(["uv"]);
  });
  it("production compose beats a development one", async () => {
    const { pickCompose } = await import("../src/scan.js");
    expect(pickCompose(["docker/development/compose.yml", "docker/production/compose.yml"])).toBe("docker/production/compose.yml");
  });
  it("the cap keeps hubs over leaf CLIs and drops -dev tooling", () => {
    const files: Record<string, string> = { "Cargo.toml": '[workspace]\nmembers = ["crates/*"]\n' };
    for (let i = 0; i < 20; i++) files[`crates/lib${i}/Cargo.toml`] = `[package]\nname = "lib${i}"\n[dependencies]\n${i ? 'lib0 = { path = "../lib0" }' : ""}\n`;
    for (const c of ["tool-a", "tool-b", "x-dev"]) {
      files[`crates/${c}/Cargo.toml`] = `[package]\nname = "${c}"\n`;
      files[`crates/${c}/src/main.rs`] = "";
    }
    const ids = scan(new MemoryRepo("big", files)).nodes.map((n) => n.id);
    expect(ids).toContain("lib0");
    expect(ids).not.toContain("x-dev");
    expect(ids).not.toContain("tool-a");
  });
});

describe("scan: queues backed by redis", () => {
  it("a bull/bullmq job queue pipes into Redis when Redis is on the map", () => {
    const s = scan(new MemoryRepo("x", {
      "package.json": pkg({ name: "x", dependencies: { express: "4", bullmq: "5", ioredis: "5" } }),
    }));
    expect(edges(s)).toContain("queue->redis");
  });
});
