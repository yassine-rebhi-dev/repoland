import { describe, expect, it } from "vitest";
import { KINDS, parseScene } from "../src/scene.js";

const ok = {
  title: "shop",
  nodes: [
    { id: "web", label: "Storefront", kind: "frontend" },
    { id: "api", label: "API", kind: "service", note: "Node + Express" },
    { id: "db", label: "Orders", kind: "database" },
  ],
  edges: [
    { from: "web", to: "api", label: "REST" },
    { from: "api", to: "db" },
  ],
};

describe("parseScene", () => {
  it("accepts a valid scene and fills defaults", () => {
    const s = parseScene(ok);
    expect(s.nodes).toHaveLength(3);
    expect(s.edges[1]!.label).toBe("");
    expect(s.subtitle).toBe("");
  });
  it("accepts a JSON string", () => {
    expect(parseScene(JSON.stringify(ok)).title).toBe("shop");
  });
  it("reports every problem with a path, not just the first", () => {
    const bad = {
      nodes: [
        { id: "a", label: "A", kind: "spaceship" },
        { id: "a", label: "", kind: "service" },
      ],
      edges: [{ from: "a", to: "ghost" }],
    };
    expect(() => parseScene(bad)).toThrowError(/title[\s\S]*nodes\[0\]\.kind[\s\S]*nodes\[1\]\.id[\s\S]*nodes\[1\]\.label[\s\S]*edges\[0\]\.to/);
  });
  it("names the allowed kinds in the error", () => {
    expect(() => parseScene({ ...ok, nodes: [{ id: "x", label: "X", kind: "blob" }], edges: [] })).toThrowError(new RegExp(KINDS.slice(0, 3).join(".*")));
  });
  it("rejects too many nodes with advice", () => {
    const nodes = Array.from({ length: 31 }, (_, i) => ({ id: `n${i}`, label: `N${i}`, kind: "service" }));
    expect(() => parseScene({ title: "big", nodes, edges: [] })).toThrowError(/at most 30/);
  });
  it("rejects self-loops and invalid JSON clearly", () => {
    expect(() => parseScene({ ...ok, edges: [{ from: "api", to: "api" }] })).toThrowError(/itself/);
    expect(() => parseScene("{ nope")).toThrowError(/not valid JSON/);
  });
  it("truncates over-long labels rather than failing", () => {
    const s = parseScene({ ...ok, nodes: [{ id: "x", label: "A".repeat(80), kind: "service" }], edges: [] });
    expect(s.nodes[0]!.label.length).toBeLessThanOrEqual(28);
  });
});

describe("scene v2 fields", () => {
  const v2 = {
    title: "shop",
    groups: [{ id: "edge", label: "Edge" }, { id: "data", label: "Data layer" }],
    nodes: [
      { id: "web", label: "Web", kind: "frontend", group: "edge", paths: ["apps/web/**"], description: "Customer storefront." },
      { id: "db", label: "DB", kind: "database", group: "data" },
    ],
    edges: [{ from: "web", to: "db" }],
  };
  it("keeps paths, description and groups", () => {
    const s = parseScene(v2);
    expect(s.nodes[0]).toMatchObject({ paths: ["apps/web/**"], description: "Customer storefront.", group: "edge" });
    expect(s.groups.map((g) => g.id)).toEqual(["edge", "data"]);
  });
  it("v1 scenes still parse with empty defaults", () => {
    const s = parseScene(ok);
    expect(s.groups).toEqual([]);
    expect(s.nodes[0]).toMatchObject({ paths: [], description: "", group: "" });
  });
  it("creates a group on the fly when a node names one that isn't declared", () => {
    const s = parseScene({ ...v2, groups: undefined });
    expect(s.groups.map((g) => g.label)).toEqual(["edge", "data"]);
  });
  it("rejects unsafe paths", () => {
    const bad = { ...v2, nodes: [{ id: "x", label: "X", kind: "service", paths: ["/etc/passwd", "../up/**", 7] }] , edges: [] };
    expect(() => parseScene(bad)).toThrowError(/paths\[0\][\s\S]*paths\[1\][\s\S]*paths\[2\]/);
  });
});
