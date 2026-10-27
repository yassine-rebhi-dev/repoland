import { FOOT, type Layout, type PlacedNode, type Pt, layout as computeLayout } from "./layout.js";
import type { Kind, Scene } from "./scene.js";

/** Pixels per grid unit. Screen x = (gx - gy) * U, screen y = (gx + gy) * U / 2 - z * U. */
const U = 34;
const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const PALETTE: Record<Kind, string> = {
  user: "#f2a65a",
  frontend: "#4c8df6",
  service: "#6c63ff",
  worker: "#e86a92",
  database: "#21a98e",
  cache: "#ef5b5b",
  queue: "#f2bd3c",
  storage: "#8794a8",
  external: "#c9d3e1",
  cli: "#2f3542",
  library: "#a06cd5",
  model: "#16b9cc",
};

export interface RenderOptions {
  /** Animated flow along pipes (respects prefers-reduced-motion). Default true. */
  animate?: boolean;
  /** Small "made with repoland" line in the corner. Default true. */
  credit?: boolean;
  /** Impact view: changed parts get a red ring, affected (callers) an amber one, everything else fades. */
  highlight?: { changed: string[]; affected: string[] };
  /** "light" (default) or "dark" (for dark-mode READMEs). */
  theme?: ThemeName;
  /** Recolour parts (heatmap, teams…): per-part colour and note, plus legend entries shown under the title. */
  overlay?: Overlay;
}

export interface Overlay {
  colors: Record<string, string>;
  notes?: Record<string, string>;
  legend: { label: string; color: string }[];
}

export type ThemeName = "light" | "dark";
interface Theme {
  bg: string; slab: string; grid: string; plinth: string; pipeOuter: string; pipeInner: string;
  card: string; line: string; ink: string; muted: string; pillInk: string; credit: string; shadow: string;
}
export const THEMES: Record<ThemeName, Theme> = {
  light: { bg: "#f4f7fb", slab: "#dfe6ef", grid: "#c7d1de", plinth: "#cfd8e4", pipeOuter: "#b7c2d1", pipeInner: "#eef2f7",
    card: "#ffffff", line: "#c7d1de", ink: "#17202e", muted: "#5a6475", pillInk: "#3d4757", credit: "#8a94a6", shadow: "#1b2433" },
  dark: { bg: "#0f1520", slab: "#253043", grid: "#33405a", plinth: "#3a475c", pipeOuter: "#46546b", pipeInner: "#1f2938",
    card: "#1b2433", line: "#3a475c", ink: "#e8ecf2", muted: "#a3adbd", pillInk: "#c9d2df", credit: "#6f7b8f", shadow: "#000000" },
};
/** Active theme for the current (synchronous) render. */
let T: Theme = THEMES.light;
let OV: Overlay | undefined;
const noteOf = (id: string, note: string) => OV?.notes?.[id] ?? note;
const colorOf = (id: string, kind: Kind) => OV?.colors[id] ?? PALETTE[kind];

const DISTRICTS = ["#6c63ff", "#21a98e", "#f2a65a", "#e86a92", "#4c8df6", "#a06cd5"];
const CHANGED = "#e5484d";
const AFFECTED = "#f5a524";

// ---------- colour + geometry helpers ----------

function shade(hex: string, amt: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt)),
  );
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const r1 = (v: number) => Math.round(v * 10) / 10;

class Canvas {
  parts: string[] = [];
  /** Colours used by gradient-filled shapes; their <defs> are emitted from this set. */
  cylColors = new Set<string>();
  orbColors = new Set<string>();
  minX = Number.POSITIVE_INFINITY;
  minY = Number.POSITIVE_INFINITY;
  maxX = Number.NEGATIVE_INFINITY;
  maxY = Number.NEGATIVE_INFINITY;

  p(gx: number, gy: number, z = 0): Pt {
    const x = (gx - gy) * U;
    const y = ((gx + gy) * U) / 2 - z * U;
    this.minX = Math.min(this.minX, x);
    this.maxX = Math.max(this.maxX, x);
    this.minY = Math.min(this.minY, y);
    this.maxY = Math.max(this.maxY, y);
    return [x, y];
  }

  extend(x: number, y: number) {
    this.minX = Math.min(this.minX, x);
    this.maxX = Math.max(this.maxX, x);
    this.minY = Math.min(this.minY, y);
    this.maxY = Math.max(this.maxY, y);
  }

  poly(pts: Pt[], fill: string, extra = "") {
    this.parts.push(`<polygon points="${pts.map(([x, y]) => `${r1(x)},${r1(y)}`).join(" ")}" fill="${fill}"${extra}/>`);
  }

