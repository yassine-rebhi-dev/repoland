import { describe, expect, it } from "vitest";
import { HEAT, UNMAPPED, activity, activityOverlay, codeownersGlobs, ownersOf, ownership, parseCodeowners, parseGitLog, teamOverlay } from "../src/insights.js";
import { renderSvg } from "../src/render.js";
import { parseScene } from "../src/scene.js";

const scene = parseScene({
  title: "t",
  nodes: [
    { id: "web", label: "Web", kind: "frontend", paths: ["apps/web/**"] },
    { id: "api", label: "API", kind: "service", paths: ["apps/api/**"] },
    { id: "db", label: "DB", kind: "database" },
  ],
  edges: [{ from: "web", to: "api" }, { from: "api", to: "db" }],
});

describe("git activity", () => {
  const text = "\u001ea1\u001fAna\u001f2026-10-01\napps/api/a.ts\napps/web/x.tsx\n\n\u001eb2\u001fBo\u001f2026-10-05\napps/api/a.ts\n\u001ec3\u001fAna\u001f2026-09-01\nREADME.md\n";
  it("parses git log output", () => {
    const c = parseGitLog(text);
    expect(c.map((x) => x.hash)).toEqual(["a1", "b2", "c3"]);
    expect(c[0]!.files).toEqual(["apps/api/a.ts", "apps/web/x.tsx"]);
  });
  it("counts commits, distinct authors and last change per part", () => {
    const a = activity(scene, parseGitLog(text));
    expect(a.api).toEqual({ commits: 2, authors: 2, lastChange: "2026-10-05" });
    expect(a.web).toEqual({ commits: 1, authors: 1, lastChange: "2026-10-01" });
    expect(a.db).toBeUndefined();
  });
  it("colours by a single-hue ramp, busiest darkest, unmapped grey", () => {
    const o = activityOverlay(scene, activity(scene, parseGitLog(text)), 90);
    expect(o.colors.api).toBe(HEAT[4]);
    expect(HEAT.indexOf(o.colors.web!)).toBeLessThan(4);
    expect(o.colors.db).toBe(UNMAPPED);
    expect(o.notes!.api).toBe("2 commits, 2 people");
  });
});

describe("CODEOWNERS", () => {
  it.each([
    ["*", "deep/file.ts", true],
    ["/apps/web/", "apps/web/page.tsx", true],
    ["/apps/web/", "x/apps/web/page.tsx", false],
    // GitHub: an unanchored directory pattern ("apps/") matches that directory anywhere in the repo
    ["docs/", "anything/docs/a.md", true],
    ["*.sql", "db/m/001.sql", true],
    ["apps/api", "apps/api/server.ts", true],
  ])("%s ~ %s = %s", (pattern, file, want) => {
    expect(ownersOf([{ globs: codeownersGlobs(pattern), owners: ["@x"] }], file).length > 0).toBe(want);
  });
  it("the last matching rule wins and comments are ignored", () => {
    const rules = parseCodeowners("# owners\n*  @acme/everyone\n/apps/api/ @acme/backend # api team\n");
    expect(ownersOf(rules, "apps/api/a.ts")).toEqual(["@acme/backend"]);
    expect(ownersOf(rules, "apps/web/a.ts")).toEqual(["@acme/everyone"]);
  });
  it("assigns each part the owners of most of its files and colours by team", () => {
    const rules = parseCodeowners("/apps/web/ @acme/frontend\n/apps/api/ @acme/backend\n/apps/api/legacy.ts @acme/platform\n");
    const own = ownership(scene, ["apps/web/a.tsx", "apps/api/a.ts", "apps/api/b.ts", "apps/api/legacy.ts"], rules);
    expect(own.api).toEqual({ owners: ["@acme/backend"], share: 2 / 3 });
    const o = teamOverlay(scene, own);
    expect(o.colors.web).not.toBe(o.colors.api);
    expect(o.colors.db).toBe(UNMAPPED);
    expect(o.legend.map((l) => l.label)).toEqual(["@acme/backend", "@acme/frontend", "no owner / no code"]);
  });
});

describe("overlay + theme rendering", () => {
  it("overlay colours and notes reach the SVG, with a legend", () => {
    const svg = renderSvg(scene, { overlay: { colors: { api: "#a84118" }, notes: { api: "12 commits" }, legend: [{ label: "busiest", color: "#a84118" }] } });
    expect(svg).toContain("12 commits");
    expect(svg).toContain("busiest");
  });
  it("dark theme swaps the background and ink", () => {
    const dark = renderSvg(scene, { theme: "dark" });
    expect(dark).toContain("#0f1520");
    expect(dark).not.toContain('fill="#f4f7fb"');
  });
});

describe("activity ramp spreads by rank", () => {
  it("16 commits and 136 commits land on different steps when other parts sit between them", () => {
    const sc = parseScene({ title: "r", nodes: ["a", "b", "c", "d", "e"].map((id) => ({ id, label: id, kind: "service", paths: [`${id}/**`] })), edges: [] });
    const act = { a: { commits: 16, authors: 1, lastChange: "" }, b: { commits: 25, authors: 1, lastChange: "" }, c: { commits: 136, authors: 1, lastChange: "" }, d: { commits: 221, authors: 1, lastChange: "" }, e: { commits: 0, authors: 0, lastChange: "" } };
    const o = activityOverlay(sc, act, 90);
    expect(o.colors.e).toBe(HEAT[0]);
    expect(o.colors.d).toBe(HEAT[4]);
    expect(HEAT.indexOf(o.colors.a!)).toBeLessThan(HEAT.indexOf(o.colors.c!));
  });
});
