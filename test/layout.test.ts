import { describe, expect, it } from "vitest";
import { CELL, FOOT, layout } from "../src/layout.js";
import { parseScene } from "../src/scene.js";

const scene = (edges: [string, string][], ids?: string[]) => {
  const all = ids ?? [...new Set(edges.flat())];
  return parseScene({
    title: "t",
    nodes: all.map((id) => ({ id, label: id.toUpperCase(), kind: "service" })),
    edges: edges.map(([from, to]) => ({ from, to })),
  });
};

describe("layout", () => {
  it("places sources before their targets (flow goes along +x)", () => {
    const l = layout(scene([["a", "b"], ["b", "c"], ["a", "c"]]));
    const x = Object.fromEntries(l.nodes.map((n) => [n.node.id, n.gx]));
    expect(x.a).toBeLessThan(x.b!);
    expect(x.b).toBeLessThan(x.c!);
  });
  it("never puts two buildings on overlapping footprints", () => {
    const l = layout(scene([["u", "a"], ["u", "b"], ["u", "c"], ["a", "d"], ["b", "d"], ["c", "d"], ["d", "e"]], ["u", "a", "b", "c", "d", "e", "lonely"]));
    for (const p of l.nodes)
      for (const q of l.nodes)
        if (p !== q) expect(Math.abs(p.gx - q.gx) >= FOOT || Math.abs(p.gy - q.gy) >= FOOT, `${p.node.id}/${q.node.id}`).toBe(true);
  });
  it("is deterministic", () => {
    const s = scene([["a", "b"], ["b", "c"], ["c", "a"], ["a", "d"]]);
    expect(JSON.stringify(layout(s))).toBe(JSON.stringify(layout(s)));
  });
  it("survives cycles and routes every edge", () => {
    const l = layout(scene([["a", "b"], ["b", "c"], ["c", "a"]]));
    expect(l.nodes).toHaveLength(3);
    expect(l.edges).toHaveLength(3);
    for (const e of l.edges) expect(e.points.length).toBeGreaterThanOrEqual(2);
  });
  it("routes pipes with right angles only (axis-aligned segments)", () => {
    const l = layout(scene([["a", "b"], ["a", "c"], ["c", "d"], ["d", "b"]]));
    for (const e of l.edges)
      for (let i = 1; i < e.points.length; i++) {
        const [p, q] = [e.points[i - 1]!, e.points[i]!];
        expect(p[0] === q[0] || p[1] === q[1]).toBe(true);
      }
  });
  it("puts isolated nodes on the map too", () => {
    const l = layout(scene([["a", "b"]], ["a", "b", "x", "y"]));
    expect(l.nodes.map((n) => n.node.id).sort()).toEqual(["a", "b", "x", "y"]);
  });
  it("reports grid bounds that contain every footprint", () => {
    const l = layout(scene([["a", "b"], ["a", "c"]]));
    for (const n of l.nodes) {
      expect(n.gx).toBeGreaterThanOrEqual(l.bounds.minX);
      expect(n.gy + FOOT).toBeLessThanOrEqual(l.bounds.maxY);
    }
    expect(CELL).toBeGreaterThan(FOOT);
  });
});
