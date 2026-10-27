import { describe, expect, it } from "vitest";
import { drift } from "../src/drift.js";
import { impact } from "../src/impact.js";
import { MemoryRepo } from "../src/repo.js";
import { parseScene } from "../src/scene.js";

const repo = new MemoryRepo("shop", {
  "package.json": JSON.stringify({ workspaces: ["apps/*"] }),
  "apps/web/package.json": JSON.stringify({ name: "web", dependencies: { next: "15" } }),
  "apps/web/page.tsx": "",
  "apps/api/package.json": JSON.stringify({ name: "api", dependencies: { express: "4", pg: "8" } }),
  "apps/api/server.ts": "",
  "apps/admin/package.json": JSON.stringify({ name: "admin", dependencies: { next: "15" } }),
  "apps/admin/page.tsx": "",
});

const scene = parseScene({
  title: "shop",
  nodes: [
    { id: "web", label: "Storefront", kind: "frontend", paths: ["apps/web/**"] },
    { id: "api", label: "API", kind: "service", paths: ["apps/api/**"] },
    { id: "billing", label: "Billing", kind: "service", paths: ["services/billing/**"] },
    { id: "db", label: "Orders DB", kind: "database" },
  ],
  edges: [{ from: "web", to: "api" }, { from: "api", to: "db" }, { from: "billing", to: "db" }],
});

describe("drift", () => {
  const d = drift(scene, repo);
  it("flags parts whose code no longer exists", () => {
    expect(d.stale.map((s) => s.id)).toEqual(["billing"]);
  });
  it("flags code that exists but isn't on the map", () => {
    expect(d.uncovered.map((u) => u.label)).toEqual(["admin"]);
  });
  it("doesn't flag infrastructure the map already shows under another name", () => {
    expect(d.uncovered.some((u) => u.kind === "database")).toBe(false);
  });
  it("is clean for an up-to-date map", () => {
    const good = parseScene({ ...scene, nodes: [...scene.nodes.filter((n) => n.id !== "billing"), { id: "admin", label: "Admin", kind: "frontend", paths: ["apps/admin/**"] }], edges: [] });
    const r = drift(good, repo);
    expect(r.ok).toBe(true);
  });
});

describe("impact", () => {
  it("maps changed files to parts and walks to everything that depends on them", () => {
    const r = impact(scene, ["apps/api/server.ts", "README.md"]);
    expect(r.changed).toEqual(["api"]);
    expect(r.affected).toEqual(["web"]);
    expect(r.unmapped).toEqual(["README.md"]);
  });
  it("a change to a shared dependency reaches all its callers transitively", () => {
    const s = parseScene({
      title: "t",
      nodes: [
        { id: "a", label: "A", kind: "frontend" }, { id: "b", label: "B", kind: "service" },
        { id: "c", label: "C", kind: "library", paths: ["lib/**"] }, { id: "d", label: "D", kind: "worker" },
      ],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "d", to: "c" }],
    });
    const r = impact(s, ["lib/x.ts"]);
    expect(r.changed).toEqual(["c"]);
    expect(r.affected.sort()).toEqual(["a", "b", "d"]);
  });
});

describe("ignore", () => {
  it("parts deliberately left off the map (by label or path glob) don't count as drift", () => {
    const s = parseScene({ ...scene, ignore: ["admin"], nodes: scene.nodes.filter((n) => n.id !== "billing"), edges: [] });
    expect(drift(s, repo).ok).toBe(true);
    const byGlob = parseScene({ ...scene, ignore: ["apps/admin/**"], nodes: scene.nodes.filter((n) => n.id !== "billing"), edges: [] });
    expect(drift(byGlob, repo).ok).toBe(true);
  });
});
