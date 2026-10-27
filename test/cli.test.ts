import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE, main, outPath, parseArgs } from "../src/cli.js";

afterEach(() => vi.restoreAllMocks());
const quiet = () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
};
const tmp = () => mkdtempSync(join(tmpdir(), "repoland-"));

describe("parseArgs", () => {
  it("defaults to rendering repoland.json", () => expect(parseArgs([])).toMatchObject({ cmd: "render", file: "repoland.json" }));
  it("parses subcommands and flags", () => {
    expect(parseArgs(["check", "x.json"])).toMatchObject({ cmd: "check", file: "x.json" });
    expect(parseArgs(["a.json", "-o", "b.svg", "--static", "--no-credit"])).toMatchObject({ out: "b.svg", animate: false, credit: false });
    expect(() => parseArgs(["--wat"])).toThrow(/Unknown option/);
  });
  it("derives the output path", () => expect(outPath("docs/arch.json")).toBe("docs/arch.svg"));
});

describe("main", () => {
  it("example -> render produces an SVG next to the scene", () => {
    quiet();
    const d = tmp();
    expect(main(["example"], d)).toBe(0);
    expect(main([], d)).toBe(0);
    const svg = readFileSync(join(d, "repoland.svg"), "utf8");
    expect(svg).toContain(EXAMPLE.title);
  });
  it("refuses to overwrite an existing scene with example", () => {
    quiet();
    const d = tmp();
    main(["example"], d);
    expect(() => main(["example"], d)).toThrow(/already exists/);
  });
  it("reports scene errors and exits 1", () => {
    const errs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((s: string) => void errs.push(s));
    const d = tmp();
    writeFileSync(join(d, "bad.json"), JSON.stringify({ title: "x", nodes: [{ id: "a", label: "A", kind: "rocket" }] }));
    expect(main(["bad.json"], d)).toBe(1);
    expect(errs.join("\n")).toMatch(/nodes\[0\]\.kind/);
  });
  it("installs the skill into the project or home directory", () => {
    quiet();
    const d = tmp();
    const h = tmp();
    expect(main(["skill"], d, h)).toBe(0);
    expect(readFileSync(join(d, ".claude/skills/repoland/SKILL.md"), "utf8")).toMatch(/^---\nname: repoland/);
    expect(main(["skill", "--global"], d, h)).toBe(0);
    expect(existsSync(join(h, ".claude/skills/repoland/SKILL.md"))).toBe(true);
  });
  it("check validates without writing", () => {
    quiet();
    const d = tmp();
    main(["example"], d);
    expect(main(["check"], d)).toBe(0);
    expect(existsSync(join(d, "repoland.svg"))).toBe(false);
  });
});

describe("check (drift) and impact on a real git repo", () => {
  const setup = () => {
    const d = tmp();
    const sh = (...a: string[]) => execFileSync("git", a, { cwd: d, stdio: "ignore" });
    sh("init", "-q", "-b", "main");
    sh("config", "user.email", "t@t");
    sh("config", "user.name", "t");
    mkdirSync(join(d, "api"));
    mkdirSync(join(d, "web"));
    writeFileSync(join(d, "api/server.ts"), "x");
    writeFileSync(join(d, "web/page.tsx"), "x");
    writeFileSync(join(d, "repoland.json"), JSON.stringify({
      title: "t",
      nodes: [
        { id: "web", label: "Web", kind: "frontend", paths: ["web/**"] },
        { id: "api", label: "API", kind: "service", paths: ["api/**"] },
      ],
      edges: [{ from: "web", to: "api" }],
    }));
    sh("add", "-A");
    sh("commit", "-q", "-m", "init");
    return { d, sh };
  };
  it("impact: changed file lights up its part and its callers", () => {
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => void out.push(s));
    const { d, sh } = setup();
    sh("checkout", "-q", "-b", "feature");
    writeFileSync(join(d, "api/server.ts"), "changed");
    expect(main(["impact", "--md"], d)).toBe(0);
    expect(out.join("\n")).toMatch(/Changed:\*\* API[\s\S]*Affected[^\n]*Web/);
    expect(readFileSync(join(d, "repoland-impact.svg"), "utf8")).toContain("#e5484d");
  });
  it("check: exits 1 when a part's code disappears", () => {
    quiet();
    const { d } = setup();
    expect(main(["check"], d)).toBe(0);
    rmSync(join(d, "api"), { recursive: true });
    expect(main(["check"], d)).toBe(1);
  });
});

