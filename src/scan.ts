/**
 * Draft a scene from what the repo already declares: docker-compose services, JS workspaces, Cargo workspaces,
 * Go cmd/ entry points, and infrastructure implied by dependencies. No LLM, no network. The result is a starting
 * point for an agent (or a human) to refine, and the baseline for drift checks.
 */
import { globToRegExp } from "./glob.js";
import type { Repo } from "./repo.js";
import { type Kind, MAX_NODES, type Scene, type SceneEdge, type SceneNode } from "./scene.js";

type Eco = "js" | "py" | "go";

interface Infra {
  id: string;
  label: string;
  kind: Kind;
  /** dependency names (exact, or prefix when ending with "*") per ecosystem */
  deps: Partial<Record<Eco, string[]>>;
  /** substrings of a compose image that mean "this is the same thing" */
  images?: string[];
  /** only add when no more specific node of the same family exists */
  fallback?: string;
  edge?: string;
}

const INFRA: Infra[] = [
  { id: "postgres", label: "Postgres", kind: "database", edge: "SQL", images: ["postgres", "postgis", "pgvector", "timescale"],
    deps: { js: ["pg", "postgres", "pg-promise", "@neondatabase/serverless", "@vercel/postgres"], py: ["psycopg", "psycopg2", "psycopg2-binary", "asyncpg"], go: ["github.com/jackc/pgx*", "github.com/lib/pq"] } },
  { id: "mysql", label: "MySQL", kind: "database", edge: "SQL", images: ["mysql", "mariadb"],
    deps: { js: ["mysql2", "mysql"], py: ["pymysql", "mysqlclient"], go: ["github.com/go-sql-driver/mysql"] } },
  { id: "mongodb", label: "MongoDB", kind: "database", images: ["mongo"], deps: { js: ["mongodb", "mongoose"], py: ["pymongo", "motor"], go: ["go.mongodb.org/mongo-driver*"] } },
  { id: "database", label: "Database", kind: "database", fallback: "database",
    deps: { js: ["@prisma/client", "prisma", "drizzle-orm", "typeorm", "sequelize", "knex", "kysely", "@mikro-orm/core"], py: ["sqlalchemy", "sqlmodel", "tortoise-orm"], go: ["gorm.io/gorm", "entgo.io/ent"] } },
  { id: "redis", label: "Redis", kind: "cache", images: ["redis", "valkey", "keydb", "dragonfly"],
    deps: { js: ["redis", "ioredis", "@upstash/redis"], py: ["redis"], go: ["github.com/redis/go-redis*", "github.com/go-redis/redis*"] } },
  { id: "queue", label: "Job queue", kind: "queue", edge: "jobs", deps: { js: ["bullmq", "bull", "bee-queue", "agenda", "pg-boss", "graphile-worker"], py: ["rq", "dramatiq", "arq"] } },
  { id: "celery", label: "Celery", kind: "worker", edge: "tasks", deps: { py: ["celery"] } },
  { id: "kafka", label: "Kafka", kind: "queue", images: ["kafka", "redpanda"], deps: { js: ["kafkajs", "@confluentinc/kafka-javascript"], py: ["kafka-python", "confluent-kafka", "aiokafka"], go: ["github.com/segmentio/kafka-go", "github.com/confluentinc/confluent-kafka-go*"] } },
  { id: "rabbitmq", label: "RabbitMQ", kind: "queue", images: ["rabbitmq"], deps: { js: ["amqplib", "amqp-connection-manager"], py: ["pika", "aio-pika"], go: ["github.com/rabbitmq/amqp091-go"] } },
  { id: "nats", label: "NATS", kind: "queue", images: ["nats"], deps: { js: ["nats"], py: ["nats-py"], go: ["github.com/nats-io/nats.go"] } },
  { id: "s3", label: "S3", kind: "storage", images: ["minio", "localstack"], deps: { js: ["@aws-sdk/client-s3", "aws-sdk"], py: ["boto3"], go: ["github.com/aws/aws-sdk-go*"] } },
  { id: "search", label: "Elasticsearch", kind: "database", images: ["elasticsearch", "opensearch"], deps: { js: ["@elastic/elasticsearch"], py: ["elasticsearch"] } },
  { id: "pinecone", label: "Pinecone", kind: "database", deps: { js: ["@pinecone-database/pinecone"], py: ["pinecone", "pinecone-client"] } },
  { id: "stripe", label: "Stripe", kind: "external", edge: "payments", deps: { js: ["stripe"], py: ["stripe"], go: ["github.com/stripe/stripe-go*"] } },
  { id: "openai", label: "OpenAI API", kind: "external", deps: { js: ["openai"], py: ["openai"], go: ["github.com/openai/openai-go*"] } },
  { id: "anthropic", label: "Anthropic API", kind: "external", deps: { js: ["@anthropic-ai/sdk"], py: ["anthropic"], go: ["github.com/anthropics/anthropic-sdk-go*"] } },
  { id: "supabase", label: "Supabase", kind: "external", deps: { js: ["@supabase/supabase-js"], py: ["supabase"] } },
  { id: "firebase", label: "Firebase", kind: "external", deps: { js: ["firebase", "firebase-admin"], py: ["firebase-admin"] } },
  { id: "email", label: "Email", kind: "external", edge: "send", deps: { js: ["resend", "@sendgrid/mail", "nodemailer", "postmark"], py: ["sendgrid", "resend"] } },
  { id: "twilio", label: "Twilio", kind: "external", deps: { js: ["twilio"], py: ["twilio"] } },
  { id: "sentry", label: "Sentry", kind: "external", edge: "errors", deps: { js: ["@sentry/*"], py: ["sentry-sdk"] } },
  { id: "clerk", label: "Clerk", kind: "external", edge: "auth", deps: { js: ["@clerk/*"] } },
  { id: "algolia", label: "Algolia", kind: "external", deps: { js: ["algoliasearch"], py: ["algoliasearch"] } },
];

