import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_URL, VERSION } from "./meta.js";
import { renderSvg } from "./render.js";
import { drift } from "./drift.js";
import { htmlPage } from "./html.js";
import { impact } from "./impact.js";
import { activity, activityOverlay, gitLog, ownership, readCodeowners, teamOverlay } from "./insights.js";
import { serve } from "./mcp.js";
import { toMermaid } from "./mermaid.js";
import type { Overlay, ThemeName } from "./render.js";
import type { Scene } from "./scene.js";
import { LocalRepo } from "./repo.js";
import { scan } from "./scan.js";
import { SceneError, parseScene } from "./scene.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/** skills/repoland/SKILL.md ships at the package root: ../../ from dist/src (built), ../ from src (tests). */
const SKILL_SRC = [resolve(HERE, "../../skills/repoland/SKILL.md"), resolve(HERE, "../skills/repoland/SKILL.md")].find((p) => existsSync(p)) ?? "";
const DEFAULT_SCENE = "repoland.json";

const HELP = `repoland: turn a codebase into an isometric illustration of how it works.

Quick start (Claude Code)
  npx repoland skill          install the agent skill into this project (.claude/skills/repoland)
  then ask your agent:        "map this repo with repoland"

Commands
  repoland [scene.json]       render a scene (default ${DEFAULT_SCENE}) to an SVG next to it
  repoland check [scene.json] validate, and if parts declare paths, check the map still matches the code (exit 1 on drift)
  repoland impact [scene.json] light up the parts a change touches and what depends on them (--base <ref>, --files a,b, --md)
  repoland skill [--global]   install the skill (--global: ~/.claude/skills) or --print it
  repoland export --mermaid   print the map as a Mermaid flowchart (GitHub, Notion and docs render it)
  repoland mcp                MCP server for agents: who owns a file, what depends on a part, impact, drift
                              (Claude Code: claude mcp add repoland -- npx -y repoland mcp)
  repoland example            write an example ${DEFAULT_SCENE} to start from
  repoland scan [dir]         draft ${DEFAULT_SCENE} from compose files, workspaces and dependencies (no LLM)

Options
  -o, --out <file>   output path (SVG for render, JSON for scan)
  --force            let scan overwrite an existing scene
  --max <n>          most parts scan keeps (default 16, up to 30)
  --repo <dir>       repository root for check/impact (default: current directory)
  --no-drift         check: validate the scene only (e.g. maps of other repos)
  --base <ref>       impact: compare against this git ref (default origin/main, main or HEAD~1)
  --files <a,b>      impact: use these changed files instead of git
  --md               impact: print a Markdown summary (for PR comments)
  --html             write an interactive 3D page (single self-contained .html) instead of an SVG
  --color <mode>     kind (default), activity (git commits per part, --days N, default 90) or team (CODEOWNERS)
  --theme <t>        light (default), dark, or both (writes name.svg + name-dark.svg and prints a <picture> snippet)
  --watch            re-render whenever the scene file changes
  --static           no pipe animation
  --no-credit        hide the "made with repoland" line
  -h, --help         -v, --version

Other agents (Codex, Cursor, …): run \`repoland skill --print\` and give them the text.
Docs: ${REPO_URL}`;

export const EXAMPLE = {
  title: "acme-shop",
  subtitle: "A small store: web app, API, jobs and payments",
  nodes: [
    { id: "user", label: "Shopper", kind: "user" },
    { id: "web", label: "Storefront", kind: "frontend", note: "Next.js" },
    { id: "api", label: "API", kind: "service", note: "Node + Fastify" },
    { id: "db", label: "Orders DB", kind: "database", note: "Postgres" },
    { id: "queue", label: "Jobs", kind: "queue", note: "BullMQ" },
    { id: "worker", label: "Fulfilment", kind: "worker", note: "emails, invoices" },
    { id: "stripe", label: "Stripe", kind: "external" },
  ],
  edges: [
    { from: "user", to: "web", label: "browses" },
    { from: "web", to: "api", label: "REST" },
    { from: "api", to: "db", label: "SQL" },
    { from: "api", to: "queue", label: "enqueue" },
    { from: "queue", to: "worker" },
    { from: "api", to: "stripe", label: "payments" },
  ],
};

