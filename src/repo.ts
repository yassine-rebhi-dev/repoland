import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/** Read-only view of a repository's files (repo-relative POSIX paths). */
export interface Repo {
  readonly name: string;
  files(): string[];
  read(path: string): string | null;
}

const SKIP = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", "target", ".next", ".turbo", "vendor"]);
const MAX_READ = 1_000_000;

/** A directory on disk; uses `git ls-files` when available so ignored files don't count. */
export class LocalRepo implements Repo {
  readonly name: string;
  private readonly root: string;
  private list?: string[];

  constructor(dir: string) {
    this.root = resolve(dir);
    this.name = this.root.split(sep).pop() ?? dir;
  }

  files(): string[] {
    if (!this.list) {
      try {
        const git = (...args: string[]) =>
          execFileSync("git", ["ls-files", "-z", ...args], { cwd: this.root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 })
            .split("\0")
            .filter(Boolean);
        // tracked + untracked (not ignored), minus files deleted from disk but still in the index
        const deleted = new Set(git("--deleted"));
        // vendored/build folders never count, even in repos that forgot to ignore them
        this.list = git("--cached", "--others", "--exclude-standard").filter((f) => !deleted.has(f) && !f.split("/").some((seg) => SKIP.has(seg)));
      } catch {
        this.list = this.walk(this.root, []);
      }
    }
    return this.list;
  }

  read(path: string): string | null {
    const full = resolve(this.root, path);
    if (full !== this.root && !full.startsWith(this.root + sep)) return null;
    try {
      return statSync(full).size > MAX_READ ? null : readFileSync(full, "utf8");
    } catch {
      return null;
    }
  }

  private walk(dir: string, out: string[]): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) this.walk(join(dir, e.name), out);
      } else if (e.isFile()) out.push(relative(this.root, join(dir, e.name)).split(sep).join("/"));
    }
    return out;
  }
}

/** In-memory repo for tests. */
export class MemoryRepo implements Repo {
  constructor(readonly name: string, private readonly fs: Record<string, string>) {}
  files(): string[] {
    return Object.keys(this.fs);
  }
  read(path: string): string | null {
    return this.fs[path] ?? null;
  }
}
