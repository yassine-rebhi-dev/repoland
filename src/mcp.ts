/**
 * Model Context Protocol server (stdio, newline-delimited JSON-RPC 2.0). Lets coding agents ask the map:
 * which part owns a file, what depends on a part, what a set of changed files touches, whether the map drifted.
 * Install in Claude Code: `claude mcp add repoland -- npx -y repoland mcp`
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { drift } from "./drift.js";
import { matchAny } from "./glob.js";
import { impact } from "./impact.js";
import { VERSION } from "./meta.js";
import { LocalRepo } from "./repo.js";
import { type Scene, parseScene } from "./scene.js";

export interface McpContext {
  scenePath: string;
  repoDir: string;
}

const TOOLS = [
  { name: "repoland_overview", description: "The architecture map of this repository: every part (kind, tech, owned code paths, description) and how data flows between them. Read this before working in an unfamiliar area.", inputSchema: { type: "object", properties: {} } },
  { name: "repoland_part_for_file", description: "Which architecture part owns a file, what that part calls and what calls it.", inputSchema: { type: "object", properties: { path: { type: "string", description: "Repo-relative file path" } }, required: ["path"] } },
  { name: "repoland_dependents", description: "Everything that depends (directly or transitively) on a part: what could break if you change it.", inputSchema: { type: "object", properties: { part: { type: "string", description: "Part id or label" } }, required: ["part"] } },
  { name: "repoland_impact", description: "Which parts a set of changed files touches, and which parts depend on those.", inputSchema: { type: "object", properties: { files: { type: "array", items: { type: "string" } } }, required: ["files"] } },
  { name: "repoland_check", description: "Whether the map still matches the code: parts whose code is gone, and code that isn't on the map.", inputSchema: { type: "object", properties: {} } },
];

function loadScene(ctx: McpContext): Scene {
  if (!existsSync(ctx.scenePath)) throw new Error(`No map at ${ctx.scenePath}. Run \`npx repoland scan\` (or ask your agent to map the repo with the repoland skill).`);
  return parseScene(readFileSync(ctx.scenePath, "utf8"));
}

const label = (s: Scene, id: string) => s.nodes.find((n) => n.id === id)?.label ?? id;
const findPart = (s: Scene, q: string) => s.nodes.find((n) => n.id === q) ?? s.nodes.find((n) => n.label.toLowerCase() === q.toLowerCase());

function describe(s: Scene, id: string): string {
  const n = s.nodes.find((x) => x.id === id)!;
  const calls = s.edges.filter((e) => e.from === id).map((e) => `${label(s, e.to)}${e.label ? ` (${e.label})` : ""}`);
  const by = s.edges.filter((e) => e.to === id).map((e) => `${label(s, e.from)}${e.label ? ` (${e.label})` : ""}`);
  return [
    `${n.label} [${n.kind}]${n.note ? ` - ${n.note}` : ""}`,
    n.description && `  ${n.description}`,
    n.paths.length && `  code: ${n.paths.join(", ")}`,
    calls.length && `  calls: ${calls.join(", ")}`,
    by.length && `  called by: ${by.join(", ")}`,
  ].filter(Boolean).join("\n");
}

export function callTool(name: string, args: Record<string, any>, ctx: McpContext): string {
  const s = loadScene(ctx);
  switch (name) {
    case "repoland_overview":
      return [`# ${s.title}${s.subtitle ? `: ${s.subtitle}` : ""}`, "", ...s.nodes.map((n) => describe(s, n.id))].join("\n");
    case "repoland_part_for_file": {
      const path = String(args.path ?? "").replace(/^\.\//, "");
      const owners = s.nodes.filter((n) => n.paths.length && matchAny(n.paths, path));
      return owners.length ? owners.map((n) => describe(s, n.id)).join("\n\n") : `No part on the map owns ${path}.`;
    }
    case "repoland_dependents": {
      const p = findPart(s, String(args.part ?? ""));
      if (!p) throw new Error(`Unknown part "${args.part}". Parts: ${s.nodes.map((n) => n.id).join(", ")}`);
      const r = impact({ ...s, nodes: s.nodes.map((n) => ({ ...n, paths: n.id === p.id ? ["__part__"] : [] })) }, ["__part__"]);
      return r.affected.length ? `Changing ${p.label} can affect: ${r.affected.map((id) => label(s, id)).join(", ")}` : `Nothing on the map depends on ${p.label}.`;
    }
    case "repoland_impact": {
      const files = Array.isArray(args.files) ? args.files.map(String) : [];
      const r = impact(s, files);
      return [
        `Changed: ${r.changed.map((id) => label(s, id)).join(", ") || "no mapped part"}`,
        `Affected: ${r.affected.map((id) => label(s, id)).join(", ") || "none"}`,
        r.unmapped.length ? `Not on the map: ${r.unmapped.join(", ")}` : "",
      ].filter(Boolean).join("\n");
    }
    case "repoland_check": {
      const d = drift(s, new LocalRepo(ctx.repoDir));
      if (d.ok) return "The map matches the code.";
      return [
        ...d.stale.map((x) => `stale: "${x.label}" owns ${x.paths.join(", ")}, which matches no file`),
        ...d.uncovered.map((x) => `not on the map: ${x.kind} "${x.label}"${x.paths.length ? ` (${x.paths.join(", ")})` : ""}`),
      ].join("\n");
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

type Msg = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: any };

/** Handle one JSON-RPC message; returns the response, or null for notifications. */
export function handle(msg: Msg, ctx: McpContext): object | null {
  const reply = (result: object) => ({ jsonrpc: "2.0", id: msg.id, result });
  if (msg.id === undefined) return null; // notification (e.g. notifications/initialized)
  switch (msg.method) {
    case "initialize":
      return reply({ protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "repoland", version: VERSION } });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call":
      try {
        return reply({ content: [{ type: "text", text: callTool(msg.params?.name, msg.params?.arguments ?? {}, ctx) }] });
      } catch (e) {
        return reply({ content: [{ type: "text", text: (e as Error).message }], isError: true });
      }
    default:
      return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
  }
}

export function serve(cwd: string, scene = "repoland.json", repo = "."): void {
  const ctx = { scenePath: resolve(cwd, scene), repoDir: resolve(cwd, repo) };
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg: Msg;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
      return;
    }
    const res = handle(msg, ctx);
    if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
  });
}
