/** Does the map still match the code? Parts whose code is gone, and code that has no part. */
import { globToRegExp, matchAny } from "./glob.js";
import type { Repo } from "./repo.js";
import { scan } from "./scan.js";
import type { Kind, Scene } from "./scene.js";

export interface DriftReport {
  /** Parts with `paths` that match no file any more. */
  stale: { id: string; label: string; paths: string[] }[];
  /** Parts the repo declares (workspace packages, compose services, crates) that the map doesn't show. */
  uncovered: { label: string; kind: Kind; paths: string[] }[];
  ok: boolean;
}

const INFRA_KINDS = new Set<Kind>(["database", "cache", "queue", "storage", "external", "model"]);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function drift(scene: Scene, repo: Repo): DriftReport {
  const files = repo.files();
  const stale = scene.nodes
    .filter((n) => n.paths.length && !files.some((f) => matchAny(n.paths, f)))
    .map((n) => ({ id: n.id, label: n.label, paths: n.paths }));

  const allGlobs = scene.nodes.flatMap((n) => n.paths);
  const names = new Set(scene.nodes.flatMap((n) => [norm(n.id), norm(n.label)]));
  const kinds = new Set(scene.nodes.map((n) => n.kind));
  const uncovered = scan(repo, { maxParts: 30 })
    .nodes.filter((d) => d.kind !== "user")
    .filter((d) => {
      if (names.has(norm(d.id)) || names.has(norm(d.label))) return false;
      if (scene.ignore.some((x) => norm(x) === norm(d.label) || norm(x) === norm(d.id))) return false;
      if (d.paths.length && scene.ignore.some((g) => d.paths.some((p) => p === g || globToRegExp(g).test(p.replace(/\/\*\*$/, ""))))) return false;
      if (d.paths.length) {
        // covered when any of its files is owned by some part on the map
        const own = files.filter((f) => matchAny(d.paths, f));
        return !own.some((f) => matchAny(allGlobs, f));
      }
      // infrastructure (no code of its own): covered if the map shows anything of that kind.
      // Code-like parts without paths (e.g. scan's placeholder for a repo with no manifests) can't be attributed.
      return INFRA_KINDS.has(d.kind) && !kinds.has(d.kind);
    })
    .map((d) => ({ label: d.label, kind: d.kind, paths: d.paths }));

  return { stale, uncovered, ok: !stale.length && !uncovered.length };
}
