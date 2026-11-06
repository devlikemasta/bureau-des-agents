// La pièce elle-même : le parquet, les tapis de chaque coin, les murs, les grandes fenêtres sur la
// ville (le ciel suit l'heure), le néon VibesMoney, le tableau du plan, l'horloge et la porte.
// Tout ça ne bouge pas : c'est dessiné une fois, puis recopié à chaque image.
import { ROLES } from '../../shared/activity.ts';
import { pixelText, textWidth } from './font.ts';
import { BOARD, CLOCK, H, NEON, T, W, WINDOWS, ZONES } from './layout.ts';
import { g2d, hline, lighten, makeCanvas, mix, P, px, rect, rng, vline, type G } from './pixels.ts';

export type TimeOfDay = 'day' | 'evening' | 'night';

const SKY: Record<TimeOfDay, { bands: string[]; city: string; city2: string; lit: string; litRate: number }> = {
  day: { bands: ['#4f9fe8', '#68b1ef', '#83c2f3', '#a3d3f6', '#c3e3f8'], city: '#6f80a8', city2: '#8494b9', lit: '#d4e2f5', litRate: 0.08 },
  evening: { bands: ['#2a2453', '#43306a', '#6c3a72', '#a64a6c', '#dc6a5c', '#ff9d5c'], city: '#1d1631', city2: '#2a2040', lit: '#ffcf6b', litRate: 0.22 },
  night: { bands: ['#0a0a20', '#0f0f2c', '#151538', '#1c1a45', '#231e50'], city: '#0a0816', city2: '#120f22', lit: '#ffcf6b', litRate: 0.32 },
};

function floor(g: G) {
  const r = rng(42);
  const top = 3 * T;
  const colors = [P.floor1, P.floor2, P.floor3, P.floor1];
  // des lames de parquet de 6 pixels, aux raccords décalés
  for (let y = top; y < H; y += 6) {
    let x = -Math.floor(r() * 20);
    while (x < W) {
      const len = 18 + Math.floor(r() * 22);
      const col = colors[Math.floor(r() * colors.length)];
      rect(g, x, y, len, 5, col);
      hline(g, x, y, len, mix(col, P.floorHi, 0.5));
      rect(g, x, y + 5, len, 1, P.floorSeam);
      vline(g, x + len - 1, y, 5, P.floorSeam);
      if (r() < 0.12) px(g, x + 4 + Math.floor(r() * (len - 8)), y + 2, P.floorSeam);
      x += len;
    }
  }
}

function rug(g: G, x: number, y: number, w: number, h: number, color: string) {
  const base = mix(color, '#2b2232', 0.72);
  const edge = mix(color, '#2b2232', 0.5);
  const inner = mix(color, '#2b2232', 0.62);
  const px0 = x * T + 2, py0 = y * T + 2, pw = w * T - 4, ph = h * T - 4;
  rect(g, px0 + 1, py0, pw - 2, ph, base);
  rect(g, px0, py0 + 1, pw, ph - 2, base);
  // bordure
  hline(g, px0 + 1, py0, pw - 2, edge);
  hline(g, px0 + 1, py0 + ph - 1, pw - 2, edge);
  vline(g, px0, py0 + 1, ph - 2, edge);
  vline(g, px0 + pw - 1, py0 + 1, ph - 2, edge);
  // un liseré intérieur, et un motif discret
  hline(g, px0 + 3, py0 + 3, pw - 6, inner);
  hline(g, px0 + 3, py0 + ph - 4, pw - 6, inner);
  vline(g, px0 + 3, py0 + 3, ph - 6, inner);
  vline(g, px0 + pw - 4, py0 + 3, ph - 6, inner);
  for (let yy = py0 + 7; yy < py0 + ph - 6; yy += 6) for (let xx = px0 + 7 + ((yy / 6) % 2) * 3; xx < px0 + pw - 6; xx += 6) px(g, xx, yy, inner);
}

function backWall(g: G) {
  rect(g, 0, 0, W, 5, P.wallTop);
  rect(g, 0, 5, W, 39, P.wallFace);
  // boiseries : un panneau bas plus sombre, une cimaise
  rect(g, 0, 31, W, 13, P.wallFace2);
  hline(g, 0, 30, W, P.wallHi);
  hline(g, 0, 31, W, P.wallLine);
  for (let x = 8; x < W; x += 22) vline(g, x, 33, 9, P.wallLine);
  hline(g, 0, 5, W, P.wallHi);
  rect(g, 0, 44, W, 4, P.baseboard);
  hline(g, 0, 44, W, P.wallHi);
  // l'ombre du mur sur le sol
  g.fillStyle = 'rgba(8,6,16,0.35)';
  g.fillRect(0, 48, W, 2);
  g.fillStyle = 'rgba(8,6,16,0.18)';
  g.fillRect(0, 50, W, 2);
}