interface Args {
  cmd: "render" | "check" | "skill" | "example" | "scan" | "impact" | "export" | "mcp" | "help" | "version";
  file: string;
  out?: string;
  animate: boolean;
  credit: boolean;
  global: boolean;
  print: boolean;
  force: boolean;
  max?: number;
  repo?: string;
  base?: string;
  files?: string[];
  md: boolean;
  html: boolean;
  drift: boolean;
  color: "kind" | "activity" | "team";
  days: number;
  theme: ThemeName | "both";
  watch: boolean;
  mermaid: boolean;
}

export function parseArgs(argv: string[]): Args {
  const a: Args = { cmd: "render", file: DEFAULT_SCENE, animate: true, credit: true, global: false, print: false, force: false, md: false, html: false, drift: true, color: "kind", days: 90, theme: "light", watch: false, mermaid: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!;
    if (x === "-o" || x === "--out") a.out = argv[++i];
    else if (x === "--static") a.animate = false;
    else if (x === "--no-credit") a.credit = false;
    else if (x === "--global") a.global = true;
    else if (x === "--print") a.print = true;
    else if (x === "--force") a.force = true;
    else if (x === "--max") a.max = Number(argv[++i]);
    else if (x === "--repo") a.repo = argv[++i];
    else if (x === "--base") a.base = argv[++i];
    else if (x === "--files") a.files = (argv[++i] ?? "").split(",").map((f) => f.trim()).filter(Boolean);
    else if (x === "--md") a.md = true;
    else if (x === "--html") a.html = true;
    else if (x === "--no-drift") a.drift = false;
    else if (x === "--color") {
      const v = argv[++i];
      if (v !== "kind" && v !== "activity" && v !== "team") throw new Error("--color must be kind, activity or team");
      a.color = v;
    } else if (x === "--days") a.days = Math.max(1, Number(argv[++i]) || 90);
    else if (x === "--theme") {
      const v = argv[++i];
      if (v !== "light" && v !== "dark" && v !== "both") throw new Error("--theme must be light, dark or both");
      a.theme = v;
    } else if (x === "--watch") a.watch = true;
    else if (x === "--mermaid") a.mermaid = true;
    else if (x === "-h" || x === "--help") a.cmd = "help";
    else if (x === "-v" || x === "--version") a.cmd = "version";
    else if (x.startsWith("-")) throw new Error(`Unknown option ${x}. Try --help.`);
    else rest.push(x);
  }
  if (a.cmd === "help" || a.cmd === "version") return a;
  if (["check", "skill", "example", "scan", "impact", "export", "mcp"].includes(rest[0] ?? "")) a.cmd = rest.shift() as Args["cmd"];
  if (a.cmd === "scan") {
    a.file = rest[0] ?? ".";
    return a;
  }
  if (rest[0]) a.file = rest[0];
  return a;
}

export function outPath(file: string, out?: string, ext = ".svg"): string {
  return out ?? `${file.replace(/\.json$/i, "")}${ext}`;
}

/** The prebuilt 3D viewer (dist/viewer/repoland-viewer.js), shipped in the npm package. */
function viewerBundle(): string {
  const p = [resolve(HERE, "../viewer/repoland-viewer.js"), resolve(HERE, "../dist/viewer/repoland-viewer.js")].find((x) => existsSync(x));
  if (!p) throw new Error("3D viewer bundle not found; run `npm run build` (it builds dist/viewer).");
  return readFileSync(p, "utf8");
}

