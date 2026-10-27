import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handle } from "../src/mcp.js";
import { toMermaid } from "../src/mermaid.js";
import { parseScene } from "../src/scene.js";

const raw = {
  title: "shop",
  groups: [{ id: "edge", label: "Edge" }],
  nodes: [
    { id: "web", label: "Storefront", kind: "frontend", note: "Next.js", group: "edge", paths: ["apps/web/**"] },
    { id: "api", label: "API", kind: "service", paths: ["apps/api/**"], description: "Orders and checkout." },
    { id: "db", label: "Orders \"DB\"", kind: "database" },
    { id: "end", label: "End", kind: "external" },
  ],
  edges: [{ from: "web", to: "api", label: "REST" }, { from: "api", to: "db" }, { from: "api", to: "end" }],
};

describe("toMermaid", () => {
  const m = toMermaid(parseScene(raw));
  it("is a flowchart with kind shapes, subgraphs, labelled edges and escaped quotes", () => {
    expect(m).toContain("flowchart LR");
    expect(m).toContain('subgraph g_edge["Edge"]');
    expect(m).toContain('n_db[("Orders #quot;DB#quot;")]');
    expect(m).toContain('n_web -->|"REST"| n_api');
    expect(m).toContain("classDef k_service");
  });
  it("prefixes ids so Mermaid keywords like `end` can't break the chart", () => {
    expect(m).toContain('n_end(("End"))');
    expect(m).not.toMatch(/^\s+end\(/m);
  });
});

describe("MCP server", () => {
  const dir = mkdtempSync(join(tmpdir(), "repoland-mcp-"));
  writeFileSync(join(dir, "repoland.json"), JSON.stringify(raw));
  const ctx = { scenePath: join(dir, "repoland.json"), repoDir: dir };
  const call = (name: string, args: object = {}) => handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx) as any;

  it("initializes and lists tools", () => {
    const init = handle({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } }, ctx) as any;
    expect(init.result.serverInfo.name).toBe("repoland");
    expect(init.result.capabilities.tools).toBeDefined();
    const list = handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, ctx) as any;
    expect(list.result.tools.map((t: any) => t.name)).toContain("repoland_part_for_file");
  });
  it("ignores notifications and rejects unknown methods", () => {
    expect(handle({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx)).toBeNull();
    expect((handle({ jsonrpc: "2.0", id: 9, method: "nope" }, ctx) as any).error.code).toBe(-32601);
  });
  it("answers: who owns this file, what depends on a part, what does a change touch", () => {
    expect(call("repoland_part_for_file", { path: "apps/api/orders.ts" }).result.content[0].text).toMatch(/API \[service\][\s\S]*Orders and checkout[\s\S]*called by: Storefront \(REST\)/);
    expect(call("repoland_dependents", { part: "api" }).result.content[0].text).toBe("Changing API can affect: Storefront");
    expect(call("repoland_impact", { files: ["apps/web/page.tsx"] }).result.content[0].text).toContain("Changed: Storefront");
    expect(call("repoland_overview").result.content[0].text).toContain("# shop");
  });
  it("reports tool errors as isError results, not protocol errors", () => {
    const r = call("repoland_dependents", { part: "ghost" });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/Unknown part/);
  });
});
