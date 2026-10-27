import { describe, expect, it } from "vitest";
import { globToRegExp, matchAny } from "../src/glob.js";

describe("glob", () => {
  it.each([
    ["apps/web/**", "apps/web/src/page.tsx", true],
    ["apps/web/**", "apps/web", true],
    ["apps/web/**", "apps/webhooks/x.ts", false],
    ["src/*.ts", "src/a.ts", true],
    ["src/*.ts", "src/deep/a.ts", false],
    ["**/*.sql", "db/migrations/001.sql", true],
    ["**/*.sql", "001.sql", true],
    ["server/src/{controllers,services}/**", "server/src/services/asset.ts", true],
    ["file?.md", "file1.md", true],
    ["docker-compose.yml", "docker-compose.yml", true],
    ["web/", "web/index.html", true],
  ])("%s ~ %s = %s", (g, p, want) => {
    expect(globToRegExp(g).test(p)).toBe(want);
  });
  it("escapes regex characters in literal parts", () => {
    expect(globToRegExp("a+b/(x).ts").test("a+b/(x).ts")).toBe(true);
    expect(globToRegExp("a+b/(x).ts").test("aab/x.ts")).toBe(false);
  });
  it("matchAny over several globs", () => {
    expect(matchAny(["a/**", "b/**"], "b/c.ts")).toBe(true);
    expect(matchAny([], "b/c.ts")).toBe(false);
  });
});
