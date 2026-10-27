import type { Scene, SceneEdge, SceneNode } from "./scene.js";

/** Grid units between neighbouring buildings, and the square footprint of one building. */
export const CELL = 5;
/** Spacing between buildings in the same column (tighter than between columns: rows read as a street). */
export const ROW = 3.6;
export const FOOT = 2;

export type Pt = [number, number];

export interface PlacedNode {
  node: SceneNode;
  layer: number;
  order: number;
  /** Footprint origin on the ground grid; the building covers [gx, gx+FOOT] x [gy, gy+FOOT]. */
  gx: number;
  gy: number;
}

export interface RoutedEdge {
  edge: SceneEdge;
  /** Axis-aligned polyline on the ground grid. */
  points: Pt[];
  back: boolean;
}

export interface Layout {
  nodes: PlacedNode[];
  edges: RoutedEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** Edges that close a cycle, found by DFS in input order (deterministic). */
function backEdges(scene: Scene): Set<number> {
  const out = new Map<string, number[]>();
  scene.edges.forEach((e, i) => out.set(e.from, [...(out.get(e.from) ?? []), i]));
  const state = new Map<string, 1 | 2>();
  const back = new Set<number>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const i of out.get(id) ?? []) {
      const to = scene.edges[i]!.to;
      if (state.get(to) === 1) back.add(i);
      else if (!state.has(to)) visit(to);
    }
    state.set(id, 2);
  };
  for (const n of scene.nodes) if (!state.has(n.id)) visit(n.id);
  return back;
}

export function layout(scene: Scene): Layout {
  const back = backEdges(scene);
  const forward = scene.edges.filter((_, i) => !back.has(i));
  const ids = scene.nodes.map((n) => n.id);
  const degree = new Map(ids.map((id) => [id, 0]));
  for (const e of scene.edges) {
    degree.set(e.from, degree.get(e.from)! + 1);
    degree.set(e.to, degree.get(e.to)! + 1);
  }

  // longest-path layering over the acyclic part
  const layer = new Map(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false;
    for (const e of forward) {
      if (layer.get(e.to)! < layer.get(e.from)! + 1) {
        layer.set(e.to, layer.get(e.from)! + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const maxLayer = Math.max(0, ...ids.filter((id) => degree.get(id)! > 0).map((id) => layer.get(id)!));
  // isolated nodes get their own column at the end, so they don't crowd the flow
  const isolated = ids.filter((id) => degree.get(id) === 0);
  const hasFlow = isolated.length < ids.length;
  for (const id of isolated) layer.set(id, hasFlow ? maxLayer + 1 : 0);

  // order within layers: input order, then barycenter sweeps to reduce crossings
  const layers: string[][] = [];
  for (const id of ids) {
    const li = layer.get(id)!;
    if (!layers[li]) layers[li] = [];
    layers[li].push(id);
  }
  const pos = new Map<string, number>();
  for (const l of layers) for (const [i, id] of (l ?? []).entries()) pos.set(id, i);
  const neighbours = (id: string, dir: "in" | "out") =>
    forward.filter((e) => (dir === "in" ? e.to === id : e.from === id)).map((e) => (dir === "in" ? e.from : e.to));
  for (let sweep = 0; sweep < 6; sweep++) {
    const dir = sweep % 2 === 0 ? "in" : "out";
    const order = dir === "in" ? layers.keys() : [...layers.keys()].reverse();
    for (const li of order) {
      const l = layers[li];
      if (!l) continue;
      const bary = new Map(
        l.map((id) => {
          const ns = neighbours(id, dir);
          return [id, ns.length ? ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length : pos.get(id)!];
        }),
      );
      l.sort((a, b) => bary.get(a)! - bary.get(b)! || ids.indexOf(a) - ids.indexOf(b));
      l.forEach((id, i) => pos.set(id, i));
    }
  }

  const placed = new Map<string, PlacedNode>();
  layers.forEach((l, li) => {
    l?.forEach((id, i) => {
      const node = scene.nodes.find((n) => n.id === id)!;
      // centre each column on the y axis so the map stays balanced
      const gy = Math.round((i - (l.length - 1) / 2) * ROW * 2) / 2;
      placed.set(id, { node, layer: li, order: i, gx: li * CELL, gy });
    });
  });

  // route pipes: leave from the right face, enter the left face; spread parallel pipes apart
  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();
  const edges: RoutedEdge[] = scene.edges.map((edge, i) => {
    const a = placed.get(edge.from)!;
    const b = placed.get(edge.to)!;
    const oi = outCount.get(edge.from) ?? 0;
    const ii = inCount.get(edge.to) ?? 0;
    outCount.set(edge.from, oi + 1);
    inCount.set(edge.to, ii + 1);
    const fan = (k: number) => FOOT / 2 + ((k % 3) - 1) * 0.5;
    if (b.gx > a.gx) {
      const sy = a.gy + fan(oi);
      const ty = b.gy + fan(ii);
      const midX = a.gx + FOOT + (b.gx - a.gx - FOOT) / 2 + ((i % 3) - 1) * 0.35;
      const pts: Pt[] = [[a.gx + FOOT, sy], [midX, sy], [midX, ty], [b.gx, ty]];
      return { edge, points: dedupe(pts), back: back.has(i) };
    }
    // backward / same-column edge: loop around underneath both buildings
    const lane = Math.max(a.gy, b.gy) + FOOT + 1.2 + (i % 3) * 0.4;
    const pts: Pt[] = [[a.gx + FOOT / 2, a.gy + FOOT], [a.gx + FOOT / 2, lane], [b.gx + FOOT / 2, lane], [b.gx + FOOT / 2, b.gy + FOOT]];
    return { edge, points: dedupe(pts), back: true };
  });

  const xs = [...placed.values()].flatMap((p) => [p.gx, p.gx + FOOT]).concat(edges.flatMap((e) => e.points.map((p) => p[0])));
  const ys = [...placed.values()].flatMap((p) => [p.gy, p.gy + FOOT]).concat(edges.flatMap((e) => e.points.map((p) => p[1])));
  return {
    nodes: [...placed.values()],
    edges,
    bounds: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
  };
}

function dedupe(pts: Pt[]): Pt[] {
  return pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1]![0] || p[1] !== pts[i - 1]![1]);
}