export function main(argv: string[], cwd = process.cwd(), home = homedir()): number {
  const a = parseArgs(argv);
  const log = (s: string) => console.log(s);
  switch (a.cmd) {
    case "help":
      log(HELP);
      return 0;
    case "version":
      log(VERSION);
      return 0;
    case "example": {
      const p = resolve(cwd, a.file);
      if (existsSync(p)) throw new Error(`${a.file} already exists; not overwriting it.`);
      writeFileSync(p, `${JSON.stringify(EXAMPLE, null, 2)}\n`);
      log(`Wrote ${a.file}. Edit it, then run: npx repoland ${a.file}`);
      return 0;
    }
    case "mcp":
      serve(cwd, a.file, a.repo ?? ".");
      return 0;
    case "scan": {
      const repo = new LocalRepo(resolve(cwd, a.file));
      const scene = scan(repo, { maxParts: a.max });
      const out = resolve(cwd, a.out ?? join(a.file, DEFAULT_SCENE));
      if (existsSync(out) && !a.force) throw new Error(`${a.out ?? join(a.file, DEFAULT_SCENE)} already exists; use --force to replace it.`);
      writeFileSync(out, `${JSON.stringify(scene, null, 2)}\n`);
      const kinds = new Map<string, number>();
      for (const n of scene.nodes) kinds.set(n.kind, (kinds.get(n.kind) ?? 0) + 1);
      const summary = [...kinds].map(([k, n]) => `${n} ${k}`).join(", ");
      log(`Drafted ${scene.nodes.length} parts and ${scene.edges.length} flows from ${repo.files().length} files: ${summary}.`);
      log("Review it (or ask your agent to refine it with the repoland skill), then run: npx repoland");
      return 0;
    }
    case "skill": {
      const text = readFileSync(SKILL_SRC, "utf8");
      if (a.print) {
        log(text);
        return 0;
      }
      const dir = a.global ? join(home, ".claude", "skills", "repoland") : join(cwd, ".claude", "skills", "repoland");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), text);
      log(`Installed the repoland skill at ${dir}/SKILL.md\nNow ask your agent: "map this repo with repoland"`);
      return 0;
    }
    default: {
      const p = resolve(cwd, a.file);
      if (!existsSync(p)) {
        log(`No ${a.file} here yet.\n\n${HELP}`);
        return a.file === DEFAULT_SCENE ? 0 : 1;
      }
      let scene: ReturnType<typeof parseScene>;
      try {
        scene = parseScene(readFileSync(p, "utf8"));
      } catch (e) {
        if (e instanceof SceneError) {
          console.error(`${a.file}: ${e.message}`);
          return 1;
        }
        throw e;
      }
      const repoDir = resolve(cwd, a.repo ?? ".");
      if (a.cmd === "check") {
        log(`${a.file} is valid: ${scene.nodes.length} parts, ${scene.edges.length} flows.`);
        if (!a.drift) return 0;
        if (!scene.nodes.some((n) => n.paths.length)) {
          log("No part declares `paths`, so drift can't be checked. Add paths (or run `repoland scan`) to keep the map honest in CI.");
          return 0;
        }
        const d = drift(scene, new LocalRepo(repoDir));
        for (const s of d.stale) log(`  stale:     "${s.label}" owns ${s.paths.join(", ")}, which matches no file any more`);
        for (const u of d.uncovered) log(`  not shown: ${u.kind} "${u.label}"${u.paths.length ? ` (${u.paths.join(", ")})` : ""} exists in the repo but not on the map`);
        log(d.ok ? "The map matches the code." : `Map drift: ${d.stale.length} stale, ${d.uncovered.length} missing. Update ${a.file} (your agent can, with the repoland skill).`);
        return d.ok ? 0 : 1;
      }
      if (a.cmd === "impact") {
        const files = a.files ?? changedFiles(repoDir, a.base);
        const r = impact(scene, files);
        const target = a.out ?? (a.html ? "repoland-impact.html" : "repoland-impact.svg");
        const highlight = { changed: r.changed, affected: r.affected };
        writeFileSync(resolve(cwd, target), a.html ? htmlPage(scene, viewerBundle(), { highlight }) : renderSvg(scene, { animate: a.animate, credit: a.credit, highlight }));
        const name = (id: string) => scene.nodes.find((n) => n.id === id)?.label ?? id;
        if (a.md) {
          log("### repoland: what this change touches");
          log(r.changed.length ? `**Changed:** ${r.changed.map(name).join(", ")}` : "**Changed:** no mapped part");
          if (r.affected.length) log(`**Affected (depends on a changed part):** ${r.affected.map(name).join(", ")}`);
          if (r.unmapped.length) log(`${r.unmapped.length} changed file(s) are not owned by any part on the map.`);
        } else {
          log(`${files.length} changed file(s): ${r.changed.length} part(s) changed, ${r.affected.length} affected, ${r.unmapped.length} file(s) unmapped -> ${target}`);
        }
        return 0;
      }
      if (a.cmd === "export") {
        if (!a.mermaid) throw new Error("export needs a format: --mermaid");
        const md = toMermaid(scene);
        if (a.out) writeFileSync(resolve(cwd, a.out), md);
        else process.stdout.write(md);
        return 0;
      }
      const draw = (sc: Scene) => {
        const overlays = insightOverlays(sc, repoDir, a.days, a.html ? "all" : a.color);
        if (a.html) {
          const target = a.out ?? outPath(a.file, undefined, ".html");
          writeFileSync(resolve(cwd, target), htmlPage(sc, viewerBundle(), { overlays, color: a.color }));
          log(`Drew ${sc.nodes.length} parts and ${sc.edges.length} pipes -> ${target} (open it in a browser: drag to orbit, click a building)`);
          return;
        }
        const overlay = a.color === "kind" ? undefined : overlays[a.color];
        if (a.color !== "kind" && !overlay) throw new Error(a.color === "team" ? "--color team needs a CODEOWNERS file and parts with paths." : "--color activity needs git history and parts with paths.");
        const themes: ThemeName[] = a.theme === "both" ? ["light", "dark"] : [a.theme];
        for (const th of themes) {
          const base = a.out ?? outPath(a.file);
          const target = th === "dark" && a.theme === "both" ? base.replace(/\.svg$/i, "-dark.svg") : base;
          writeFileSync(resolve(cwd, target), renderSvg(sc, { animate: a.animate, credit: a.credit, theme: th, overlay }));
          log(`Drew ${sc.nodes.length} parts and ${sc.edges.length} pipes -> ${target}`);
        }
        if (a.theme === "both") {
          const light = a.out ?? outPath(a.file);
          log(`\nFor your README (follows the reader's light/dark setting):\n<picture>\n  <source media="(prefers-color-scheme: dark)" srcset="${light.replace(/\.svg$/i, "-dark.svg")}">\n  <img alt="${sc.title} architecture map" src="${light}">\n</picture>`);
        }
      };
      draw(scene);
      if (a.watch) {
        log(`Watching ${a.file} (Ctrl+C to stop)…`);
        let timer: NodeJS.Timeout | undefined;
        watch(p, () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            try {
              draw(parseScene(readFileSync(p, "utf8")));
            } catch (e) {
              console.error((e as Error).message);
            }
          }, 120);
        });
      }
      return 0;
    }
  }
}