  raw(s: string) {
    this.parts.push(s);
  }

  /** Axis-aligned box: origin (x, y) on the ground, size w (along gx) x d (along gy), height h, sitting at z. */
  box(x: number, y: number, w: number, d: number, h: number, color: string, z = 0) {
    const g = (gx: number, gy: number, gz: number) => this.p(gx, gy, gz);
    const top = shade(color, 0.28);
    const left = color;
    const right = shade(color, -0.22);
    const edge = ` stroke="${shade(color, -0.35)}" stroke-width="0.6" stroke-linejoin="round"`;
    this.poly([g(x, y + d, z), g(x + w, y + d, z), g(x + w, y + d, z + h), g(x, y + d, z + h)], left, edge);
    this.poly([g(x + w, y, z), g(x + w, y + d, z), g(x + w, y + d, z + h), g(x + w, y, z + h)], right, edge);
    this.poly([g(x, y, z + h), g(x + w, y, z + h), g(x + w, y + d, z + h), g(x, y + d, z + h)], top, edge);
  }

  /** Small quads on the two visible faces of a box: windows. */
  windows(x: number, y: number, w: number, d: number, h: number, color: string, z = 0) {
    const g = (gx: number, gy: number, gz: number) => this.p(gx, gy, gz);
    const glass = shade(color, 0.62);
    const rows = Math.max(1, Math.floor(h / 0.42));
    for (let r = 0; r < rows; r++) {
      const z0 = z + 0.22 + r * 0.42;
      for (let c = 0; c < Math.max(1, Math.floor(w / 0.42)); c++) {
        const x0 = x + 0.16 + c * 0.42;
        if (x0 + 0.22 > x + w - 0.1) break;
        this.poly([g(x0, y + d, z0), g(x0 + 0.22, y + d, z0), g(x0 + 0.22, y + d, z0 + 0.2), g(x0, y + d, z0 + 0.2)], glass, ' opacity="0.9"');
      }
      for (let c = 0; c < Math.max(1, Math.floor(d / 0.42)); c++) {
        const y0 = y + 0.16 + c * 0.42;
        if (y0 + 0.22 > y + d - 0.1) break;
        this.poly([g(x + w, y0, z0), g(x + w, y0 + 0.22, z0), g(x + w, y0 + 0.22, z0 + 0.2), g(x + w, y0, z0 + 0.2)], shade(glass, -0.12), ' opacity="0.9"');
      }
    }
  }

  /** Vertical cylinder centred on (cx, cy), radius r (grid units), height h, sitting at z. */
  cylinder(cx: number, cy: number, r: number, h: number, color: string, z = 0, bands = 0) {
    const [x0, y0] = this.p(cx, cy, z);
    const [, y1] = this.p(cx, cy, z + h);
    const rx = r * U * Math.SQRT2;
    const ry = rx / 2;
    this.extend(x0 - rx, y1 - ry);
    this.extend(x0 + rx, y0 + ry);
    this.cylColors.add(color);
    const side = `M${r1(x0 - rx)},${r1(y1)} L${r1(x0 - rx)},${r1(y0)} A${r1(rx)},${r1(ry)} 0 0 0 ${r1(x0 + rx)},${r1(y0)} L${r1(x0 + rx)},${r1(y1)} Z`;
    this.raw(`<path d="${side}" fill="url(#cyl-${color.slice(1)})" stroke="${shade(color, -0.35)}" stroke-width="0.6"/>`);
    for (let b = 1; b <= bands; b++) {
      const yb = y0 - ((y0 - y1) * b) / (bands + 1);
      this.raw(`<path d="M${r1(x0 - rx)},${r1(yb)} A${r1(rx)},${r1(ry)} 0 0 0 ${r1(x0 + rx)},${r1(yb)}" fill="none" stroke="${shade(color, -0.3)}" stroke-width="1.4" opacity="0.6"/>`);
    }
    this.raw(`<ellipse cx="${r1(x0)}" cy="${r1(y1)}" rx="${r1(rx)}" ry="${r1(ry)}" fill="${shade(color, 0.3)}" stroke="${shade(color, -0.35)}" stroke-width="0.6"/>`);
  }

  shadow(cx: number, cy: number, r: number, opacity = 0.18) {
    const [x, y] = this.p(cx, cy, 0);
    const rx = r * U * Math.SQRT2;
    this.raw(`<ellipse cx="${r1(x)}" cy="${r1(y)}" rx="${r1(rx)}" ry="${r1(rx / 2)}" fill="${T.shadow}" opacity="${opacity}"/>`);
  }
}

