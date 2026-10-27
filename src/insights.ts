/** Activity (git history) and ownership (CODEOWNERS) per part, plus overlays that colour the map by them. */
import { execFileSync } from "node:child_process";
import { globToRegExp, matchAny } from "./glob.js";
import type { Overlay } from "./render.js";
import type { Repo } from "./repo.js";
import type { Scene } from "./scene.js";

export interface Commit {
  hash: string;
  author: string;
  date: string;
  files: string[];
}

const RS = "\u001e";
const US = "\u001f";

/** Parse `git log --name-only --format=%x1e%H%x1f%an%x1f%cs`. */
export function parseGitLog(text: string): Commit[] {
  return text
    .split(RS)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [head = "", ...files] = chunk.split("\n");
      const [hash = "", author = "", date = ""] = head.split(US);
      return { hash, author, date, files: files.map((f) => f.trim()).filter(Boolean) };
    });
}

export function gitLog(dir: string, days: number): Commit[] {
  const out = execFileSync("git", ["log", `--since=${days} days ago`, "--no-merges", "--name-only", `--format=${RS}%H${US}%an${US}%cs`], {
    cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 512 * 1024 * 1024,
  });
  return parseGitLog(out);
}

export interface Activity {
  commits: number;
  authors: number;
  lastChange: string;
}

/** Commits and distinct authors touching each part's files. Parts without paths are absent from the result. */
export function activity(scene: Scene, commits: Commit[]): Record<string, Activity> {
  const out: Record<string, Activity> = {};
  const authors: Record<string, Set<string>> = {};
  for (const n of scene.nodes) {
    if (!n.paths.length) continue;
    out[n.id] = { commits: 0, authors: 0, lastChange: "" };
    authors[n.id] = new Set();
  }
  for (const c of commits)
    for (const n of scene.nodes) {
      if (!n.paths.length || !c.files.some((f) => matchAny(n.paths, f))) continue;
      const a = out[n.id]!;
      a.commits++;
      authors[n.id]!.add(c.author);
      if (c.date > a.lastChange) a.lastChange = c.date;
    }
  for (const id of Object.keys(out)) out[id]!.authors = authors[id]!.size;
  return out;
}

// ---------- CODEOWNERS ----------

export interface OwnerRule {
  globs: string[];
  owners: string[];
}

/** CODEOWNERS uses gitignore-style patterns; the last matching rule wins. */
export function parseCodeowners(text: string): OwnerRule[] {
  const rules: OwnerRule[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;
    const [pattern = "", ...owners] = line.split(/\s+/);
    rules.push({ globs: codeownersGlobs(pattern), owners });
  }
  return rules;
}

export function codeownersGlobs(pattern: string): string[] {
  let p = pattern;
  if (p === "*") return ["**"];
  const anchored = p.startsWith("/") || p.slice(0, -1).includes("/");
  p = p.replace(/^\//, "");
  const dirOnly = p.endsWith("/");
  p = p.replace(/\/$/, "");
  const base = anchored ? p : `**/${p}`;
  return dirOnly ? [`${base}/**`] : [base, `${base}/**`];
}

export function ownersOf(rules: OwnerRule[], file: string): string[] {
  for (let i = rules.length - 1; i >= 0; i--) if (rules[i]!.globs.some((g) => globToRegExp(g).test(file))) return rules[i]!.owners;
  return [];
}

export function readCodeowners(repo: Repo): OwnerRule[] {
  for (const p of [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS", ".gitlab/CODEOWNERS"]) {
    const t = repo.read(p);
    if (t) return parseCodeowners(t);
  }
  return [];
}

/** The owner set covering most of each part's files ("" when nobody owns them). */
export function ownership(scene: Scene, files: string[], rules: OwnerRule[]): Record<string, { owners: string[]; share: number }> {
  const out: Record<string, { owners: string[]; share: number }> = {};
  for (const n of scene.nodes) {
    if (!n.paths.length) continue;
    const mine = files.filter((f) => matchAny(n.paths, f));
    const tally = new Map<string, number>();
    for (const f of mine) {
      const key = ownersOf(rules, f).join(" ");
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    const [best = "", count = 0] = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [];
    out[n.id] = { owners: best ? best.split(" ") : [], share: mine.length ? count / mine.length : 0 };
  }
  return out;
}

// ---------- overlays ----------

/** Sequential ramp (one hue, light -> dark) for activity. */
export const HEAT = ["#fbe3cf", "#f6b98b", "#ee8b4f", "#d9602b", "#a84118"];
/** Fixed categorical order for teams; folds to "other teams" past the last slot. */
export const TEAM_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
export const UNMAPPED = "#9aa6b8";

export function activityOverlay(scene: Scene, act: Record<string, Activity>, days: number): Overlay {
  const max = Math.max(1, ...Object.values(act).map((a) => a.commits));
  const active = Object.values(act).map((a) => a.commits).filter((c) => c > 0).sort((x, y) => x - y);
  /** how many active parts have fewer commits (ties share a step); the busiest lands on the darkest step */
  const busier = (c: number) => (c === max ? active.length : active.filter((x) => x < c).length);
  const colors: Record<string, string> = {};
  const notes: Record<string, string> = {};
  for (const n of scene.nodes) {
    const a = act[n.id];
    if (!a) {
      colors[n.id] = UNMAPPED;
      continue;
    }
    // rank against the other parts so the ramp spreads evenly (raw counts let one busy part wash out the rest)
    const step = a.commits === 0 ? 0 : 1 + Math.min(3, Math.floor((busier(a.commits) / Math.max(1, active.length)) * 4));
    colors[n.id] = HEAT[step]!;
    notes[n.id] = a.commits ? `${a.commits} commit${a.commits > 1 ? "s" : ""}, ${a.authors} ${a.authors > 1 ? "people" : "person"}` : `no commits in ${days} days`;
  }
  return {
    colors, notes,
    legend: [
      { label: `quiet (last ${days} days)`, color: HEAT[0]! },
      { label: "busy", color: HEAT[2]! },
      { label: `busiest (${max} commits)`, color: HEAT[4]! },
      ...(scene.nodes.some((n) => !act[n.id]) ? [{ label: "no code mapped", color: UNMAPPED }] : []),
    ],
  };
}

export function teamOverlay(scene: Scene, own: Record<string, { owners: string[] }>): Overlay {
  const teams = [...new Set(Object.values(own).map((o) => o.owners.join(" ")).filter(Boolean))].sort();
  const slots = teams.slice(0, TEAM_COLORS.length);
  const colors: Record<string, string> = {};
  const notes: Record<string, string> = {};
  for (const n of scene.nodes) {
    const o = own[n.id];
    const key = o?.owners.join(" ") ?? "";
    const i = slots.indexOf(key);
    colors[n.id] = !o || !key ? UNMAPPED : i >= 0 ? TEAM_COLORS[i]! : "#5b6577";
    if (o) notes[n.id] = key || "no owner";
  }
  return {
    colors, notes,
    legend: [
      ...slots.map((t, i) => ({ label: t, color: TEAM_COLORS[i]! })),
      ...(teams.length > slots.length ? [{ label: "other teams", color: "#5b6577" }] : []),
      ...(scene.nodes.some((n) => !own[n.id]?.owners.length) ? [{ label: "no owner / no code", color: UNMAPPED }] : []),
    ],
  };
}
