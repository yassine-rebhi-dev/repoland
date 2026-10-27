/** Export a scene as a Mermaid flowchart (GitHub, GitLab, Notion and most docs tools render it natively). */
import { PALETTE } from "./render.js";
import type { Kind, Scene } from "./scene.js";

const SHAPE: Record<Kind, [string, string]> = {
  user: ["([", "])"],
  frontend: ["[", "]"],
  service: ["[", "]"],
  worker: ["[[", "]]"],
  database: ["[(", ")]"],
  cache: ["{{", "}}"],
  queue: [">", "]"],
  storage: ["[/", "/]"],
  external: ["((", "))"],
  cli: ["[\\", "/]"],
  library: ["[/", "\\]"],
  model: ["(((", ")))"],
};

const text = (s: string) => s.replace(/"/g, "#quot;");
const mid = (id: string) => `n_${id.replace(/[^A-Za-z0-9_]/g, "_")}`;

export function toMermaid(scene: Scene): string {
  const lines = ["flowchart LR"];
  if (scene.title) lines.unshift(`---\ntitle: ${scene.title.replace(/\n/g, " ")}\n---`);
  const node = (id: string) => {
    const n = scene.nodes.find((x) => x.id === id)!;
    const [open, close] = SHAPE[n.kind];
    const label = n.note ? `${text(n.label)}<br/><small>${text(n.note)}</small>` : text(n.label);
    return `${mid(n.id)}${open}"${label}"${close}`;
  };
  const grouped = new Set<string>();
  for (const g of scene.groups) {
    const members = scene.nodes.filter((n) => n.group === g.id);
    if (!members.length) continue;
    lines.push(`  subgraph g_${g.id.replace(/[^A-Za-z0-9_]/g, "_")}["${text(g.label)}"]`);
    for (const m of members) {
      lines.push(`    ${node(m.id)}`);
      grouped.add(m.id);
    }
    lines.push("  end");
  }
  for (const n of scene.nodes) if (!grouped.has(n.id)) lines.push(`  ${node(n.id)}`);
  for (const e of scene.edges) lines.push(`  ${mid(e.from)} -->${e.label ? `|"${text(e.label)}"|` : ""} ${mid(e.to)}`);
  const kinds = [...new Set(scene.nodes.map((n) => n.kind))];
  for (const k of kinds) {
    const fg = k === "external" || k === "queue" || k === "user" ? "#17202e" : "#ffffff";
    lines.push(`  classDef k_${k} fill:${PALETTE[k]},stroke:${PALETTE[k]},color:${fg}`);
    lines.push(`  class ${scene.nodes.filter((n) => n.kind === k).map((n) => mid(n.id)).join(",")} k_${k}`);
  }
  return `${lines.join("\n")}\n`;
}
