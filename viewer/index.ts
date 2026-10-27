/**
 * Interactive 3D viewer for a repoland scene. Same layout as the SVG (src/layout.ts), rendered with three.js.
 * Bundled into dist/viewer/repoland-viewer.js (window.Repoland.mount) for `repoland --html` and the website.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { FOOT, type PlacedNode, layout } from "../src/layout.js";
import { type Overlay, PALETTE } from "../src/render.js";
import { type Kind, type Scene, parseScene } from "../src/scene.js";
import { STYLES } from "./styles.js";

export interface ViewerOptions {
  highlight?: { changed: string[]; affected: string[] };
  /** Slowly orbit until the first interaction. Default true (off with reduced motion). */
  autoRotate?: boolean;
  /** Show search, filters and the details panel. Default true. */
  ui?: boolean;
  /** Alternative colourings (from `repoland --html`): git activity and CODEOWNERS teams. */
  overlays?: { activity?: Overlay; team?: Overlay };
  /** Initial colouring: "kind" (default), "activity" or "team". */
  color?: string;
}

export interface Viewer {
  select(id: string | null): void;
  dispose(): void;
}

const CHANGED = 0xe5484d;
const AFFECTED = 0xf5a524;
const KIND_LABEL: Record<Kind, string> = {
  user: "User", frontend: "Frontend", service: "Service", worker: "Worker", database: "Database", cache: "Cache",
  queue: "Queue", storage: "Storage", external: "External", cli: "CLI", library: "Library", model: "Model",
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const col = (hex: string) => new THREE.Color(hex);
function tint(hex: string, amt: number): THREE.Color {
  const c = col(hex);
  return amt >= 0 ? c.lerp(new THREE.Color(0xffffff), amt) : c.multiplyScalar(1 + amt);
}

/** Lit-window texture for tower faces, cached per colour. */
const windowTex = new Map<string, THREE.CanvasTexture>();
function windows(hex: string): THREE.CanvasTexture {
  const hit = windowTex.get(hex);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = 64;
  cv.height = 128;
  const g = cv.getContext("2d")!;
  g.fillStyle = `#${tint(hex, 0).getHexString()}`;
  g.fillRect(0, 0, 64, 128);
  // three columns, four rows: reads as windows at map scale instead of noise
  for (let row = 0; row < 4; row++)
    for (let c = 0; c < 3; c++) {
      g.fillStyle = (row * 3 + c) % 4 === 1 ? "#fff3c4" : `#${tint(hex, 0.62).getHexString()}`;
      g.fillRect(8 + c * 18, 14 + row * 28, 12, 16);
    }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  windowTex.set(hex, t);
  return t;
}

interface Built {
  group: THREE.Group;
  top: number;
  mats: THREE.Material[];
  /** per-frame animation for this building */
  tick?: (t: number) => void;
}

function std(color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, transparent: true, ...extra });
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** One building per kind. Origin = centre of the footprint on the ground. */
function building(kind: Kind, hex: string, degree: number): Built {
  const g = new THREE.Group();
  const mats: THREE.Material[] = [];
  const m = (c: THREE.ColorRepresentation, extra?: THREE.MeshStandardMaterialParameters) => {
    const x = std(c, extra);
    mats.push(x);
    return x;
  };
  const plinth = mesh(new THREE.BoxGeometry(FOOT - 0.1, 0.12, FOOT - 0.1), m(0xcfd8e4), 0, 0.06, 0);
  g.add(plinth);
  const grow = Math.min(degree, 5) * 0.22;
  let top = 1.5;
  let tick: ((t: number) => void) | undefined;
  switch (kind) {
    case "service": {
      const h = 1.2 + grow;
      const side = m(0xffffff, { map: windows(hex) });
      const roof = m(tint(hex, 0.25));
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, h, 1.5), [side, side, roof, roof, side, side]);
      body.position.set(0, 0.12 + h / 2, 0);
      body.castShadow = body.receiveShadow = true;
      g.add(body, mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), m(tint(hex, -0.1)), 0, 0.12 + h + 0.15, 0));
      top = h + 0.5;
      break;
    }
    case "frontend": {
      g.add(mesh(new THREE.BoxGeometry(0.3, 0.35, 0.5), m(0x9aa6b8), 0, 0.3, 0));
      g.add(mesh(new THREE.BoxGeometry(0.2, 1.4, 1.7), m(hex), 0, 1.15, 0));
      g.add(mesh(new THREE.BoxGeometry(0.02, 1.2, 1.5), m(tint(hex, 0.7), { emissive: tint(hex, 0.4), emissiveIntensity: 0.6 }), 0.11, 1.15, 0));
      top = 2;
      break;
    }
    case "worker": {
      g.add(mesh(new THREE.BoxGeometry(1.6, 1, 1.4), m(0xffffff, { map: windows(hex) }), 0, 0.62, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.3, 16), m(tint(hex, -0.15)), -0.5, 1.75, -0.4));
      const puffs: THREE.Mesh[] = [];
      for (let i = 0; i < 3; i++) {
        const p = mesh(new THREE.SphereGeometry(0.18 + i * 0.05, 16, 12), m(0xffffff, { opacity: 0.8 }), -0.5, 2.5, -0.4);
        p.castShadow = false;
        puffs.push(p);
        g.add(p);
      }
      tick = (t) =>
        puffs.forEach((p, i) => {
          const k = (t * 0.35 + i / 3) % 1;
          p.position.set(-0.5 - k * 0.5, 2.45 + k * 1.2, -0.4 - k * 0.3);
          (p.material as THREE.MeshStandardMaterial).opacity = 0.85 * (1 - k);
          p.scale.setScalar(0.8 + k * 0.9);
        });
      top = 2.4;
      break;
    }
    case "database": {
      const h = 1.5;
      g.add(mesh(new THREE.CylinderGeometry(0.78, 0.78, h, 40), m(hex), 0, 0.12 + h / 2, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.79, 0.79, 0.05, 40), m(tint(hex, 0.35)), 0, 0.12 + h, 0));
      for (const y of [0.55, 1.05]) g.add(mesh(new THREE.TorusGeometry(0.79, 0.035, 8, 48), m(tint(hex, -0.25)), 0, 0.12 + y, 0).rotateX(Math.PI / 2));
      top = 1.9;
      break;
    }
    case "cache":
      for (let i = 0; i < 3; i++) g.add(mesh(new THREE.BoxGeometry(1.4, 0.32, 1.4), m(i === 1 ? tint(hex, 0.15) : hex), 0, 0.28 + i * 0.42, 0));
      top = 1.6;
      break;
    case "queue": {
      g.add(mesh(new THREE.BoxGeometry(1.8, 0.35, 0.9), m(0x5b6577), 0, 0.3, 0));
      g.add(mesh(new THREE.BoxGeometry(1.8, 0.04, 0.8), m(hex), 0, 0.5, 0));
      const crates: THREE.Mesh[] = [];
      for (let i = 0; i < 3; i++) {
        const c = mesh(new THREE.BoxGeometry(0.4, 0.36, 0.5), m(tint(hex, i % 2 ? 0.15 : -0.08)), 0, 0.7, 0);
        crates.push(c);
        g.add(c);
      }
      tick = (t) => crates.forEach((c, i) => c.position.setX(-0.75 + (((t * 0.25 + i / 3) % 1) * 1.5)));
      top = 1.2;
      break;
    }
    case "storage": {
      const box = mesh(new THREE.BoxGeometry(1.5, 1.15, 1.5), m(hex), 0, 0.7, 0);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: tint(hex, -0.35), transparent: true }));
      mats.push(edges.material as THREE.Material);
      box.add(edges);
      g.add(box);
      top = 1.6;
      break;
    }
    case "external": {
      const cloud = new THREE.Group();
      for (const [x, y, z, r] of [[-0.45, 0, 0, 0.42], [0.05, 0.18, 0, 0.55], [0.5, 0, 0.05, 0.4], [0.1, -0.05, 0.3, 0.42], [0, 0, -0.3, 0.4]] as const)
        cloud.add(mesh(new THREE.SphereGeometry(r, 24, 16), m(0xffffff), x, y, z));
      cloud.position.y = 1.6;
      g.add(cloud);
      tick = (t) => {
        cloud.position.y = 1.6 + Math.sin(t * 1.2) * 0.08;
      };
      top = 2.3;
      break;
    }
    case "cli": {
      g.add(mesh(new THREE.BoxGeometry(1.5, 1.05, 1.3), m(hex), 0, 0.65, 0));
      const glow = m(0x5af78e, { emissive: 0x5af78e, emissiveIntensity: 0.9 });
      g.add(mesh(new THREE.BoxGeometry(0.02, 0.06, 0.32), glow, 0.76, 0.55, 0.12));
      g.add(mesh(new THREE.BoxGeometry(0.02, 0.06, 0.22), glow, 0.76, 0.75, -0.18).rotateX(0.6));
      g.add(mesh(new THREE.BoxGeometry(0.02, 0.06, 0.22), glow, 0.76, 0.62, -0.18).rotateX(-0.6));
      top = 1.6;
      break;
    }
    case "library":
      [0, 0.14, -0.12].forEach((a, i) => g.add(mesh(new THREE.BoxGeometry(1.45, 0.32, 1.3), m(tint(hex, a)), i * 0.06, 0.28 + i * 0.34, -i * 0.05)));
      top = 1.6;
      break;
    case "model": {
      g.add(mesh(new THREE.BoxGeometry(1.1, 0.5, 1.1), m(0x3b4658), 0, 0.37, 0));
      const orb = mesh(new THREE.SphereGeometry(0.55, 32, 24), m(hex, { emissive: hex, emissiveIntensity: 0.55, roughness: 0.2 }), 0, 1.45, 0);
      const ring = mesh(new THREE.TorusGeometry(0.85, 0.03, 8, 64), m(tint(hex, 0.4), { emissive: hex, emissiveIntensity: 0.4 }), 0, 1.45, 0);
      g.add(orb, ring);
      tick = (t) => {
        ring.rotation.set(Math.PI / 2.4, t * 0.6, 0);
        orb.position.y = 1.45 + Math.sin(t * 1.5) * 0.05;
      };
      top = 2.3;
      break;
    }
    case "user": {
      g.add(mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.1, 32), m(0xcfd8e4), 0, 0.17, 0));
      g.add(mesh(new THREE.CapsuleGeometry(0.28, 0.4, 8, 16), m(hex), 0, 0.72, 0));
      g.add(mesh(new THREE.SphereGeometry(0.24, 24, 16), m(tint(hex, 0.35)), 0, 1.38, 0));
      top = 1.75;
      break;
    }
  }
  return { group: g, top, mats, tick };
}