describe("--html", () => {
  it("writes a self-contained 3D page when the viewer bundle exists", () => {
    quiet();
    const d = tmp();
    main(["example"], d);
    expect(main(["--html"], d)).toBe(0);
    const html = readFileSync(join(d, "repoland.html"), "utf8");
    expect(html).toContain("Repoland.mount");
    expect(html).toContain("acme-shop");
    expect(html.length).toBeGreaterThan(100_000); // three.js is inlined
  });
});

describe("check --no-drift", () => {
  it("validates only, even when paths don't exist here", () => {
    quiet();
    const d = tmp();
    writeFileSync(join(d, "other.json"), JSON.stringify({ title: "o", nodes: [{ id: "a", label: "A", kind: "service", paths: ["elsewhere/**"] }] }));
    expect(main(["check", "other.json", "--no-drift"], d)).toBe(0);
    expect(main(["check", "other.json"], d)).toBe(1);
  });
});

describe("LocalRepo", () => {
  it("never lists node_modules, even when it isn't gitignored", async () => {
    const { LocalRepo } = await import("../src/repo.js");
    const d = tmp();
    execFileSync("git", ["init", "-q"], { cwd: d });
    mkdirSync(join(d, "node_modules/x"), { recursive: true });
    writeFileSync(join(d, "node_modules/x/index.js"), "");
    writeFileSync(join(d, "a.ts"), "");
    expect(new LocalRepo(d).files()).toEqual(["a.ts"]);
  });
});

describe("v0.3 flags", () => {
  const repoWithHistory = () => {
    const d = tmp();
    const sh = (...a: string[]) => execFileSync("git", a, { cwd: d, stdio: "ignore" });
    sh("init", "-q", "-b", "main");
    sh("config", "user.email", "t@t");
    sh("config", "user.name", "t");
    mkdirSync(join(d, "api"));
    mkdirSync(join(d, "web"));
    writeFileSync(join(d, "CODEOWNERS"), "/api/ @acme/backend\n/web/ @acme/frontend\n");
    writeFileSync(join(d, "repoland.json"), JSON.stringify({
      title: "t",
      nodes: [
        { id: "web", label: "Web", kind: "frontend", paths: ["web/**"] },
        { id: "api", label: "API", kind: "service", paths: ["api/**"] },
      ],
      edges: [{ from: "web", to: "api" }],
    }));
    for (let i = 0; i < 3; i++) {
      writeFileSync(join(d, "api/a.ts"), String(i));
      sh("add", "-A");
      sh("commit", "-q", "-m", `c${i}`);
    }
    return d;
  };
  it("--color activity and --color team colour from git history and CODEOWNERS", () => {
    quiet();
    const d = repoWithHistory();
    expect(main(["--color", "activity", "-o", "a.svg"], d)).toBe(0);
    expect(readFileSync(join(d, "a.svg"), "utf8")).toContain("3 commits, 1 person");
    expect(main(["--color", "team", "-o", "t.svg"], d)).toBe(0);
    expect(readFileSync(join(d, "t.svg"), "utf8")).toContain("@acme/backend");
  });
  it("--color team without CODEOWNERS explains what's missing", () => {
    quiet();
    const d = tmp();
    writeFileSync(join(d, "repoland.json"), JSON.stringify({ title: "t", nodes: [{ id: "a", label: "A", kind: "service", paths: ["a/**"] }] }));
    expect(() => main(["--color", "team"], d)).toThrow(/CODEOWNERS/);
  });
  it("--theme both writes light and dark files and prints a <picture> snippet", () => {
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => void out.push(s));
    const d = tmp();
    main(["example"], d);
    expect(main(["--theme", "both"], d)).toBe(0);
    expect(readFileSync(join(d, "repoland-dark.svg"), "utf8")).toContain("#0f1520");
    expect(out.join("\n")).toContain('srcset="repoland-dark.svg"');
  });
  it("export --mermaid prints a flowchart", () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s: string | Uint8Array) => {
      chunks.push(String(s));
      return true;
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const d = tmp();
    main(["example"], d);
    expect(main(["export", "--mermaid"], d)).toBe(0);
    expect(chunks.join("")).toMatch(/^---\ntitle: acme-shop\n---\nflowchart LR/);
  });
});
