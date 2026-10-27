/** Minimal glob matching for repo-relative paths: `**`, `*`, `?`, `{a,b}`; a trailing `/` or `/**` means "this folder and everything in it". */

const cache = new Map<string, RegExp>();

export function globToRegExp(glob: string): RegExp {
  const hit = cache.get(glob);
  if (hit) return hit;
  let g = glob.trim().replace(/^\.\//, "");
  if (g.endsWith("/")) g += "**";
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === "*") {
      if (g[i + 1] === "*") {
        const slash = g[i + 2] === "/";
        // "**/" matches zero or more folders; a final "/**" also matches the folder itself
        re += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = g.indexOf("}", i);
      if (end < 0) re += "\\{";
      else {
        re += `(?:${g.slice(i + 1, end).split(",").map(escapeRe).join("|")})`;
        i = end;
      }
    } else re += escapeRe(c);
  }
  // "dir/**" should also match "dir"
  re = re.replace(/\/\.\*$/, "(?:/.*)?");
  const out = new RegExp(`^${re}$`);
  cache.set(glob, out);
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

export function matchAny(globs: readonly string[], path: string): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}
