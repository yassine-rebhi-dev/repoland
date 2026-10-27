import { renderSvg } from "../src/render.js";
import { SceneError, parseScene } from "../src/scene.js";
import { type Viewer, mount } from "../viewer/index.js";
import immich from "../gallery/immich-app__immich.json";
import ollama from "../gallery/ollama__ollama.json";
import plausible from "../gallery/plausible__analytics.json";
import supabase from "../gallery/supabase__supabase.json";
import uv from "../gallery/astral-sh__uv.json";
import self from "../gallery/yassine-rebhi-dev__repoland.json";

const GALLERY: { repo: string; scene: unknown }[] = [
  { repo: "immich-app/immich", scene: immich },
  { repo: "supabase/supabase", scene: supabase },
  { repo: "ollama/ollama", scene: ollama },
  { repo: "astral-sh/uv", scene: uv },
  { repo: "plausible/analytics", scene: plausible },
  { repo: "yassine-rebhi-dev/repoland", scene: self },
];

const $ = (id: string) => document.getElementById(id)!;
const json = $("json") as HTMLTextAreaElement;
const preview = $("preview");
const errors = $("errors");
let lastSvg = "";
let view: "2d" | "3d" = "2d";
let viewer: Viewer | null = null;

const webgl = (() => {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
})();

const strip = (scene: unknown) => {
  const { source: _source, ...rest } = scene as Record<string, unknown>;
  return rest;
};

// hero: the live 3D town when WebGL is available, the SVG otherwise
const hero = $("hero");
if (webgl) mount(hero, immich, { autoRotate: true });
else hero.innerHTML = renderSvg(parseScene(immich));

const gallery = $("gallery");
for (const g of GALLERY) {
  const s = parseScene(g.scene);
  const b = document.createElement("button");
  b.type = "button";
  b.className = "tile";
  b.innerHTML = `${renderSvg(s, { animate: false, credit: false })}<span>${g.repo}</span><small>${(g.scene as { source?: string }).source ?? ""}</small>`;
  b.addEventListener("click", () => {
    json.value = JSON.stringify(strip(g.scene), null, 2);
    draw();
    document.getElementById("play-title")?.scrollIntoView({ behavior: "smooth" });
  });
  gallery.append(b);
}

function draw() {
  try {
    const s = parseScene(json.value);
    lastSvg = renderSvg(s);
    errors.textContent = "";
    viewer?.dispose();
    viewer = null;
    preview.classList.toggle("is-3d", view === "3d");
    if (view === "3d" && webgl) viewer = mount(preview, s, { autoRotate: false });
    else preview.innerHTML = lastSvg;
  } catch (e) {
    errors.textContent = e instanceof SceneError ? e.message : (e as Error).message;
  }
}

let t: number | undefined;
json.addEventListener("input", () => {
  clearTimeout(t);
  t = window.setTimeout(draw, view === "3d" ? 500 : 150);
});

for (const b of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
  if (b.dataset.view === "3d" && !webgl) b.disabled = true;
  b.addEventListener("click", () => {
    view = b.dataset.view as "2d" | "3d";
    for (const o of document.querySelectorAll<HTMLButtonElement>("[data-view]")) o.setAttribute("aria-pressed", String(o === b));
    draw();
  });
}

$("download").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lastSvg], { type: "image/svg+xml" }));
  a.download = "repoland.svg";
  a.click();
  URL.revokeObjectURL(a.href);
});
$("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText("![How it works](repoland.svg)");
  $("copy").textContent = "Copied";
});

json.value = JSON.stringify(strip(ollama), null, 2);
draw();
