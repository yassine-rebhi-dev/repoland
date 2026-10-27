/** The scene format an agent writes: what exists in the system and how data flows between it. */

export const KINDS = [
  "user", "frontend", "service", "worker", "database", "cache", "queue", "storage", "external", "cli", "library", "model",
] as const;
export type Kind = (typeof KINDS)[number];

export interface SceneNode {
  id: string;
  label: string;
  kind: Kind;
  /** One short line shown under the label (tech, responsibility). */
  note: string;
  /** Longer explanation shown in the interactive viewer. */
  description: string;
  /** Repo-relative globs of the code this part owns (drift checks, PR impact, viewer). */
  paths: string[];
  /** District id ("" = none). */
  group: string;
}

export interface SceneGroup {
  id: string;
  label: string;
}

export interface SceneEdge {
  from: string;
  to: string;
  label: string;
}

export interface Scene {
  title: string;
  subtitle: string;
  nodes: SceneNode[];
  edges: SceneEdge[];
  groups: SceneGroup[];
  /** Parts deliberately left off the map (labels/ids or path globs); drift checks skip them. */
  ignore: string[];
}

export const MAX_NODES = 30;
const LABEL_MAX = 28;
const NOTE_MAX = 40;
const EDGE_LABEL_MAX = 24;
const ID = /^[a-zA-Z0-9_-]{1,40}$/;
const DESCRIPTION_MAX = 280;
const MAX_PATHS = 30;

export class SceneError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid scene:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Validate and normalise. Throws SceneError listing every problem, each with a JSON path. */
export function parseScene(input: unknown): Scene {
  let raw: any = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      throw new SceneError([`not valid JSON (${(e as Error).message})`]);
    }
  }
  const problems: string[] = [];
  if (!raw || typeof raw !== "object") throw new SceneError(["scene must be a JSON object"]);
  if (!str(raw.title)) problems.push("title: required (the project name)");
  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) problems.push("nodes: required, a non-empty array");
  if (raw.edges !== undefined && !Array.isArray(raw.edges)) problems.push("edges: must be an array");
  if (Array.isArray(raw.nodes) && raw.nodes.length > MAX_NODES)
    problems.push(`nodes: at most ${MAX_NODES} (got ${raw.nodes.length}); merge minor components so the picture stays readable`);

  const nodes: SceneNode[] = [];
  const seen = new Set<string>();
  (Array.isArray(raw.nodes) ? raw.nodes : []).forEach((n: any, i: number) => {
    const p = `nodes[${i}]`;
    const id = str(n?.id);
    if (!ID.test(id)) problems.push(`${p}.id: required, letters/digits/_/- only (got ${JSON.stringify(n?.id)})`);
    else if (seen.has(id)) problems.push(`${p}.id: duplicate id "${id}"`);
    seen.add(id);
    if (!str(n?.label)) problems.push(`${p}.label: required`);
    if (!KINDS.includes(n?.kind)) problems.push(`${p}.kind: must be one of ${KINDS.join(", ")} (got ${JSON.stringify(n?.kind)})`);
    const paths: string[] = [];
    if (n?.paths !== undefined && !Array.isArray(n.paths)) problems.push(`${p}.paths: must be an array of globs`);
    (Array.isArray(n?.paths) ? n.paths.slice(0, MAX_PATHS) : []).forEach((g: unknown, j: number) => {
      if (typeof g !== "string" || !g.trim()) problems.push(`${p}.paths[${j}]: must be a non-empty string`);
      else if (g.startsWith("/") || /(^|\/)\.\.(\/|$)/.test(g)) problems.push(`${p}.paths[${j}]: must be relative to the repo root, without ".." (got ${JSON.stringify(g)})`);
      else paths.push(g.trim());
    });
    nodes.push({
      id, label: clip(str(n?.label), LABEL_MAX), kind: n?.kind, note: clip(str(n?.note), NOTE_MAX),
      description: clip(str(n?.description), DESCRIPTION_MAX), paths, group: str(n?.group),
    });
  });

  const edges: SceneEdge[] = [];
  (Array.isArray(raw.edges) ? raw.edges : []).forEach((e: any, i: number) => {
    const p = `edges[${i}]`;
    const from = str(e?.from);
    const to = str(e?.to);
    if (!seen.has(from)) problems.push(`${p}.from: unknown node id ${JSON.stringify(e?.from)}`);
    if (!seen.has(to)) problems.push(`${p}.to: unknown node id ${JSON.stringify(e?.to)}`);
    if (from && from === to) problems.push(`${p}: an edge cannot connect a node to itself`);
    edges.push({ from, to, label: clip(str(e?.label), EDGE_LABEL_MAX) });
  });

  // districts: declared groups first, then any group a node names without declaring it
  const groups: SceneGroup[] = [];
  if (raw.groups !== undefined && !Array.isArray(raw.groups)) problems.push("groups: must be an array");
  (Array.isArray(raw.groups) ? raw.groups : []).forEach((g: any, i: number) => {
    if (!ID.test(str(g?.id))) problems.push(`groups[${i}].id: required, letters/digits/_/- only`);
    else groups.push({ id: str(g.id), label: clip(str(g?.label) || str(g.id), LABEL_MAX) });
  });
  for (const n of nodes) if (n.group && !groups.some((g) => g.id === n.group)) groups.push({ id: n.group, label: clip(n.group, LABEL_MAX) });

  if (problems.length) throw new SceneError(problems);
  const ignore = Array.isArray(raw.ignore) ? raw.ignore.filter((x: unknown) => typeof x === "string" && x.trim()).map((x: string) => x.trim()) : [];
  return { title: clip(str(raw.title), 40), subtitle: clip(str(raw.subtitle), 90), nodes, edges, groups, ignore };
}
