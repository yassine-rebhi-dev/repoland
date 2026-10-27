/** Which parts does a change touch, and what depends on them? */
import { matchAny } from "./glob.js";
import type { Scene } from "./scene.js";

export interface ImpactReport {
  /** Parts that own a changed file. */
  changed: string[];
  /** Parts that call (directly or transitively) a changed part. */
  affected: string[];
  /** Changed files no part owns. */
  unmapped: string[];
}

export function impact(scene: Scene, files: string[]): ImpactReport {
  const changed = scene.nodes.filter((n) => n.paths.length && files.some((f) => matchAny(n.paths, f))).map((n) => n.id);
  const unmapped = files.filter((f) => !scene.nodes.some((n) => n.paths.length && matchAny(n.paths, f)));
  // edges point caller -> callee, so walk them backwards from the changed parts
  const callers = new Map<string, string[]>();
  for (const e of scene.edges) callers.set(e.to, [...(callers.get(e.to) ?? []), e.from]);
  const seen = new Set(changed);
  const queue = [...changed];
  const affected: string[] = [];
  while (queue.length) {
    for (const c of callers.get(queue.shift()!) ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      affected.push(c);
      queue.push(c);
    }
  }
  return { changed, affected, unmapped };
}
