/** Render every scene in gallery/ to docs/gallery/<name>.svg (animated) for the README and docs. */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { renderSvg } from "../src/render.js";
import { parseScene } from "../src/scene.js";

mkdirSync("docs/gallery", { recursive: true });
for (const f of readdirSync("gallery").filter((x) => x.endsWith(".json"))) {
  const scene = parseScene(readFileSync(`gallery/${f}`, "utf8"));
  writeFileSync(`docs/gallery/${f.replace(/\.json$/, ".svg")}`, renderSvg(scene));
  console.log(`docs/gallery/${f.replace(/\.json$/, ".svg")}`);
}