// ---------- buildings ----------

/** Draws the building for one node; returns the height of its top (grid units) for label placement. */
function building(cv: Canvas, n: PlacedNode, degree: number, nth: number): number {
  // siblings of the same kind get a slight tint shift so a row of services doesn't look copy-pasted
  const c = OV?.colors[n.node.id] ?? shade(PALETTE[n.node.kind], [0, 0.14, -0.1, 0.24][nth % 4]!);
  // hubs stand taller: height grows with the number of connections
  const grow = Math.min(degree, 5) * 0.22;
  const x = n.gx;
  const y = n.gy;
  const m = FOOT / 2; // centre offset
  // pad: every building stands on a small plinth so it reads as a lot on the map
  cv.box(x + 0.05, y + 0.05, FOOT - 0.1, FOOT - 0.1, 0.12, T.plinth);
  switch (n.node.kind) {
    case "service": {
      const h = 1.2 + grow;
      cv.box(x + 0.25, y + 0.25, 1.5, 1.5, h, c, 0.12);
      cv.windows(x + 0.25, y + 0.25, 1.5, 1.5, h, c, 0.12);
      cv.box(x + 0.6, y + 0.6, 0.5, 0.5, 0.3, shade(c, -0.1), h + 0.12);
      return h + 0.6;
    }
    case "frontend": {
      // a standing screen: thin slab facing +x, on a foot
      cv.box(x + 0.85, y + 0.75, 0.3, 0.5, 0.35, "#9aa6b8", 0.12);
      cv.box(x + 0.75, y + 0.15, 0.22, 1.7, 1.45, c, 0.47);
      const g = (gx: number, gy: number, gz: number) => cv.p(gx, gy, gz);
      const fx = x + 0.97;
      cv.poly([g(fx, y + 0.27, 0.62), g(fx, y + 1.73, 0.62), g(fx, y + 1.73, 1.8), g(fx, y + 0.27, 1.8)], shade(c, 0.7));
      for (let i = 0; i < 3; i++) {
        const yy = y + 0.37 + i * 0.12;
        cv.poly([g(fx, yy, 1.66), g(fx, yy + 0.07, 1.66), g(fx, yy + 0.07, 1.73), g(fx, yy, 1.73)], shade(c, -0.1));
      }
      for (let i = 0; i < 3; i++) {
        const z0 = 0.8 + i * 0.25;
        cv.poly([g(fx, y + 0.45, z0), g(fx, y + 1.5 - i * 0.2, z0), g(fx, y + 1.5 - i * 0.2, z0 + 0.09), g(fx, y + 0.45, z0 + 0.09)], shade(c, 0.35));
      }
      return 2.1;
    }
    case "worker":
      cv.box(x + 0.2, y + 0.3, 1.6, 1.4, 1.0, c, 0.12);
      cv.windows(x + 0.2, y + 0.3, 1.6, 1.4, 0.8, c, 0.12);
      cv.box(x + 0.35, y + 0.4, 0.32, 0.32, 1.3, shade(c, -0.15), 1.12);
      for (const [i, r] of [0.18, 0.24, 0.3].entries()) {
        const [sx, sy] = cv.p(x + 0.5 - i * 0.18, y + 0.55 - i * 0.12, 2.6 + i * 0.38);
        cv.raw(`<circle cx="${r1(sx)}" cy="${r1(sy)}" r="${r1(r * U)}" fill="#ffffff" opacity="${0.75 - i * 0.18}"/>`);
        cv.extend(sx, sy - r * U);
      }
      return 2.7;
    case "database":
      cv.cylinder(x + m, y + m, 0.78, 1.5, c, 0.12, 2);
      return 1.95;
    case "cache":
      for (let i = 0; i < 3; i++) cv.box(x + 0.3, y + 0.3, 1.4, 1.4, 0.32, i === 1 ? shade(c, 0.12) : c, 0.12 + i * 0.42);
      return 1.6;
    case "queue":
      cv.box(x + 0.1, y + 0.55, 1.8, 0.9, 0.35, "#5b6577", 0.12);
      cv.box(x + 0.1, y + 0.55, 1.8, 0.9, 0.06, c, 0.47);
      for (let i = 0; i < 3; i++) cv.box(x + 0.2 + i * 0.58, y + 0.72, 0.4, 0.55, 0.38, shade(c, i % 2 ? 0.15 : -0.08), 0.53);
      return 1.2;
    case "storage":
      cv.box(x + 0.25, y + 0.25, 1.5, 1.5, 1.15, c, 0.12);
      {
        const g = (gx: number, gy: number, gz: number) => cv.p(gx, gy, gz);
        const s = shade(c, -0.32);
        const line = (a: Pt, b: Pt) => cv.raw(`<line x1="${r1(a[0])}" y1="${r1(a[1])}" x2="${r1(b[0])}" y2="${r1(b[1])}" stroke="${s}" stroke-width="1.2" opacity="0.7"/>`);
        line(g(x + 0.25, y + 1.75, 0.12), g(x + 1.75, y + 1.75, 1.27));
        line(g(x + 1.75, y + 0.25, 0.12), g(x + 1.75, y + 1.75, 1.27));
        line(g(x + 0.25, y + 1.75, 0.7), g(x + 1.75, y + 1.75, 0.7));
      }
      return 1.6;
    case "external": {
      cv.shadow(x + m, y + m, 0.7, 0.12);
      const puffs: [number, number, number][] = [[-0.45, 0.1, 0.42], [0.05, -0.15, 0.55], [0.5, 0.1, 0.4], [0.1, 0.25, 0.42]];
      const [cx, cy] = cv.p(x + m, y + m, 1.55);
      for (const [dx, dy, r] of puffs) {
        cv.raw(`<circle cx="${r1(cx + dx * U * 1.4)}" cy="${r1(cy + dy * U * 1.4)}" r="${r1(r * U * 1.25)}" fill="#ffffff" stroke="${shade(c, -0.25)}" stroke-width="0.8"/>`);
        cv.extend(cx + dx * U * 1.4, cy + dy * U * 1.4 - r * U * 1.25);
      }
      cv.raw(`<ellipse cx="${r1(cx)}" cy="${r1(cy + 0.2 * U)}" rx="${r1(U * 1.15)}" ry="${r1(U * 0.32)}" fill="#ffffff"/>`);
      return 2.5;
    }
    case "cli": {
      cv.box(x + 0.25, y + 0.35, 1.5, 1.3, 1.05, c, 0.12);
      // prompt glyph drawn as geometry on the +x face so it follows the isometric plane
      const g = (gx: number, gy: number, gz: number) => cv.p(gx, gy, gz);
      const fx = x + 1.75;
      const chev = [g(fx, y + 0.6, 0.85), g(fx, y + 0.82, 0.68), g(fx, y + 0.6, 0.51)];
      cv.raw(`<polyline points="${chev.map(([a, b]) => `${r1(a)},${r1(b)}`).join(" ")}" fill="none" stroke="#5af78e" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`);
      const [u0, u1] = [g(fx, y + 0.95, 0.5), g(fx, y + 1.3, 0.5)];
      cv.raw(`<line x1="${r1(u0[0])}" y1="${r1(u0[1])}" x2="${r1(u1[0])}" y2="${r1(u1[1])}" stroke="#5af78e" stroke-width="2.4" stroke-linecap="round"/>`);
      return 1.6;
    }
    case "library":
      [0.32, 0.3, 0.34].forEach((hgt, i) => {
        const col = [c, shade(c, 0.25), shade(c, -0.15)][i]!;
        cv.box(x + 0.25 + i * 0.06, y + 0.3 - i * 0.04, 1.45, 1.35, hgt, col, 0.12 + i * 0.34);
      });
      return 1.6;
    case "model": {
      cv.box(x + 0.45, y + 0.45, 1.1, 1.1, 0.5, "#3b4658", 0.12);
      const [ox, oy] = cv.p(x + m, y + m, 1.35);
      cv.raw(`<circle cx="${r1(ox)}" cy="${r1(oy)}" r="${r1(U * 0.95)}" fill="${c}" opacity="0.18"/>`);
      cv.orbColors.add(c);
      cv.raw(`<circle cx="${r1(ox)}" cy="${r1(oy)}" r="${r1(U * 0.6)}" fill="url(#orb-${c.slice(1)})" stroke="${shade(c, -0.3)}" stroke-width="0.6"/>`);
      cv.extend(ox, oy - U * 0.95);
      return 2.2;
    }
    case "user": {
      cv.cylinder(x + m, y + m, 0.55, 0.12, T.plinth, 0.12);
      const [bx, by] = cv.p(x + m, y + m, 0.24);
      const s = U / 30;
      cv.raw(`<path d="M${r1(bx - 11 * s)},${r1(by)} C${r1(bx - 11 * s)},${r1(by - 30 * s)} ${r1(bx + 11 * s)},${r1(by - 30 * s)} ${r1(bx + 11 * s)},${r1(by)} Z" fill="${c}" stroke="${shade(c, -0.35)}" stroke-width="0.6"/>`);
      cv.raw(`<circle cx="${r1(bx)}" cy="${r1(by - 36 * s)}" r="${r1(9 * s)}" fill="${shade(c, 0.35)}" stroke="${shade(c, -0.35)}" stroke-width="0.6"/>`);
      cv.extend(bx, by - 46 * s);
      return 1.75;
    }
  }
}