function windowPane(g: G, wx: number, wy: number, ww: number, wh: number, tod: TimeOfDay, seed: number) {
  const sky = SKY[tod];
  const r = rng(seed);
  // cadre
  rect(g, wx - 3, wy - 3, ww + 6, wh + 6, '#1a1724');
  rect(g, wx - 2, wy - 2, ww + 4, wh + 4, '#3b3550');
  // le ciel, en bandes (comme dans les vieux jeux)
  const bh = Math.ceil(wh / sky.bands.length);
  sky.bands.forEach((c, i) => rect(g, wx, wy + i * bh, ww, bh, c));
  if (tod === 'evening') {
    for (let i = 0; i < 9; i++) rect(g, wx + 30 + i - 4, wy + wh - 10 - Math.round(Math.sqrt(16 - (i - 4) ** 2)), 1, 6, '#ffd27a');
  }
  if (tod === 'night' && seed === 1) {
    rect(g, wx + 10, wy + 5, 6, 6, '#f2efd8');
    rect(g, wx + 9, wy + 6, 8, 4, '#f2efd8');
    px(g, wx + 12, wy + 7, '#d6d2b8');
    px(g, wx + 14, wy + 9, '#d6d2b8');
  }
  if (tod === 'day') {
    for (const [cx, cy, cw] of [[wx + 8, wy + 6, 12], [wx + 36, wy + 10, 9]]) {
      rect(g, cx, cy, cw, 3, '#ffffff');
      rect(g, cx + 2, cy - 2, cw - 5, 2, '#ffffff');
      hline(g, cx, cy + 3, cw, '#dcecf8');
    }
  }
  // la ville au loin
  let x = wx;
  while (x < wx + ww) {
    const bw = 4 + Math.floor(r() * 8);
    const bhh = 7 + Math.floor(r() * 13);
    const far = r() < 0.4;
    const top = wy + wh - bhh + (far ? 3 : 0);
    rect(g, x, top, Math.min(bw, wx + ww - x), wy + wh - top, far ? sky.city2 : sky.city);
    for (let yy = top + 2; yy < wy + wh - 1; yy += 2) {
      for (let xx = x + 1; xx < Math.min(x + bw - 1, wx + ww - 1); xx += 2) if (r() < sky.litRate) px(g, xx, yy, sky.lit);
    }
    x += bw;
  }
  // montants et traverse
  vline(g, wx + Math.floor(ww / 2), wy, wh, '#3b3550');
  vline(g, wx + Math.floor(ww / 2) + 1, wy, wh, '#2a2538');
  hline(g, wx, wy + 11, ww, '#3b3550');
  // un reflet sur la vitre
  for (let i = 0; i < 6; i++) px(g, wx + 4 + i, wy + 14 - i, 'rgba(255,255,255,0.18)');
  // l'appui de fenêtre
  rect(g, wx - 4, wy + wh + 2, ww + 8, 3, '#4a4560');
  hline(g, wx - 4, wy + wh + 2, ww + 8, '#625c7c');
}

function whiteboard(g: G) {
  const { x, y, w, h } = BOARD;
  rect(g, x - 2, y - 2, w + 4, h + 4, '#7a7e93');
  rect(g, x - 1, y - 1, w + 2, h + 2, '#c2c5d4');
  hline(g, x - 1, y - 1, w + 2, '#e6e8f0');
  rect(g, x, y, w, h, '#f4f5f9');
  // un reflet en biais
  for (let i = 0; i < 18; i++) px(g, x + w - 30 + i, y + 2 + Math.floor(i / 2), '#ffffff');
  // le rebord et les feutres
  rect(g, x + 4, y + h + 2, w - 8, 2, '#8a8ea2');
  hline(g, x + 4, y + h + 2, w - 8, '#b3b6c6');
  rect(g, x + 12, y + h + 1, 5, 1, '#e5484d');
  rect(g, x + 19, y + h + 1, 5, 1, '#3d8ad1');
  rect(g, x + 26, y + h + 1, 5, 1, '#2b2836');
  rect(g, x + w - 18, y + h + 1, 6, 2, '#e9e5ef');
  // le titre, au feutre orange
  pixelText(g, 'TABLA', x + 4, y + 3, P.orangeDark);
  hline(g, x + 4, y + 9, textWidth('TABLA'), P.orange);
}

const SIGN: Record<string, string> = { chef: 'ŠEF' };

/** Les écriteaux posés au coin de chaque tapis, avec le nombre d'agents au travail dans le coin. */
export function signs(g: G, busy: (role: string) => number) {
  for (const z of ZONES) {
    const n = busy(z.role);
    const label = (SIGN[z.role] ?? ROLES[z.role].label.toUpperCase()) + (n > 0 && z.role !== 'chef' ? ` ${n}` : '');
    const color = ROLES[z.role].color;
    const w = textWidth(label) + 6;
    const x = z.x * T + 4, y = z.role === 'chef' ? (z.y + z.h) * T - 12 : z.y * T + 3;
    rect(g, x + 1, y, w - 2, 9, '#120f19');
    rect(g, x, y + 1, w, 7, '#120f19');
    hline(g, x + 1, y, w - 2, mix(color, '#120f19', 0.45));
    pixelText(g, label, x + 3, y + 2, lighten(color, 0.15));
  }
}

