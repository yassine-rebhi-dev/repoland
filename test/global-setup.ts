import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/** The --html tests need the 3D viewer bundle; build it if this checkout hasn't yet (e.g. CI runs tests before build). */
export default function setup() {
  if (!existsSync("dist/viewer/repoland-viewer.js")) execFileSync("npx", ["vite", "build", "-c", "vite.viewer.config.ts", "--logLevel", "error"], { stdio: "inherit" });
}