let stylesInjected = false;

export function mount(container: HTMLElement, input: unknown, opts: ViewerOptions = {}): Viewer {
  const scene: Scene = parseScene(input);
  const L = layout(scene);
  const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!stylesInjected) {
    const st = document.createElement("style");
    st.textContent = STYLES;
    document.head.append(st);
    stylesInjected = true;
  }
  container.classList.add("rl-root");
  container.innerHTML = "";

  // ---- three.js basics
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // neutral tone mapping keeps the flat illustrative palette (ACES muddies saturated colours)
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.1;
  const labels = new CSS2DRenderer();
  labels.domElement.className = "rl-labels";
  container.append(renderer.domElement, labels.domElement);

  const world = new THREE.Scene();
  const { minX, minY, maxX, maxY } = L.bounds;
  const cx = (minX + maxX) / 2;
  const cz = (minY + maxY) / 2;
  const span = Math.max(maxX - minX, maxY - minY) + 4;
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 500);
  // aim slightly above the ground so the town sits below the toolbar
  const baseTarget = new THREE.Vector3(cx, span * 0.06, cz);
  const baseOffset = new THREE.Vector3(span * 0.62, span * 0.72, span * 0.62);
  camera.position.copy(baseTarget).add(baseOffset);
  const controls = new OrbitControls(camera, labels.domElement);
  controls.target.copy(baseTarget);
  let touched = false;
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.15;
  controls.minDistance = 4;
  controls.maxDistance = span * 4;
  controls.autoRotate = (opts.autoRotate ?? true) && !reduce;
  controls.autoRotateSpeed = 0.6;
  controls.addEventListener("start", () => {
    controls.autoRotate = false;
    touched = true;
  });

  world.add(new THREE.HemisphereLight(0xffffff, 0xb9c6d8, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(cx - span * 0.6, span * 1.2, cz - span * 0.3);
  sun.target.position.set(cx, 0, cz);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -span;
  sc.right = sc.top = span;
  sc.far = span * 4;
  sun.shadow.bias = -0.0005;
  world.add(sun, sun.target);

  // ---- ground slab + tile lines
  const pad = 1.6;
  const gw = maxX - minX + pad * 2;
  const gd = maxY - minY + pad * 2;
  const slab = mesh(new THREE.BoxGeometry(gw, 0.5, gd), std(0xdfe6ef), cx, -0.25, cz);
  slab.castShadow = false;
  world.add(slab);
  const gridPts: number[] = [];
  for (let x = Math.ceil(minX - pad); x <= maxX + pad; x++) gridPts.push(x, 0.002, minY - pad, x, 0.002, maxY + pad);
  for (let z = Math.ceil(minY - pad); z <= maxY + pad; z++) gridPts.push(minX - pad, 0.002, z, maxX + pad, 0.002, z);
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(gridPts, 3));
  world.add(new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0xc7d1de })));

  // ---- districts: each member's lot is tinted with its district colour (legend in the toolbar)
  const zoneColors = ["#6c63ff", "#21a98e", "#f2a65a", "#e86a92", "#4c8df6", "#a06cd5"];
  const groupColor = new Map(scene.groups.map((g, i) => [g.id, zoneColors[i % zoneColors.length]!]));
  for (const n of L.nodes) {
    const c = groupColor.get(n.node.group);
    if (!c) continue;
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(FOOT + 0.64, FOOT + 0.64), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.22 }));
    lot.rotation.x = -Math.PI / 2;
    lot.position.set(n.gx + FOOT / 2, 0.004, n.gy + FOOT / 2);
    world.add(lot);
  }
  const usedGroups = scene.groups.filter((g) => L.nodes.some((n) => n.node.group === g.id));

  // ---- buildings
  const degree = new Map<string, number>();
  for (const e of scene.edges) for (const id of [e.from, e.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const nth = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const n of scene.nodes) {
    nth.set(n.id, seen.get(n.kind) ?? 0);
    seen.set(n.kind, (seen.get(n.kind) ?? 0) + 1);
  }
  interface Part {
    p: PlacedNode;
    b: Built;
    label: HTMLDivElement;
    labelObj: CSS2DObject;
    ring?: THREE.Mesh;
  }
  const parts = new Map<string, Part>();
  const pickable: THREE.Object3D[] = [];
  const overlays = opts.overlays ?? {};
  let mode: "kind" | "activity" | "team" = opts.color === "activity" && overlays.activity ? "activity" : opts.color === "team" && overlays.team ? "team" : "kind";
  const hexFor = (p: PlacedNode) => {
    const ov = mode === "kind" ? undefined : overlays[mode];
    return ov?.colors[p.node.id] ?? `#${tint(PALETTE[p.node.kind], [0, 0.14, -0.1, 0.24][(nth.get(p.node.id) ?? 0) % 4]!).getHexString()}`;
  };
  /** (Re)build a part's building in the current colouring; the label object moves to the new group. */
  const raise = (p: PlacedNode): Built => {
    const b = building(p.node.kind, hexFor(p), degree.get(p.node.id) ?? 0);
    b.group.position.set(p.gx + FOOT / 2, 0, p.gy + FOOT / 2);
    b.group.userData.id = p.node.id;
    b.group.traverse((o) => {
      o.userData.id = p.node.id;
    });
    world.add(b.group);
    pickable.push(b.group);
    return b;
  };
  for (const p of L.nodes) {
    const b = raise(p);
    // CSS2DRenderer owns the anchor's transform, so the card is a child that lifts itself above the roof
    const anchor = document.createElement("div");
    anchor.className = "rl-anchor";
    const div = document.createElement("div");
    div.className = "rl-label";
    div.style.setProperty("--k", (mode === "kind" ? undefined : overlays[mode])?.colors[p.node.id] ?? PALETTE[p.node.kind]);
    div.innerHTML = `<b>${esc(p.node.label)}</b>${p.node.note ? `<span>${esc(p.node.note)}</span>` : ""}`;
    div.addEventListener("click", () => select(p.node.id));
    div.addEventListener("pointerenter", () => div.classList.add("is-hover"));
    div.addEventListener("pointerleave", () => div.classList.remove("is-hover"));
    anchor.append(div);
    const lo = new CSS2DObject(anchor);
    lo.position.set(0, b.top + 0.35, 0);
    b.group.add(lo);
    parts.set(p.node.id, { p, b, label: div, labelObj: lo });
  }

  function recolor(next: typeof mode) {
    mode = next;
    for (const part of parts.values()) {
      const old = part.b.group;
      old.remove(part.labelObj);
      world.remove(old);
      pickable.splice(pickable.indexOf(old), 1);
      old.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          for (const x of Array.isArray(m.material) ? m.material : [m.material]) x.dispose();
        }
      });
      part.b = raise(part.p);
      part.labelObj.position.set(0, part.b.top + 0.35, 0);
      part.b.group.add(part.labelObj);
      const ov = mode === "kind" ? undefined : overlays[mode];
      part.label.style.setProperty("--k", ov?.colors[part.p.node.id] ?? PALETTE[part.p.node.kind]);
    }
    renderLegend();
    apply();
    if (selected) renderPanel(selected);
  }

  // ---- pipes with flowing particles
  interface Pipe {
    from: string;
    to: string;
    curve: THREE.CurvePath<THREE.Vector3>;
    tube: THREE.Mesh;
    dots: THREE.InstancedMesh;
    len: number;
    tag?: HTMLDivElement;
  }
  const pipes: Pipe[] = [];
  const dummy = new THREE.Object3D();
  for (const e of L.edges) {
    const pts = e.points.map(([x, z]) => new THREE.Vector3(x, 0.09, z));
    const curve = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 1; i < pts.length; i++) curve.add(new THREE.LineCurve3(pts[i - 1]!, pts[i]!));
    const len = curve.getLength();
    if (len < 0.01) continue;
    const fromKind = parts.get(e.edge.from)!.p.node.kind;
    const c = fromKind === "external" ? 0x8794a8 : col(PALETTE[fromKind]).getHex();
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, Math.round(len * 6)), 0.07, 8, false), std(0xe9eef5));
    tube.receiveShadow = true;
    world.add(tube);
    const count = Math.max(2, Math.round(len * 1.6));
    const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 12, 8), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.5, transparent: true }), count);
    world.add(dots);
    const pipe: Pipe = { from: e.edge.from, to: e.edge.to, curve, tube, dots, len };
    pipes.push(pipe);
    if (e.edge.label) {
      const tag = document.createElement("div");
      pipe.tag = tag;
      tag.className = "rl-edge";
      tag.textContent = e.edge.label;
      const o = new CSS2DObject(tag);
      o.position.copy(curve.getPointAt(0.5)).setY(0.25);
      world.add(o);
    }
  }

  // ---- impact rings
  const hl = opts.highlight;
  if (hl)
    for (const [ids, color] of [[hl.changed, CHANGED], [hl.affected, AFFECTED]] as const)
      for (const id of ids) {
        const part = parts.get(id);
        if (!part) continue;
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.35, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(part.p.gx + FOOT / 2, 0.02, part.p.gy + FOOT / 2);
        world.add(ring);
        part.ring = ring;
        part.label.classList.add(color === CHANGED ? "is-changed" : "is-affected");
      }

  // ---- focus / fade logic shared by selection, search, filters and impact
  const hidden = new Set<Kind>();
  let selected: string | null = null;
  let query = "";
  const neighbours = (id: string) => ({
    calls: scene.edges.filter((e) => e.from === id).map((e) => e.to),
    calledBy: scene.edges.filter((e) => e.to === id).map((e) => e.from),
  });
  function apply() {
    let focus: Set<string> | null = null;
    if (selected) {
      const nb = neighbours(selected);
      focus = new Set([selected, ...nb.calls, ...nb.calledBy]);
    } else if (query) {
      focus = new Set(scene.nodes.filter((n) => `${n.label} ${n.note} ${n.id} ${n.description}`.toLowerCase().includes(query)).map((n) => n.id));
    } else if (hl) focus = new Set([...hl.changed, ...hl.affected]);
    for (const [id, part] of parts) {
      const visible = !hidden.has(part.p.node.kind);
      part.b.group.visible = visible;
      part.label.style.display = visible ? "" : "none";
      const on = !focus || focus.has(id);
      for (const mat of part.b.mats) (mat as THREE.MeshStandardMaterial).opacity = on ? 1 : 0.18;
      // ghosts shouldn't throw full-strength shadows
      part.b.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = on;
      });
      part.label.classList.toggle("is-dim", !on);
      part.label.classList.toggle("is-selected", id === selected);
    }
    for (const pp of pipes) {
      const visible = !hidden.has(parts.get(pp.from)!.p.node.kind) && !hidden.has(parts.get(pp.to)!.p.node.kind);
      const on = !focus || (selected ? pp.from === selected || pp.to === selected : focus.has(pp.from) && focus.has(pp.to));
      pp.tube.visible = pp.dots.visible = visible;
      (pp.tube.material as THREE.MeshStandardMaterial).opacity = on ? 1 : 0.2;
      (pp.dots.material as THREE.MeshStandardMaterial).opacity = on ? 1 : 0.1;
      if (pp.tag) {
        pp.tag.style.display = visible ? "" : "none";
        pp.tag.style.opacity = on ? "1" : "0.25";
      }
    }
  }

  // ---- UI shell: title, search, kind filters, details panel, hint
  const ui = opts.ui ?? true;
  const panel = document.createElement("aside");
  panel.className = "rl-panel";
  panel.hidden = true;
  if (ui) {
    const bar = document.createElement("div");
    bar.className = "rl-bar";
    const kinds = [...new Set(scene.nodes.map((n) => n.kind))];
    bar.innerHTML = `<div class="rl-title"><strong>${esc(scene.title)}</strong>${scene.subtitle ? `<span>${esc(scene.subtitle)}</span>` : ""}</div>
      <div class="rl-tools"><input class="rl-search" type="search" placeholder="Find a part…" aria-label="Find a part">
      ${overlays.activity || overlays.team ? `<select class="rl-color" aria-label="Color buildings by"><option value="kind">Color: kind</option>${overlays.activity ? '<option value="activity">Color: activity</option>' : ""}${overlays.team ? '<option value="team">Color: team</option>' : ""}</select>` : ""}
      <button type="button" class="rl-btn" data-act="reset">Reset view</button></div>
      <div class="rl-legend"></div>
      ${usedGroups.length ? `<div class="rl-districts">${usedGroups.map((g) => `<span style="--k:${groupColor.get(g.id)}">${esc(g.label)}</span>`).join("")}</div>` : ""}
      <div class="rl-kinds" role="group" aria-label="Show or hide kinds">${kinds
        .map((k) => `<button type="button" class="rl-chip" aria-pressed="true" data-kind="${k}" style="--k:${PALETTE[k]}">${KIND_LABEL[k]}</button>`)
        .join("")}</div>`;
    container.append(bar, panel);
    const hint = document.createElement("div");
    hint.className = "rl-hint";
    hint.textContent = "Drag to orbit · scroll to zoom · click a building";
    container.append(hint);
    bar.querySelector<HTMLInputElement>(".rl-search")!.addEventListener("input", (ev) => {
      query = (ev.target as HTMLInputElement).value.trim().toLowerCase();
      selected = null;
      panel.hidden = true;
      apply();
      const first = scene.nodes.find((n) => query && `${n.label} ${n.note} ${n.id}`.toLowerCase().includes(query));
      if (first) flyTo(first.id);
    });
    const sel = bar.querySelector<HTMLSelectElement>(".rl-color");
    if (sel) {
      sel.value = mode;
      sel.addEventListener("change", () => recolor(sel.value as typeof mode));
    }
    bar.querySelector('[data-act="reset"]')!.addEventListener("click", () => {
      select(null);
      flyHome();
    });
    for (const chip of bar.querySelectorAll<HTMLButtonElement>(".rl-chip"))
      chip.addEventListener("click", () => {
        const k = chip.dataset.kind as Kind;
        if (hidden.has(k)) hidden.delete(k);
        else hidden.add(k);
        chip.setAttribute("aria-pressed", String(!hidden.has(k)));
        apply();
      });
  }

  function renderLegend() {
    const el = container.querySelector(".rl-legend");
    if (!el) return;
    const ov = mode === "kind" ? undefined : overlays[mode];
    el.innerHTML = ov ? ov.legend.map((l) => `<span style="--k:${l.color}">${esc(l.label)}</span>`).join("") : "";
  }

  function renderPanel(id: string) {
    const n = scene.nodes.find((x) => x.id === id)!;
    const nb = neighbours(id);
    const name = (x: string) => scene.nodes.find((y) => y.id === x)?.label ?? x;
    const link = (x: string) => `<button type="button" class="rl-link" data-go="${esc(x)}">${esc(name(x))}</button>`;
    const edgeLabel = (a: string, b: string) => scene.edges.find((e) => e.from === a && e.to === b)?.label;
    panel.innerHTML = `<button type="button" class="rl-close" aria-label="Close">×</button>
      <p class="rl-kind" style="--k:${PALETTE[n.kind]}">${KIND_LABEL[n.kind]}</p>
      <h3>${esc(n.label)}</h3>${n.note ? `<p class="rl-note">${esc(n.note)}</p>` : ""}
      ${n.description ? `<p>${esc(n.description)}</p>` : ""}
      ${overlays.activity?.notes?.[id] ? `<h4>Activity</h4><p>${esc(overlays.activity.notes[id]!)}</p>` : ""}
      ${overlays.team?.notes?.[id] ? `<h4>Owners</h4><p>${esc(overlays.team.notes[id]!)}</p>` : ""}
      ${n.paths.length ? `<h4>Code</h4><ul class="rl-paths">${n.paths.map((p) => `<li><code>${esc(p)}</code></li>`).join("")}</ul>` : ""}
      ${nb.calls.length ? `<h4>Calls</h4><ul>${nb.calls.map((x) => `<li>${link(x)}${edgeLabel(id, x) ? ` <small>${esc(edgeLabel(id, x)!)}</small>` : ""}</li>`).join("")}</ul>` : ""}
      ${nb.calledBy.length ? `<h4>Called by</h4><ul>${nb.calledBy.map((x) => `<li>${link(x)}${edgeLabel(x, id) ? ` <small>${esc(edgeLabel(x, id)!)}</small>` : ""}</li>`).join("")}</ul>` : ""}`;
    panel.querySelector(".rl-close")!.addEventListener("click", () => select(null));
    for (const b of panel.querySelectorAll<HTMLButtonElement>("[data-go]")) b.addEventListener("click", () => select(b.dataset.go!));
  }

  // ---- camera moves
  const goal = { target: controls.target.clone(), pos: camera.position.clone(), active: false };
  const home = { target: controls.target.clone(), pos: camera.position.clone() };
  function flyTo(id: string) {
    const part = parts.get(id);
    if (!part) return;
    const t = new THREE.Vector3(part.p.gx + FOOT / 2, 0.8, part.p.gy + FOOT / 2);
    const offset = camera.position.clone().sub(controls.target).setLength(Math.min(14, span * 0.9));
    goal.target.copy(t);
    goal.pos.copy(t).add(offset);
    goal.active = true;
    controls.autoRotate = false;
  }
  function flyHome() {
    goal.target.copy(home.target);
    goal.pos.copy(home.pos);
    goal.active = true;
  }
  function select(id: string | null) {
    selected = id && parts.has(id) ? id : null;
    if (selected) {
      renderPanel(selected);
      panel.hidden = !ui;
      flyTo(selected);
    } else panel.hidden = true;
    apply();
  }

  // ---- picking (click without drag)
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let down: { x: number; y: number } | null = null;
  let hover: string | null = null;
  const pickAt = (ev: PointerEvent): string | null => {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(pickable, true).find((h) => h.object.visible && h.object.userData.id);
    return hit ? (hit.object.userData.id as string) : null;
  };
  const el = labels.domElement;
  el.addEventListener("pointerdown", (ev) => {
    down = { x: ev.clientX, y: ev.clientY };
  });
  el.addEventListener("pointerup", (ev) => {
    if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 5) select(pickAt(ev));
    down = null;
  });
  el.addEventListener("pointermove", (ev) => {
    if (down) return;
    const id = pickAt(ev);
    if (id === hover) return;
    if (hover) {
      parts.get(hover)?.b.group.position.setY(0);
      parts.get(hover)?.label.classList.remove("is-hover");
    }
    hover = id;
    if (hover) {
      parts.get(hover)?.b.group.position.setY(0.12);
      parts.get(hover)?.label.classList.add("is-hover");
    }
    el.style.cursor = hover ? "pointer" : "";
  });

  // ---- sizing + loop
  const resize = () => {
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 520;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    container.classList.toggle("rl-narrow", w < 640);
    // portrait screens need the camera further back to fit the whole town; only before the user takes over
    if (!touched && !goal.active) {
      const fit = w < h ? (h / w) ** 0.75 : 1;
      camera.position.copy(baseTarget).addScaledVector(baseOffset, fit);
      home.pos.copy(camera.position);
    }
  };
  renderLegend();
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  apply();

  const clock = new THREE.Clock();
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const t = reduce ? 0 : clock.getElapsedTime();
    if (goal.active) {
      controls.target.lerp(goal.target, 0.08);
      camera.position.lerp(goal.pos, 0.08);
      if (camera.position.distanceTo(goal.pos) < 0.05) goal.active = false;
    }
    controls.update();
    for (const { b } of parts.values()) b.tick?.(t);
    for (const pp of pipes) {
      const n = pp.dots.count;
      for (let i = 0; i < n; i++) {
        const u = (((t * 0.9) / pp.len + i / n) % 1 + 1) % 1;
        dummy.position.copy(pp.curve.getPointAt(u)).setY(0.17);
        dummy.updateMatrix();
        pp.dots.setMatrixAt(i, dummy.matrix);
      }
      pp.dots.instanceMatrix.needsUpdate = true;
    }
    for (const part of parts.values())
      if (part.ring && !reduce) (part.ring.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 3) * 0.35;
    renderer.render(world, camera);
    labels.render(world, camera);
  };
  loop();

  return {
    select,
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      world.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) x.dispose();
      });
      renderer.dispose();
      container.innerHTML = "";
      container.classList.remove("rl-root");
    },
  };
}