/** Le néon : la tête du robot VibesMoney, en tubes de couleur (orange par défaut). */
export function neon(g: G, tube: string, core: string) {
  const { x, y } = NEON;
  // antenne
  vline(g, x + 12, y, 3, tube);
  rect(g, x + 11, y - 2, 3, 2, tube);
  // contour de la tête
  rect(g, x + 1, y + 3, 23, 1, tube);
  rect(g, x + 1, y + 20, 23, 1, tube);
  rect(g, x + 1, y + 3, 1, 18, tube);
  rect(g, x + 23, y + 3, 1, 18, tube);
  hline(g, x + 2, y + 4, 21, core);
  // la visière et les yeux
  rect(g, x + 5, y + 8, 15, 1, tube);
  rect(g, x + 5, y + 15, 15, 1, tube);
  rect(g, x + 5, y + 8, 1, 8, tube);
  rect(g, x + 19, y + 8, 1, 8, tube);
  rect(g, x + 8, y + 10, 3, 3, core);
  rect(g, x + 14, y + 10, 3, 3, core);
  // le petit support au mur
  px(g, x + 3, y + 22, '#3b3550');
  px(g, x + 21, y + 22, '#3b3550');
}

function clockFace(g: G) {
  const { x, y } = CLOCK;
  rect(g, x + 3, y, 8, 14, '#2b2836');
  rect(g, x, y + 3, 14, 8, '#2b2836');
  rect(g, x + 1, y + 1, 12, 12, '#2b2836');
  rect(g, x + 2, y + 2, 10, 10, '#f2f0f7');
  rect(g, x + 4, y + 1, 6, 12, '#f2f0f7');
  rect(g, x + 1, y + 4, 12, 6, '#f2f0f7');
  px(g, x + 7, y + 2, '#2b2836');
  px(g, x + 7, y + 11, '#2b2836');
  px(g, x + 2, y + 7, '#2b2836');
  px(g, x + 11, y + 7, '#2b2836');
}

function poster(g: G) {
  const x = 252, y = 12;
  rect(g, x, y, 10, 14, '#c08a57');
  rect(g, x + 1, y + 1, 8, 12, '#16121f');
  // une courbe qui monte, en orange
  const pts = [[2, 10], [3, 9], [4, 9], [5, 7], [6, 6], [7, 4], [8, 3]];
  for (const [px_, py_] of pts) px(g, x + px_, y + py_, P.orange);
  px(g, x + 8, y + 2, P.orangeLight);
}

function sideWalls(g: G) {
  for (const x0 of [0, W - T]) {
    rect(g, x0, 0, T, H, P.wallTop);
    const inner = x0 === 0 ? T - 2 : x0;
    vline(g, inner, 5, H - 5, '#2c2740');
    vline(g, x0 === 0 ? inner + 1 : inner + 1, 5, H - 5, '#1d1a28');
  }
  // l'ombre des murs de côté sur le sol
  g.fillStyle = 'rgba(8,6,16,0.25)';
  g.fillRect(T, 3 * T, 2, H - 4 * T);
  g.fillRect(W - T - 2, 3 * T, 2, H - 4 * T);
}

function frontWall(g: G) {
  const y = 15 * T;
  rect(g, 0, y, 10 * T, T, P.wallTop);
  rect(g, 12 * T, y, W - 12 * T, T, P.wallTop);
  hline(g, 0, y, 10 * T, '#2c2740');
  hline(g, 12 * T, y, W - 12 * T, '#2c2740');
  // l'encadrement de la porte
  for (const x of [10 * T - 2, 12 * T]) {
    rect(g, x, y - 2, 2, T + 2, '#3b3550');
    vline(g, x, y - 2, T + 2, '#4d4666');
  }
  // le paillasson orange
  const mx = 10 * T + 2, my = 14 * T + 3;
  rect(g, mx, my, 2 * T - 4, 10, P.orangeDeep);
  for (let i = 0; i < 4; i++) hline(g, mx + 2, my + 2 + i * 2, 2 * T - 8, i % 2 ? P.orangeDark : P.orange);
}

/** Dessine toute la pièce (sans les meubles) dans une image de la taille du bureau. */
export function drawRoom(tod: TimeOfDay): HTMLCanvasElement {
  const c = makeCanvas(W, H);
  const g = g2d(c);
  floor(g);
  for (const z of ZONES) rug(g, z.x, z.y, z.w, z.h, ROLES[z.role].color);
  backWall(g);
  WINDOWS.forEach((w, i) => windowPane(g, w.x, w.y, w.w, w.h, tod, i + 1));
  whiteboard(g);
  clockFace(g);
  poster(g);
  sideWalls(g);
  frontWall(g);
  return c;
}