/** Files changed between a base ref and the working tree. */
export function changedFiles(dir: string, base?: string): string[] {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const ref =
    base ??
    ["origin/main", "main", "origin/master", "master", "HEAD~1"].find((r) => {
      try {
        git("rev-parse", "--verify", "--quiet", r);
        return true;
      } catch {
        return false;
      }
    });
  if (!ref) throw new Error("No git base found; pass --base <ref> or --files a,b.");
  let mergeBase = ref;
  try {
    mergeBase = git("merge-base", ref, "HEAD");
  } catch {
    // unrelated history or shallow clone: compare directly
  }
  const out = new Set([...git("diff", "--name-only", mergeBase).split("\n"), ...git("ls-files", "--others", "--exclude-standard").split("\n")]);
  out.delete("");
  return [...out];
}

/** Activity (git) and team (CODEOWNERS) overlays, when the data exists. "all" computes whatever is available. */
function insightOverlays(scene: Scene, repoDir: string, days: number, want: "kind" | "activity" | "team" | "all"): { activity?: Overlay; team?: Overlay } {
  const out: { activity?: Overlay; team?: Overlay } = {};
  if (!scene.nodes.some((n) => n.paths.length)) return out;
  if (want === "activity" || want === "all") {
    try {
      out.activity = activityOverlay(scene, activity(scene, gitLog(repoDir, days)), days);
    } catch {
      // not a git repo: no activity overlay
    }
  }
  if (want === "team" || want === "all") {
    const repo = new LocalRepo(repoDir);
    const rules = readCodeowners(repo);
    if (rules.length) out.team = teamOverlay(scene, ownership(scene, repo.files(), rules));
  }
  return out;
}
