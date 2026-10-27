import type { Overlay } from "./render.js";
import type { Scene } from "./scene.js";

/** JSON safe to embed inside <script>: no "</script>", no HTML comment openers, no JS line separators. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** A single self-contained page: the 3D viewer bundle plus the scene, no network needed. */
export function htmlPage(scene: Scene, viewerJs: string, opts: { highlight?: { changed: string[]; affected: string[] }; overlays?: { activity?: Overlay; team?: Overlay }; color?: string } = {}): string {
  const title = scene.title.replace(/[<>&"]/g, "");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}: repoland</title>
<style>html,body{margin:0;height:100%;background:#eef2f8}#map{position:fixed;inset:0;border-radius:0}</style>
</head>
<body>
<div id="map" role="application" aria-label="${title} architecture map"></div>
<script>${viewerJs.replace(/<\/script/gi, "<\\/script")}</script>
<script>Repoland.mount(document.getElementById("map"), ${scriptJson(scene)}, ${scriptJson(opts)});</script>
</body>
</html>
`;
}