// ---------- labels ----------

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Approximate rendered width of sans-serif text without a font engine (generous, so text never overflows). */
export function textWidth(s: string, size: number, bold: boolean): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x2e80) w += size * 1.02; // CJK and other full-width glyphs
    else if (ch === " ") w += size * 0.3;
    else if (/[A-Z0-9MW@%]/.test(ch)) w += size * 0.68;
    else if (/[iljt.,:;'|!]/.test(ch)) w += size * 0.3;
    else w += size * 0.56;
  }
  return w * (bold ? 1.07 : 1);
}

const overlaps = (a: Rect, b: Rect, gap = 0) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;
const segLen = ([a, b]: readonly [Pt, Pt]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

interface Card {
  n: PlacedNode;
  rect: Rect;
  /** Where the card's pointer should touch: just above the building. */
  ax: number;
  ay: number;
}

function placeCards(cv: Canvas, l: Layout, tops: Map<string, number>): { cards: Card[]; buildings: Rect[] } {
  const cards: Card[] = [];
  const order = [...l.nodes].sort((a, b) => a.gx + a.gy - (b.gx + b.gy) || a.gx - b.gx);
  // screen-space box of every building (footprint diamond up to its roof), so cards don't hide other buildings
  const buildingBox = new Map<string, Rect>(
    l.nodes.map((n) => {
      const left = cv.p(n.gx, n.gy + FOOT, 0)[0];
      const right = cv.p(n.gx + FOOT, n.gy, 0)[0];
      const bottom = cv.p(n.gx + FOOT, n.gy + FOOT, 0)[1];
      const top = cv.p(n.gx, n.gy, tops.get(n.node.id)!)[1];
      return [n.node.id, { x0: left + 8, y0: top, x1: right - 8, y1: bottom - 10 }];
    }),
  );
  for (const n of order) {
    const [ax, ay] = cv.p(n.gx + FOOT / 2, n.gy + FOOT / 2, tops.get(n.node.id)! + 0.35);
    const note = noteOf(n.node.id, n.node.note);
    const w = Math.max(textWidth(n.node.label, 13, true) + 32, note ? textWidth(note, 11, false) + 22 : 0, 64);
    const h = note ? 41 : 26;
    const rect: Rect = { x0: ax - w / 2, y0: ay - h, x1: ax + w / 2, y1: ay };
    // nearest free slot: small sideways shifts first, then lift in card-height steps (leader line drawn later)
    const free = (dx: number, dy: number) => {
      const r = { x0: rect.x0 + dx, y0: rect.y0 + dy, x1: rect.x1 + dx, y1: rect.y1 + dy };
      if (cards.some((c) => overlaps(r, c.rect, 4))) return null;
      for (const [id, b] of buildingBox) if (id !== n.node.id && overlaps(r, b, 2)) return null;
      return r;
    };
    // cheapest free slot: lifting is cheaper than sliding sideways (sideways cards drift onto other buildings)
    const moves: [number, number][] = [];
    for (let step = 0; step < 30; step++)
      for (const dx of [0, -0.55 * w, 0.55 * w, -1.1 * w, 1.1 * w]) moves.push([dx, -step * (h + 6) * 0.5]);
    moves.sort((a, b) => Math.abs(a[0]) * 2.5 + Math.abs(a[1]) - (Math.abs(b[0]) * 2.5 + Math.abs(b[1])));
    for (const [dx, dy] of moves) {
      const r = free(dx, dy);
      if (r) {
        Object.assign(rect, r);
        break;
      }
    }
    cv.extend(rect.x0, rect.y0);
    cv.extend(rect.x1, rect.y0);
    cards.push({ n, rect, ax, ay });
  }
  return { cards, buildings: [...buildingBox.values()] };
}

function legend(items: { label: string; color: string }[], x: number, y: number): string {
  let cx = x;
  return items
    .map((g) => {
      const c = g.color;
      const out = `<rect x="${r1(cx)}" y="${r1(y - 10)}" width="12" height="12" rx="3" fill="${c}" fill-opacity="0.35" stroke="${c}"/><text x="${r1(cx + 18)}" y="${r1(y)}" font-family="${FONT}" font-size="12" fill="${T.pillInk}">${esc(g.label)}</text>`;
      cx += 30 + textWidth(g.label, 12, false);
      return out;
    })
    .join("");
}

// ---------- the whole picture ----------

export function renderSvg(scene: Scene, opts: RenderOptions = {}): string {
  T = THEMES[opts.theme ?? "light"];
  OV = opts.overlay;
  const animate = opts.animate ?? true;
  const credit = opts.credit ?? true;
  const l: Layout = computeLayout(scene);
  const cv = new Canvas();
  const pad = 1.1;
  const { minX, minY, maxX, maxY } = l.bounds;
  const X0 = minX - pad;
  const Y0 = minY - pad;
  const X1 = maxX + pad;
  const Y1 = maxY + pad;

  // platform slab
  const SLAB = 0.55;
  cv.box(X0, Y0, X1 - X0, Y1 - Y0, SLAB, T.slab, -SLAB);
  for (let gx = Math.ceil(X0); gx < X1; gx++) {
    const [a, b] = [cv.p(gx, Y0, 0), cv.p(gx, Y1, 0)];
    cv.raw(`<line x1="${r1(a[0])}" y1="${r1(a[1])}" x2="${r1(b[0])}" y2="${r1(b[1])}" stroke="${T.grid}" stroke-width="0.6"/>`);
  }
  for (let gy = Math.ceil(Y0); gy < Y1; gy++) {
    const [a, b] = [cv.p(X0, gy, 0), cv.p(X1, gy, 0)];
    cv.raw(`<line x1="${r1(a[0])}" y1="${r1(a[1])}" x2="${r1(b[0])}" y2="${r1(b[1])}" stroke="${T.grid}" stroke-width="0.6"/>`);
  }

  // districts: each member's lot is tinted with its district colour (a legend under the title names them).
  // Per-lot tint instead of one big zone: groups don't follow flow layers, so big zones would overlap.
  const groupColor = new Map(scene.groups.map((g, i) => [g.id, DISTRICTS[i % DISTRICTS.length]!]));
  for (const n of l.nodes) {
    const c = groupColor.get(n.node.group);
    if (!c) continue;
    const m = 0.32;
    cv.poly([cv.p(n.gx - m, n.gy - m, 0.01), cv.p(n.gx + FOOT + m, n.gy - m, 0.01), cv.p(n.gx + FOOT + m, n.gy + FOOT + m, 0.01), cv.p(n.gx - m, n.gy + FOOT + m, 0.01)], c, ` fill-opacity="0.2" stroke="${c}" stroke-opacity="0.6" stroke-width="1.2" stroke-dasharray="4 3"`);
  }
  const usedGroups = scene.groups.filter((g) => l.nodes.some((n) => n.node.group === g.id));

  // impact view: who is lit and who fades
  const hl = opts.highlight;
  const state = (id: string): "changed" | "affected" | "dim" | "normal" =>
    !hl ? "normal" : hl.changed.includes(id) ? "changed" : hl.affected.includes(id) ? "affected" : "dim";
  const lit = (id: string) => state(id) === "changed" || state(id) === "affected";

  // pipes on the ground
  const byId = new Map(l.nodes.map((n) => [n.node.id, n]));
  for (const e of l.edges) {
    const fade = hl && !(lit(e.edge.from) && lit(e.edge.to));
    if (fade) cv.raw('<g opacity="0.22">');
    const pts = e.points.map(([gx, gy]) => cv.p(gx, gy, 0.02));
    const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${r1(x)},${r1(y)}`).join(" ");
    const col = colorOf(e.edge.from, byId.get(e.edge.from)!.node.kind);
    const flowCol = e.edge.from && byId.get(e.edge.from)!.node.kind === "external" ? "#8794a8" : col;
    cv.raw(`<path d="${d}" fill="none" stroke="${T.pipeOuter}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`);
    cv.raw(`<path d="${d}" fill="none" stroke="${T.pipeInner}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`);
    cv.raw(`<path d="${d}" fill="none" stroke="${flowCol}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"${animate ? ' class="flow"' : ' stroke-dasharray="2 10"'}${e.back ? ' opacity="0.7"' : ""}/>`);
    const [ex, ey] = pts[pts.length - 1]!;
    cv.raw(`<circle cx="${r1(ex)}" cy="${r1(ey)}" r="4.5" fill="${flowCol}" stroke="${T.card}" stroke-width="1.5"/>`);
    if (fade) cv.raw("</g>");
  }

  // buildings, back to front
  const tops = new Map<string, number>();
  const degree = new Map<string, number>();
  for (const e of scene.edges) for (const id of [e.from, e.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const nthOfKind = new Map<string, number>();
  const kindCount = new Map<string, number>();
  for (const n of scene.nodes) {
    nthOfKind.set(n.id, kindCount.get(n.kind) ?? 0);
    kindCount.set(n.kind, (kindCount.get(n.kind) ?? 0) + 1);
  }
  for (const n of [...l.nodes].sort((a, b) => a.gx + a.gy - (b.gx + b.gy) || a.gx - b.gx)) {
    const st = state(n.node.id);
    if (st === "changed" || st === "affected") {
      const [rx, ry] = cv.p(n.gx + FOOT / 2, n.gy + FOOT / 2, 0.14);
      const r = 1.25 * U * Math.SQRT2;
      const col = st === "changed" ? CHANGED : AFFECTED;
      cv.raw(`<ellipse cx="${r1(rx)}" cy="${r1(ry)}" rx="${r1(r)}" ry="${r1(r / 2)}" fill="${col}" fill-opacity="0.16" stroke="${col}" stroke-width="3"${animate && st === "changed" ? ' class="pulse"' : ""}/>`);
    }
    if (st === "dim") cv.raw('<g opacity="0.28">');
    tops.set(n.node.id, building(cv, n, degree.get(n.node.id) ?? 0, nthOfKind.get(n.node.id) ?? 0));
    if (st === "dim") cv.raw("</g>");
  }

  // label cards: place back to front; a card that would overlap an earlier one is lifted, with a leader line
  const { cards, buildings } = placeCards(cv, l, tops);

  // edge labels: slide along the pipe until the pill clears every card and earlier pill
  const taken: Rect[] = [...cards.map((c) => c.rect), ...buildings];
  for (const e of l.edges) {
    if (!e.edge.label) continue;
    const w = textWidth(e.edge.label, 11, false) + 16;
    const candidates: Pt[] = [];
    const segs = e.points.slice(1).map((b, i) => [e.points[i]!, b] as const);
    segs.sort((s, t) => segLen(t) - segLen(s));
    for (const [a, b] of segs)
      for (const f of [0.5, 0.32, 0.68, 0.18, 0.82]) candidates.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    const rectAt = (g: Pt): Rect => {
      const [x, y] = cv.p(g[0], g[1], 0.05);
      return { x0: x - w / 2, y0: y - 10, x1: x + w / 2, y1: y + 9 };
    };
    const pick = candidates.map(rectAt).find((r) => !taken.some((t) => overlaps(r, t, 3))) ?? rectAt(candidates[0]!);
    taken.push(pick);
    const cx = (pick.x0 + pick.x1) / 2;
    cv.raw(`<g><rect x="${r1(pick.x0)}" y="${r1(pick.y0)}" width="${r1(w)}" height="19" rx="9.5" fill="${T.card}" stroke="${T.line}" stroke-width="0.8"/><text x="${r1(cx)}" y="${r1(pick.y0 + 14)}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${T.pillInk}">${esc(e.edge.label)}</text></g>`);
  }

  for (const c of cards) {
    const { n, rect, ax, ay } = c;
    const st = state(n.node.id);
    const col = st === "changed" ? CHANGED : st === "affected" ? AFFECTED : colorOf(n.node.id, n.node.kind);
    if (st === "dim") cv.raw('<g opacity="0.45">');
    const cx = (rect.x0 + rect.x1) / 2;
    const moved = rect.y1 < ay - 1 || Math.abs(cx - ax) > 1;
    const parts = [
      `<g data-card="${r1(rect.x0)},${r1(rect.y0)},${r1(rect.x1)},${r1(rect.y1)}">`,
      moved ? `<line x1="${r1(ax)}" y1="${r1(ay)}" x2="${r1(cx)}" y2="${r1(rect.y1)}" stroke="${shade(col, -0.1)}" stroke-width="1.2" stroke-dasharray="3 3"/>` : "",
      `<path d="M${r1(cx - 5)},${r1(rect.y1)} L${r1(cx)},${r1(rect.y1 + 6)} L${r1(cx + 5)},${r1(rect.y1)} Z" fill="${T.card}"/>`,
      `<rect x="${r1(rect.x0)}" y="${r1(rect.y0)}" width="${r1(rect.x1 - rect.x0)}" height="${r1(rect.y1 - rect.y0)}" rx="7" fill="${T.card}" stroke="${shade(col, -0.1)}" stroke-width="1.2"/>`,
      `<rect x="${r1(rect.x0 + 9)}" y="${r1(rect.y0 + 9)}" width="7" height="7" rx="2" fill="${col}"/>`,
      `<text x="${r1(rect.x0 + 21)}" y="${r1(rect.y0 + 17.5)}" font-family="${FONT}" font-size="13" font-weight="650" fill="${T.ink}">${esc(n.node.label)}</text>`,
      noteOf(n.node.id, n.node.note) ? `<text x="${r1(rect.x0 + 11)}" y="${r1(rect.y0 + 33)}" font-family="${FONT}" font-size="11" fill="${T.muted}">${esc(noteOf(n.node.id, n.node.note))}</text>` : "",
      "</g>",
    ];
    cv.raw(parts.join(""));
    if (st === "dim") cv.raw("</g>");
  }

  // frame
  const M = 40;
  // an overlay (heat, teams) explains its colours in the legend; otherwise the legend names the districts
  const legendItems = OV?.legend.length ? OV.legend : usedGroups.map((g) => ({ label: g.label, color: groupColor.get(g.id)! }));
  const titleH = (scene.subtitle ? 74 : 54) + (legendItems.length ? 26 : 0);
  const vx = cv.minX - M;
  const vy = cv.minY - M - titleH;
  const vw = Math.max(cv.maxX - cv.minX + 2 * M, scene.title.length * 15 + 2 * M, scene.subtitle.length * 7.4 + 2 * M);
  const vh = cv.maxY - cv.minY + 2 * M + titleH + (credit ? 10 : 0);
  const defs: string[] = [];
  for (const c of cv.cylColors)
    defs.push(`<linearGradient id="cyl-${c.slice(1)}" x1="0" x2="1"><stop offset="0" stop-color="${c}"/><stop offset="0.55" stop-color="${shade(c, 0.12)}"/><stop offset="1" stop-color="${shade(c, -0.25)}"/></linearGradient>`);
  for (const c of cv.orbColors)
    defs.push(`<radialGradient id="orb-${c.slice(1)}" cx="0.35" cy="0.35" r="0.75"><stop offset="0" stop-color="${shade(c, 0.75)}"/><stop offset="0.5" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -0.3)}"/></radialGradient>`);
  const style = animate
    ? "<style>.flow{stroke-dasharray:2 12;animation:repoland-flow 1.1s linear infinite}@keyframes repoland-flow{to{stroke-dashoffset:-14}}.pulse{animation:repoland-pulse 1.6s ease-in-out infinite}@keyframes repoland-pulse{50%{stroke-opacity:.35;fill-opacity:.05}}@media (prefers-reduced-motion:reduce){.flow,.pulse{animation:none}}</style>"
    : "";
  const tx = vx + M;
  const ty = vy + M + 4;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r1(vx)} ${r1(vy)} ${r1(vw)} ${r1(vh)}" width="${Math.round(vw)}" height="${Math.round(vh)}" role="img" aria-label="${esc(`${scene.title}: architecture map`)}">`,
    `<title>${esc(scene.title)}</title>`,
    `<defs>${defs.join("")}</defs>`,
    style,
    `<rect x="${r1(vx)}" y="${r1(vy)}" width="${r1(vw)}" height="${r1(vh)}" fill="${T.bg}"/>`,
    `<text x="${r1(tx)}" y="${r1(ty)}" font-family="${FONT}" font-size="26" font-weight="750" fill="${T.ink}">${esc(scene.title)}</text>`,
    scene.subtitle ? `<text x="${r1(tx)}" y="${r1(ty + 24)}" font-family="${FONT}" font-size="14" fill="${T.muted}">${esc(scene.subtitle)}</text>` : "",
    legend(legendItems, tx, ty + (scene.subtitle ? 50 : 26)),
    hl
      ? `<g font-family="${FONT}" font-size="13" fill="${T.ink}"><circle cx="${r1(vx + vw - 236)}" cy="${r1(ty - 5)}" r="6" fill="${CHANGED}"/><text x="${r1(vx + vw - 224)}" y="${r1(ty)}">changed (${hl.changed.length})</text><circle cx="${r1(vx + vw - 116)}" cy="${r1(ty - 5)}" r="6" fill="${AFFECTED}"/><text x="${r1(vx + vw - 104)}" y="${r1(ty)}">affected (${hl.affected.length})</text></g>`
      : "",
    ...cv.parts,
    credit
      ? `<text x="${r1(vx + vw - 16)}" y="${r1(vy + vh - 14)}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${T.credit}">made with repoland</text>`
      : "",
    "</svg>",
  ].join("\n");
}