const IMAGE_KIND: [RegExp, Kind][] = [
  [/postgres|postgis|mysql|mariadb|mongo|clickhouse|cockroach|timescale|cassandra|scylla|neo4j|elasticsearch|opensearch|meilisearch|typesense|qdrant|weaviate|milvus|chroma|pgvector|influxdb|surrealdb/, "database"],
  [/redis|valkey|memcached|keydb|dragonfly/, "cache"],
  [/rabbitmq|kafka|nats|redpanda|pulsar|activemq|mosquitto|emqx/, "queue"],
  [/minio|seaweedfs|localstack|azurite/, "storage"],
  [/ollama|vllm|text-generation|triton|llama/, "model"],
  [/nginx|traefik|caddy|envoy|kong|haproxy/, "service"],
];
const WORKER_NAME = /(^|[-_])(worker|workers|jobs?|consumer|scheduler|cron|celery|queue-worker|microservices)([-_]|$)/;
const FRONTEND_NAME = /(^|[-_])(web|frontend|ui|client|dashboard|admin|studio|site|www)([-_]|$)/;
const JS_FRONTEND: [string, string][] = [["next", "Next.js"], ["nuxt", "Nuxt"], ["@sveltejs/kit", "SvelteKit"], ["astro", "Astro"], ["@remix-run/react", "Remix"], ["@angular/core", "Angular"], ["expo", "Expo"], ["react-native", "React Native"], ["vue", "Vue"], ["solid-js", "Solid"], ["vite", "Vite"]];
const JS_SERVER: [string, string][] = [["@nestjs/core", "NestJS"], ["fastify", "Fastify"], ["express", "Express"], ["hono", "Hono"], ["koa", "Koa"], ["@hapi/hapi", "hapi"], ["elysia", "Elysia"], ["@apollo/server", "Apollo"], ["socket.io", "Socket.IO"], ["@trpc/server", "tRPC"]];
const PY_SERVER: [string, string][] = [["fastapi", "FastAPI"], ["django", "Django"], ["flask", "Flask"], ["starlette", "Starlette"], ["litestar", "Litestar"], ["aiohttp", "aiohttp"], ["tornado", "Tornado"]];
const RUST_SERVER = /^(axum|actix-web|warp|rocket|tonic|hyper|poem|salvo)\s*=/m;
const GO_SERVER = /http\.ListenAndServe|gin\.(Default|New)\(|echo\.New\(|fiber\.New\(|grpc\.NewServer\(|chi\.NewRouter\(|mux\.NewRouter\(/;

class Builder {
  nodes: SceneNode[] = [];
  edges: SceneEdge[] = [];
  private ids = new Set<string>();
  /** infra id -> node id actually used (may be a compose service) */
  infraNode = new Map<string, string>();

  id(name: string): string {
    const base = name.replace(/^@[^/]+\//, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "part";
    let id = base;
    for (let i = 2; this.ids.has(id); i++) id = `${base}-${i}`;
    this.ids.add(id);
    return id;
  }

  add(n: Omit<SceneNode, "id" | "description" | "group"> & { id?: string; name?: string }): SceneNode {
    let id: string;
    if (n.id && !this.ids.has(n.id)) {
      id = n.id;
      this.ids.add(id);
    } else id = this.id(n.name ?? n.label);
    const node: SceneNode = {
      id,
      label: n.label.slice(0, 28), kind: n.kind, note: n.note.slice(0, 40), paths: n.paths, description: "", group: "",
    };
    this.nodes.push(node);
    return node;
  }

  link(from: string, to: string, label = "") {
    if (from === to || this.edges.some((e) => e.from === from && e.to === to)) return;
    this.edges.push({ from, to, label });
  }

  byPath(dir: string): SceneNode | undefined {
    return this.nodes.find((n) => n.paths.includes(`${dir}/**`));
  }
}

// ---------- tiny parsers (just enough for the files we read) ----------

const json = (t: string | null): any => {
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const indentOf = (l: string) => l.length - l.trimStart().length;
const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");
const normDir = (d: string) => d.trim().replace(/^\.\/?/, "").replace(/\/+$/, "");

/** Join a repo-relative dir with a relative path, resolving "." and "..". */
function resolveRel(dir: string, rel: string): string {
  const out: string[] = [];
  for (const seg of [dir, rel].filter(Boolean).join("/").split("/")) {
    if (seg === "..") out.pop();
    else if (seg && seg !== ".") out.push(seg);
  }
  return out.join("/");
}

interface ComposeService {
  name: string;
  image: string;
  build: string;
  depends: string[];
}

/** Indentation-based reader for the `services:` block of a compose file. */
export function parseCompose(text: string): ComposeService[] {
  const lines = text.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
  const start = lines.findIndex((l) => /^services:\s*$/.test(l));
  if (start < 0) return [];
  const body: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (indentOf(l) === 0) break;
    body.push(l);
  }
  const svcIndent = body.length ? indentOf(body[0]!) : 0;
  const out: ComposeService[] = [];
  let cur: ComposeService | null = null;
  let block: string[] = [];
  const flush = () => {
    if (!cur) return;
    for (let i = 0; i < block.length; i++) {
      const l = block[i]!;
      const t = l.trim();
      const kv = t.match(/^([a-z_]+):\s*(.*)$/);
      if (!kv || indentOf(l) !== svcIndent + (block[0] ? indentOf(block[0]) - svcIndent : 2)) continue;
      const [, key, val = ""] = kv;
      const children: string[] = [];
      for (let j = i + 1; j < block.length && indentOf(block[j]!) > indentOf(l); j++) children.push(block[j]!);
      if (key === "image") cur.image = unquote(val);
      if (key === "build") {
        if (val) cur.build = unquote(val);
        else {
          const ctx = children.map((c) => c.trim().match(/^context:\s*(.+)$/)).find(Boolean);
          cur.build = ctx ? unquote(ctx[1]!) : ".";
        }
      }
      if (key === "depends_on") {
        if (val.startsWith("[")) cur.depends = val.replace(/[[\]]/g, "").split(",").map(unquote).filter(Boolean);
        else {
          const childIndent = children.length ? indentOf(children[0]!) : 0;
          for (const c of children) {
            if (indentOf(c) !== childIndent) continue;
            const t2 = c.trim();
            if (t2.startsWith("- ")) cur.depends.push(unquote(t2.slice(2)));
            else if (/^[\w.-]+:/.test(t2)) cur.depends.push(t2.slice(0, t2.indexOf(":")));
          }
        }
      }
    }
    out.push(cur);
  };
  for (const l of body) {
    if (indentOf(l) === svcIndent && /^\s*[\w.-]+:\s*$/.test(l)) {
      flush();
      cur = { name: l.trim().slice(0, -1), image: "", build: "", depends: [] };
      block = [];
    } else if (cur) block.push(l);
  }
  flush();
  return out;
}

/** Strings in a TOML array `key = [ ... ]`; brackets inside quotes (e.g. "psycopg[binary]") don't end the array. */
export function tomlArray(text: string, key: string): string[] {
  const m = new RegExp(`^\\s*${key}\\s*=\\s*\\[`, "m").exec(text);
  if (!m) return [];
  const out: string[] = [];
  let quote = "";
  let cur = "";
  for (let i = m.index + m[0].length; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === quote) {
        out.push(cur);
        quote = "";
        cur = "";
      } else cur += c;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "]") break;
  }
  return out;
}

function pyDeps(repo: Repo): string[] {
  const deps: string[] = [];
  const py = repo.read("pyproject.toml") ?? "";
  deps.push(...tomlArray(py, "dependencies"));
  const poetry = py.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(\n\[|$)/);
  if (poetry) deps.push(...[...poetry[1]!.matchAll(/^([A-Za-z0-9_.-]+)\s*=/gm)].map((m) => m[1]!));
  for (const r of ["requirements.txt", "requirements/base.txt", "requirements/prod.txt"])
    deps.push(...(repo.read(r) ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith("-")));
  return deps.map((d) => d.split(/[<>=!~;\[ ]/)[0]!.toLowerCase()).filter(Boolean);
}

function goDeps(repo: Repo): string[] {
  return [...(repo.read("go.mod") ?? "").matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]+\/[^\s]+)\s+v/gm)].map((m) => m[1]!);
}

const depMatches = (patterns: string[] | undefined, dep: string) =>
  (patterns ?? []).some((p) => (p.endsWith("*") ? dep.startsWith(p.slice(0, -1)) : dep === p));

// ---------- detectors ----------

/** Tooling that isn't part of the running system: tests, docs, configs, storybooks, scripts. */
const TOOLING = /(^|[-_/@])(e2e|tests?|testing|test-utils|[\w-]*-test-utils|fixtures?|docs?|documentation|scripts?|storybook|tsconfig|[\w-]*-config|configs?|eslint[\w-]*|prettier[\w-]*|playwright[\w-]*|benchmarks?|examples?|\.github|github|mocks?|dev|devtools?)([-_/]|$)/i;

/** The compose file that describes the deployed system: root or docker/ deploy/ beats dev/test/e2e variants. */
export function pickCompose(files: string[]): string | undefined {
  const score = (f: string) => {
    let s = f.split("/").length * 10;
    if (/(^|\/)(e2e|tests?|testing|examples?|dev|development|local|\.devcontainer|fixtures?)\//.test(f)) s += 100;
    if (/compose\.(dev|development|test|e2e|ci|override|local)\./.test(f)) s += 50;
    if (/^(docker|deploy|deployment|infra)\//.test(f)) s -= 5;
    return s;
  };
  return files.filter((f) => /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(f) && f.split("/").length <= 3).sort((a, c) => score(a) - score(c) || a.localeCompare(c))[0];
}

function fromCompose(repo: Repo, b: Builder) {
  const file = pickCompose(repo.files());
  if (!file) return;
  const base = dirOf(file);
  const services = parseCompose(repo.read(file) ?? "");
  const idOf = new Map<string, string>();
  for (const s of services) {
    const img = s.image.replace(/\$\{[^}]*\}/g, "").replace(/@sha256:.*$/, "");
    const short = (img.split("/").pop() ?? "").replace(/:$/, "");
    const ident = `${img} ${s.name}`.toLowerCase();
    const byImage = IMAGE_KIND.find(([re]) => re.test(img.toLowerCase()))?.[1] ?? (s.build ? undefined : IMAGE_KIND.find(([re]) => re.test(s.name.toLowerCase()))?.[1]);
    const ctx = s.build ? resolveRel(base, s.build) : "";
    const pkg = ctx ? json(repo.read(`${ctx}/package.json`)) : null;
    const deps = Object.keys({ ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) });
    const kind: Kind = WORKER_NAME.test(s.name)
      ? "worker"
      : byImage ?? (FRONTEND_NAME.test(s.name) || deps.some((d) => JS_FRONTEND.some(([f]) => f === d)) ? "frontend" : "service");
    const node = b.add({
      id: undefined, name: s.name, label: s.name, kind,
      note: short || (ctx ? `built from ./${ctx}` : ""),
      paths: ctx && !b.byPath(ctx) ? [`${ctx}/**`] : [],
    });
    idOf.set(s.name, node.id);
    if (!s.build) for (const inf of INFRA) if (inf.images?.some((i) => ident.includes(i)) && !b.infraNode.has(inf.id)) b.infraNode.set(inf.id, node.id);
  }
  for (const s of services) for (const d of s.depends) if (idOf.has(d)) b.link(idOf.get(s.name)!, idOf.get(d)!);
}

function addInfra(b: Builder, from: string, deps: string[], eco: Eco) {
  const hits = INFRA.filter((inf) => deps.some((d) => depMatches(inf.deps[eco], d)));
  const hasSpecificDb = hits.some((h) => h.kind === "database" && !h.fallback) || [...b.infraNode.keys()].some((k) => ["postgres", "mysql", "mongodb"].includes(k));
  for (const inf of hits) {
    if (inf.fallback && hasSpecificDb) continue;
    let target = b.infraNode.get(inf.id);
    if (!target) {
      target = b.add({ id: inf.id, label: inf.label, kind: inf.kind, note: "", paths: [] }).id;
      b.infraNode.set(inf.id, target);
    }
    b.link(from, target, inf.edge ?? "");
  }
}

function jsKind(pkg: any, dir: string, hasIndexHtml: boolean): { kind: Kind; note: string } {
  const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
  const fe = JS_FRONTEND.find(([d]) => deps.includes(d) && !["vite", "vue", "solid-js"].includes(d));
  const srv = JS_SERVER.find(([d]) => deps.includes(d));
  const name = String(pkg.name ?? dir);
  if (pkg.bin && !srv) return { kind: "cli", note: "command-line tool" };
  if (WORKER_NAME.test(name.replace(/^@[^/]+\//, ""))) return { kind: "worker", note: srv?.[1] ?? "" };
  if (srv && !fe) return { kind: "service", note: srv[1] };
  if (fe) return { kind: "frontend", note: fe[1] };
  const ui = deps.includes("react") || deps.includes("react-dom") ? "React" : deps.includes("vue") ? "Vue" : deps.includes("svelte") ? "Svelte" : "";
  // a UI package is an app only if it has its own page (index.html) or lives under apps/
  if (ui && deps.includes("vite") && (hasIndexHtml || /^apps\//.test(dir))) return { kind: "frontend", note: `${ui} + Vite` };
  if (srv) return { kind: "service", note: srv[1] };
  return { kind: "library", note: ui ? `${ui} components` : "" };
}

function fromJs(repo: Repo, b: Builder) {
  const root = json(repo.read("package.json"));
  let patterns: string[] = [];
  if (Array.isArray(root?.workspaces)) patterns = root.workspaces;
  else if (Array.isArray(root?.workspaces?.packages)) patterns = root.workspaces.packages;
  const pnpm = repo.read("pnpm-workspace.yaml");
  if (pnpm) patterns.push(...[...pnpm.matchAll(/^\s*-\s*(.+)$/gm)].map((m) => unquote(m[1]!)).filter((p) => !p.startsWith("!")));
  const files = repo.files();
  const pkgFiles = patterns.length
    ? files.filter((f) => f.endsWith("/package.json") && !f.includes("node_modules/") && patterns.some((p) => globToRegExp(p.replace(/\/$/, "")).test(dirOf(f))))
    : root && (root.dependencies || root.bin) ? ["package.json"] : [];
  const byName = new Map<string, string>();
  const pkgs: { node: SceneNode; pkg: any }[] = [];
  for (const f of pkgFiles.sort()) {
    const pkg = json(repo.read(f));
    const dir = dirOf(f);
    if (!pkg || (dir && (TOOLING.test(dir) || TOOLING.test(String(pkg.name ?? ""))))) continue;
    const { kind, note } = jsKind(pkg, dir, files.includes(`${dir ? `${dir}/` : ""}index.html`));
    const short = String(pkg.name ?? (dir || repo.name)).replace(/^@[^/]+\//, "");
    // the same thing may already be on the map from docker-compose: by build context, or an image-only service named after this folder
    const base = dir.split("/").pop() ?? "";
    const existing = (dir ? b.byPath(dir) : undefined) ??
      b.nodes.find((n) => !n.paths.length && ["service", "worker", "frontend"].includes(n.kind) && (n.id === short || n.id.split(/[-_]/).includes(base)));
    let node: SceneNode;
    if (existing) {
      node = existing;
      if (dir && !existing.paths.length) existing.paths = [`${dir}/**`];
      if (existing.kind === "service" && kind !== "library" && kind !== "cli") existing.kind = kind;
      if (!existing.note || existing.note.startsWith("built from") || /:/.test(existing.note)) existing.note = note || existing.note;
    } else node = b.add({ name: short, label: short, kind, note, paths: dir ? [`${dir}/**`] : [] });
    if (pkg.name) byName.set(pkg.name, node.id);
    pkgs.push({ node, pkg });
  }
  for (const { node, pkg } of pkgs) {
    // runtime dependencies only: devDependencies (test utils, configs, type packages) would draw fake pipes
    const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) });
    for (const d of deps) if (byName.has(d)) b.link(node.id, byName.get(d)!);
    addInfra(b, node.id, deps, "js");
  }
}

function fromPython(repo: Repo, b: Builder) {
  const py = repo.read("pyproject.toml");
  const deps = pyDeps(repo);
  if (!py && !deps.length) return;
  // pyproject that only packages a Rust/C binary for PyPI (maturin, scikit-build) isn't a Python service
  if (/build-backend\s*=\s*["'](maturin|scikit_build_core\.build)["']/.test(py ?? "") && !deps.length) return;
  const name = py?.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1] ?? repo.name;
  const srv = PY_SERVER.find(([d]) => deps.includes(d));
  const kind: Kind = srv ? "service" : /\[(project\.scripts|tool\.poetry\.scripts)\]/.test(py ?? "") ? "cli" : "library";
  const node = b.add({ name, label: name, kind, note: srv?.[1] ?? "", paths: [] });
  addInfra(b, node.id, deps, "py");
}

function fromCargo(repo: Repo, b: Builder) {
  const root = repo.read("Cargo.toml");
  if (!root) return;
  const members = tomlArray(root, "members");
  const dirs = members.length
    ? repo.files().filter((f) => f.endsWith("/Cargo.toml") && members.some((m) => globToRegExp(m).test(dirOf(f)))).map(dirOf)
    : [""];
  // [workspace.dependencies] name = { path = "crates/x" }: members refer to these with `workspace = true`
  const wsDeps = new Map<string, string>();
  const wsBlock = root.match(/^\[workspace\.dependencies\]([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1] ?? "";
  for (const m of wsBlock.matchAll(/^([\w-]+)\s*=\s*\{[^}\n]*path\s*=\s*"([^"]+)"/gm)) wsDeps.set(m[1]!, normDir(m[2]!));
  const nodeOf = new Map<string, string>();
  const tomls = new Map<string, string>();
  for (const dir of dirs.sort()) {
    if (dir && TOOLING.test(dir)) continue;
    const t = repo.read(dir ? `${dir}/Cargo.toml` : "Cargo.toml") ?? "";
    if (!/^\[package\]/m.test(t)) continue;
    const name = t.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1] ?? dir;
    const hasMain = repo.files().some((f) => f === `${dir ? `${dir}/` : ""}src/main.rs` || f.startsWith(`${dir ? `${dir}/` : ""}src/bin/`));
    const kind: Kind = RUST_SERVER.test(t) ? "service" : hasMain ? "cli" : "library";
    const short = dir ? dir.split("/").pop()! : name;
    const node = b.add({ name: short, label: name, kind, note: "Rust crate", paths: dir ? [`${dir}/**`] : [] });
    nodeOf.set(dir, node.id);
    tomls.set(dir, t);
  }
  for (const [dir, t] of tomls) {
    // only [dependencies] / [build-dependencies] count; [dev-dependencies] are test-only
    const runtime = t.replace(/^\[(dev-dependencies|target\.[^\]]*\.dev-dependencies)\][\s\S]*?(?=^\[|$(?![\s\S]))/gm, "");
    for (const m of runtime.matchAll(/^[\w-]+\s*=\s*\{[^}\n]*path\s*=\s*"([^"]+)"/gm)) {
      const target = resolveRel(dir, m[1]!);
      if (nodeOf.has(target)) b.link(nodeOf.get(dir)!, nodeOf.get(target)!);
    }
    for (const m of runtime.matchAll(/^([\w-]+)(?:\.workspace\s*=\s*true|\s*=\s*\{[^}\n]*workspace\s*=\s*true)/gm)) {
      const target = wsDeps.get(m[1]!);
      if (target !== undefined && nodeOf.has(target)) b.link(nodeOf.get(dir)!, nodeOf.get(target)!);
    }
  }
}

function fromGo(repo: Repo, b: Builder) {
  if (!repo.read("go.mod")) return;
  const mains = repo.files().filter((f) => /^cmd\/[^/]+\/main\.go$/.test(f));
  const servers: string[] = [];
  for (const f of mains.sort()) {
    const name = f.split("/")[1]!;
    const isServer = GO_SERVER.test(repo.read(f) ?? "");
    const n = b.add({ name, label: name, kind: isServer ? "service" : "cli", note: "Go", paths: [`cmd/${name}/**`] });
    if (isServer) servers.push(n.id);
  }
  if (!mains.length) {
    const mod = (repo.read("go.mod") ?? "").match(/^module\s+(\S+)/m)?.[1]?.split("/").pop() ?? repo.name;
    servers.push(b.add({ name: mod, label: mod, kind: "service", note: "Go", paths: [] }).id);
  }
  for (const s of servers) addInfra(b, s, goDeps(repo), "go");
}

// ---------- entry point ----------

export interface ScanOptions {
  /** Most parts to keep (default 16: a map people can read). Least-connected libraries are dropped first. */
  maxParts?: number;
}

export function scan(repo: Repo, opts: ScanOptions = {}): Scene {
  const max = Math.min(MAX_NODES, Math.max(1, opts.maxParts ?? 16));
  const b = new Builder();
  fromCompose(repo, b);
  fromJs(repo, b);
  fromPython(repo, b);
  fromCargo(repo, b);
  fromGo(repo, b);

  const root = json(repo.read("package.json"));
  const title = String(root?.name ?? repo.read("pyproject.toml")?.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1] ?? repo.name);
  const subtitle = String(root?.description ?? "");

  if (!b.nodes.length) b.add({ name: title, label: title, kind: "library", note: "", paths: [] });
  // bull/bullmq-style queues live inside Redis
  const q = b.infraNode.get("queue");
  const r = b.infraNode.get("redis");
  if (q && r) b.link(q, r, "on");
  const fronts = b.nodes.filter((n) => n.kind === "frontend");
  if (fronts.length) {
    const users = b.add({ id: "users", label: "Users", kind: "user", note: "", paths: [] });
    for (const f of fronts) b.link(users.id, f.id);
  }

  // keep it readable: drop least-connected libraries first, then CLIs, then anything else; hubs survive
  while (b.nodes.length > max) {
    const deg = (id: string) => b.edges.filter((e) => e.from === id || e.to === id).length;
    const weight = (n: SceneNode) => (n.kind === "library" || n.kind === "cli" ? 0 : n.kind === "user" ? 2 : 1) * 1000 + deg(n.id);
    const victim = [...b.nodes].sort((x, y) => weight(x) - weight(y) || y.id.localeCompare(x.id))[0]!;
    b.nodes = b.nodes.filter((n) => n !== victim);
    b.edges = b.edges.filter((e) => e.from !== victim.id && e.to !== victim.id);
  }
  // put the starting points first so the layout flows from them
  const rank = (k: Kind) => (k === "user" ? 0 : k === "frontend" || k === "cli" ? 1 : 2);
  b.nodes.sort((x, y) => rank(x.kind) - rank(y.kind));
  return { title: title.slice(0, 40), subtitle: subtitle.slice(0, 90), nodes: b.nodes, edges: b.edges, groups: [], ignore: [] };
}
