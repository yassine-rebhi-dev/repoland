import { describe, expect, it } from "vitest";
import { KINDS, MAX_NODES, parseScene } from "../src/scene.js";
import { renderSvg, textWidth } from "../src/render.js";

const base = parseScene({
  title: "shop & <co>",
  subtitle: "orders flow",
  nodes: KINDS.map((k, i) => ({ id: `n${i}`, label: `${k} node`, kind: k, note: i % 2 ? "with a note" : "" })),
  edges: KINDS.slice(1).map((_, i) => ({ from: `n${i}`, to: `n${i + 1}`, label: i % 3 ? "" : "calls" })),
});

const cards = (svg: string) =>
  [...svg.matchAll(/data-card="([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)"/g)].map((m) => m.slice(1).map(Number) as [number, number, number, number]);

/** Small seeded PRNG so the fuzz test is reproducible. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("renderSvg", () => {
  it("produces a standalone SVG with every label, escaped", () => {
    const svg = renderSvg(base);
    expect(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\"")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(svg).toContain("shop &amp; &lt;co&gt;");
    for (const k of KINDS) expect(svg).toContain(`${k} node`);
    expect(svg).toContain("calls");
  });
  it("is deterministic", () => {
    expect(renderSvg(base)).toBe(renderSvg(base));
  });
  it("animates pipes by default and can render static", () => {
    expect(renderSvg(base)).toContain("@keyframes");
    expect(renderSvg(base, { animate: false })).not.toContain("@keyframes");
    expect(renderSvg(base)).toContain("prefers-reduced-motion");
  });
  it("credit line can be turned off", () => {
    expect(renderSvg(base)).toContain("made with repoland");
    expect(renderSvg(base, { credit: false })).not.toContain("made with repoland");
  });
  it("fuzz: 200 random scenes render with finite numbers and no overlapping cards", () => {
    const rand = rng(7);
    for (let t = 0; t < 200; t++) {
      const n = 1 + Math.floor(rand() * MAX_NODES);
      const nodes = Array.from({ length: n }, (_, i) => ({
        id: `n${i}`,
        label: "Component ".slice(0, 3 + Math.floor(rand() * 8)) + i,
        kind: KINDS[Math.floor(rand() * KINDS.length)]!,
        note: rand() < 0.5 ? "some technology note" : "",
      }));
      const edges = [];
      for (let k = 0; k < n * 1.4; k++) {
        const a = Math.floor(rand() * n);
        const b = Math.floor(rand() * n);
        if (a !== b) edges.push({ from: `n${a}`, to: `n${b}`, label: rand() < 0.3 ? "data" : "" });
      }
      const svg = renderSvg(parseScene({ title: `fuzz ${t}`, nodes, edges }));
      expect(svg, `scene ${t}`).not.toMatch(/NaN|undefined|Infinity/);
      const cs = cards(svg);
      expect(cs).toHaveLength(n);
      for (let i = 0; i < cs.length; i++)
        for (let j = i + 1; j < cs.length; j++) {
          const [a, b] = [cs[i]!, cs[j]!];
          const hit = a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
          expect(hit, `scene ${t}: cards ${i} and ${j} overlap`).toBe(false);
        }
    }
  });
  it("text width estimate is generous for capitals and CJK", () => {
    expect(textWidth("WWWW", 13, true)).toBeGreaterThan(textWidth("iiii", 13, true) * 2);
    expect(textWidth("数据库", 13, false)).toBeGreaterThanOrEqual(39);
  });
});

describe("gradients", () => {
  it("defines every gradient that a shape references (incl. tinted siblings)", () => {
    const s = parseScene({
      title: "two dbs",
      nodes: [
        { id: "a", label: "A", kind: "database" }, { id: "b", label: "B", kind: "database" }, { id: "c", label: "C", kind: "database" },
        { id: "m", label: "M", kind: "model" }, { id: "n", label: "N", kind: "model" }, { id: "u", label: "U", kind: "user" },
      ],
      edges: [{ from: "u", to: "a" }],
    });
    const svg = renderSvg(s);
    const used = new Set([...svg.matchAll(/url\(#([a-z]+-[0-9a-f]{6})\)/g)].map((m) => m[1]));
    const defined = new Set([...svg.matchAll(/id="([a-z]+-[0-9a-f]{6})"/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(3);
    for (const id of used) expect(defined.has(id), id).toBe(true);
  });
});

describe("impact highlighting", () => {
  it("rings changed and affected parts, fades the rest, and shows a legend", () => {
    const svg = renderSvg(base, { highlight: { changed: ["n3"], affected: ["n2"] } });
    expect(svg).toContain("#e5484d");
    expect(svg).toContain("#f5a524");
    expect(svg).toContain('opacity="0.28"');
    expect(svg).toMatch(/changed \(1\)[\s\S]*affected \(1\)/);
    expect(svg).toContain('class="pulse"');
  });
  it("no highlight option, no fading", () => {
    expect(renderSvg(base)).not.toContain('opacity="0.28"');
  });
});

describe("districts", () => {
  it("draws a labelled zone per group with members", () => {
    const s = parseScene({
      title: "z",
      groups: [{ id: "edge", label: "Edge layer" }, { id: "empty", label: "Nobody" }],
      nodes: [{ id: "a", label: "A", kind: "service", group: "edge" }, { id: "b", label: "B", kind: "database" }],
      edges: [{ from: "a", to: "b" }],
    });
    const svg = renderSvg(s);
    expect(svg).toContain("Edge layer");
    expect(svg).not.toContain("Nobody");
  });
});
