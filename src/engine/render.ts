// Le dessin d'une image du bureau : la pièce, puis les meubles et les robots rangés du fond vers
// l'avant (ceux du fond passent derrière), les effets, et enfin la lumière (le soir et la nuit,
// la pièce s'assombrit et ce sont les écrans, les lampes et le néon qui éclairent).
// Tout se dessine sur une toute petite image (352 × 256 pixels), agrandie sans flou : ça ne coûte presque rien.
import type { ActKind } from '../../shared/protocol.ts';
import { furniturePlacement } from './furniture.ts';
import { BOARD, CLOCK, FURNITURE, H, NEON, T, W, WINDOWS, type Furn } from './layout.ts';
import { g2d, makeCanvas, P, rgba, rng, type G } from './pixels.ts';
import { ANCHOR_X, ANCHOR_Y, robotSprite } from './robots.ts';
import { drawRoom, neon, signs, type TimeOfDay } from './room.ts';
import { ROLES } from '../../shared/activity.ts';
import type { Actor, World } from './world.ts';

interface Placed { f: Furn; c: HTMLCanvasElement; x: number; y: number; sortY: number }

const SCREEN: Record<ActKind, string> = {
  search: '#7fd6ff', web: '#7fffc4', read: '#cfe3ff', write: '#fff0d4', edit: '#fff0d4', bash: '#8affb0',
  plan: '#ffd27a', skill: '#ffe08a', mcp: '#c9b4ff', other: '#dfe6ff',
};

const AMBIENT: Record<TimeOfDay, string> = { day: '#ffffff', evening: '#a596b2', night: '#3b3961' };

/** Les couleurs du néon (clique dessus pour passer à la suivante). */
export const NEON_COLORS: [string, string][] = [
  [P.orange, P.orangeLight], ['#ff5fa2', '#ffc2dd'], ['#3fd8ff', '#c8f4ff'], ['#3ddc97', '#c6f7de'], ['#a98bff', '#e2d8ff'],
];
const DISCO = ['#ff5fa2', '#3fd8ff', '#ffd166', '#3ddc97', '#a98bff', '#ff8a3d'];

export class Renderer {
  private bg: HTMLCanvasElement | null = null;
  private bgTod: TimeOfDay | null = null;
  private light = makeCanvas(W, H);
  private lg = g2d(this.light);
  private placed: Placed[] = FURNITURE.map((f) => { const p = furniturePlacement(f); return { f, c: p.s.c, x: p.x, y: p.y, sortY: p.sortY }; });
  private stars: { x: number; y: number; p: number }[] = [];

  constructor() {
    const r = rng(7);
    for (const w of WINDOWS) for (let i = 0; i < 9; i++) this.stars.push({ x: w.x + 2 + Math.floor(r() * (w.w - 4)), y: w.y + 1 + Math.floor(r() * 12), p: r() * 6 });
  }

  draw(g: G, world: World, tod: TimeOfDay, now: Date) {
    if (!this.bg || this.bgTod !== tod) { this.bg = drawRoom(tod); this.bgTod = tod; }
    const t = world.time;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.drawImage(this.bg, 0, 0);
    if (tod === 'night') this.twinkle(g, t);
    if (tod === 'day') this.clouds(g, t);
    this.clockHands(g, now);
    this.board(g, world, t);
    // le néon (sa couleur change quand on clique dessus ; il grésille de temps en temps)
    const [tube, core] = NEON_COLORS[world.neonIndex];
    if (Math.sin(t * 0.9) <= 0.985) neon(g, tube, core);
    // les écriteaux : le nom du coin, et combien d'agents y travaillent en ce moment
    const busy = new Map<string, number>();
    for (const a of world.actors.values()) if (a.seated && a.role !== 'chef') busy.set(a.role, (busy.get(a.role) ?? 0) + 1);
    signs(g, (role) => busy.get(role) ?? 0);

    // qui est assis à quel bureau
    const atDesk = new Map<string, Actor>();
    for (const a of world.actors.values()) if (a.seated && a.seat) atDesk.set(a.seat.deskId, a);

    // du fond vers l'avant
    const items: { y: number; k: number; draw: () => void }[] = [];
    for (const p of this.placed) {
      const shake = (world.wiggles.get(p.f.id) ?? 0) > t ? Math.round(Math.sin(t * 42)) : 0;
      items.push({ y: p.sortY, k: 0, draw: () => { g.drawImage(p.c, p.x + shake, p.y); this.furnitureLive(g, p, world, atDesk.get(p.f.id) ?? null, t); } });
    }
    for (const a of world.actors.values()) {
      items.push({ y: a.seated && a.seat ? a.seat.y : a.y, k: 1, draw: () => this.actor(g, a, world) });
    }
    items.push({ y: world.cat.sortY, k: 2, draw: () => world.cat.draw(g) });
    items.sort((a, b) => a.y - b.y || a.k - b.k);
    for (const it of items) it.draw();

    if (t < world.discoUntil) this.discoBall(g, t);
    world.fx.draw(g);
    if (tod === 'day') this.sunbeams(g);
    else this.lighting(g, world, tod, atDesk, t);
    if (t < world.discoUntil) this.discoSpots(g, t, world.discoUntil - t);
  }

  private actor(g: G, a: Actor, world: World) {
    const seated = a.seated && !!a.seat;
    const x = Math.round(a.x);
    // sur la musique, ceux qui ne marchent pas hochent la tête en rythme
    const y = Math.round(a.y) - (world.musicOn && world.time < world.bobUntil && !a.moving ? 1 : 0);
    g.globalAlpha = a.alpha;
    if (!seated) {
      g.fillStyle = 'rgba(8,6,16,0.32)';
      g.fillRect(x - 5, y - 1, 10, 2);
      g.fillRect(x - 4, y - 2, 8, 1);
    }
    const sprite = robotSprite(a.role, a.pose, seated ? 'down' : a.dir, a.frame, a.eyes);
    g.drawImage(sprite, x - ANCHOR_X, y - ANCHOR_Y);
    g.globalAlpha = 1;
  }

  /** Les parties vivantes des meubles : écrans allumés, voyants, imprimante, rapports sur le bureau du chef. */
  private furnitureLive(g: G, p: Placed, world: World, who: Actor | null, t: number) {
    const f = p.f;
    if (f.kind === 'desk' && who) {
      const on = t - who.actAt < 9;
      const col = on && who.act ? SCREEN[who.act] : '#5b6b8c';
      switch (f.role) {
        case 'code': {
          // le reflet de l'écran sur les bords des moniteurs
          for (const mx of [1, 22]) {
            g.fillStyle = col;
            g.fillRect(p.x + mx, p.y + 1, 9, 1);
          }
          break;
        }
        case 'design': {
          const cols = ['#ff6fa8', '#ffd166', '#4fb3ff', '#a98bff', P.orange];
          for (let i = 0; i < 11; i++) {
            g.fillStyle = cols[(i + Math.floor(t * (on ? 6 : 1))) % cols.length];
            g.fillRect(p.x + 10 + i, p.y + 12 + (i % 3 === 0 ? 1 : 0), 1, i % 2 ? 2 : 3);
          }
          break;
        }
        case 'analyse': {
          g.fillStyle = '#141a2c';
          g.fillRect(p.x + 23, p.y + 2, 7, 6);
          const bars = ['#ffd166', P.orange, '#4fb3ff', '#3ddc97'];
          for (let i = 0; i < 4; i++) {
            const h = on ? 2 + Math.floor((Math.sin(t * 3 + i * 1.7) + 1) * 1.6) : 2 + (i % 3);
            g.fillStyle = bars[i];
            g.fillRect(p.x + 24 + i + (i > 1 ? 1 : 0), p.y + 7 - h, 1, h);
          }
          this.logo(g, p.x + 14, p.y + 10, on, t);
          break;
        }
        default:
          this.logo(g, p.x + 15, p.y + 10, on, t);
      }
    }
    if (f.kind === 'chefDesk') {
      if (who) this.logo(g, p.x + 31, p.y + 10, true, t);
      // les rapports rendus, empilés dans la corbeille
      const n = Math.min(world.inbox, 7);
      for (let i = 0; i < n; i++) {
        g.fillStyle = P.ink;
        g.fillRect(p.x + 46 + (i % 2), p.y + 10 - i, 12, 3);
        g.fillStyle = i % 2 ? P.paperShade : P.paper;
        g.fillRect(p.x + 47 + (i % 2), p.y + 10 - i, 10, 2);
      }
    }
    if (f.kind === 'printer' && t < world.printUntil) {
      const prog = 1 - (world.printUntil - t) / 1.8;
      const h = Math.max(1, Math.round(Math.min(1, prog * 1.6) * 6));
      g.fillStyle = P.paper;
      g.fillRect(p.x + 4, p.y + 8, 8, h);
      g.fillStyle = P.paperLine;
      if (h > 3) g.fillRect(p.x + 5, p.y + 10, 5, 1);
      g.fillStyle = Math.floor(t * 8) % 2 ? '#3ddc97' : '#1f6b45';
      g.fillRect(p.x + 13, p.y + 9, 1, 1);
    }
    if (f.kind === 'rack') {
      for (let i = 0; i < 6; i++) {
        const blink = Math.sin(t * (2 + (i % 3)) + i * 2.3) > -0.2;
        g.fillStyle = blink ? (i % 4 === 0 ? '#ff8a3d' : i % 3 === 0 ? '#4fb3ff' : '#3ddc97') : '#1f3a2e';
        g.fillRect(p.x + 3, p.y + 7 + i * 4, 1, 1);
        g.fillStyle = Math.sin(t * 5 + i) > 0.6 ? '#3ddc97' : '#1f3a2e';
        g.fillRect(p.x + 5, p.y + 7 + i * 4, 1, 1);
      }
    }
    if (f.kind === 'jukebox') this.jukeboxLights(g, p, world, t);
    if (f.kind === 'coffee') {
      g.fillStyle = Math.floor(t * 1.5) % 2 ? P.orange : P.orangeDark;
      g.fillRect(p.x + 14, p.y + 2, 1, 1);
    }
  }

  /** Les néons de l'arche du jukebox : éteints au repos, ils défilent et pulsent sur la musique. */
  private jukeboxLights(g: G, p: Placed, world: World, t: number) {
    const on = world.musicOn;
    const arcs: [number, string, string][] = [[11, '#ff5fa2', '#5a2a3e'], [9, P.orange, '#5a3a24'], [7, '#3fd8ff', '#1f3e4a']];
    arcs.forEach(([r, col, dim], i) => {
      for (let a = 0; a <= 16; a++) {
        const ang = Math.PI + (a / 16) * Math.PI;
        const x = p.x + 16 + Math.round(Math.cos(ang) * r);
        const y = p.y + 15 + Math.round(Math.sin(ang) * r);
        const lit = on && (Math.floor(t * 8) + a + i * 3) % 6 !== 0;
        g.fillStyle = lit ? col : dim;
        g.fillRect(x, y, 1, 1);
      }
    });
    if (on) {
      // le disque tourne
      const a = t * 8;
      g.fillStyle = P.orangeLight;
      g.fillRect(p.x + 16 + Math.round(Math.cos(a) * 3), p.y + 20 + Math.round(Math.sin(a) * 1.5), 1, 1);
      // les barres du vumètre
      for (let i = 0; i < 5; i++) {
        const h = 1 + Math.round((world.musicLevel * 4) * (0.6 + 0.4 * Math.sin(t * 9 + i * 1.7)));
        g.fillStyle = i % 2 ? '#ff5fa2' : P.orange;
        g.fillRect(p.x + 7 + i * 4, p.y + 32 - h, 2, h);
      }
    }
  }

  /** La boule à facettes du mode soirée. */
  private discoBall(g: G, t: number) {
    const cx = 176, cy = 30;
    g.fillStyle = '#8a8ea2';
    g.fillRect(cx, 0, 1, cy - 5);
    for (let y = -5; y <= 5; y++) {
      const w = Math.round(Math.sqrt(25 - y * y));
      for (let x = -w; x <= w; x++) {
        const k = (x + y + Math.floor(t * 10)) & 3;
        g.fillStyle = k === 0 ? '#ffffff' : k === 1 ? '#c9cbd6' : k === 2 ? '#8a8ea2' : DISCO[(x * 7 + y * 3 + Math.floor(t * 6)) % DISCO.length];
        g.fillRect(cx + x, cy + y, 1, 1);
      }
    }
  }

  /** Les taches de lumière colorées qui tournent sur le sol pendant le mode soirée. */
  private discoSpots(g: G, t: number, left: number) {
    const fade = Math.min(1, left / 1.5);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const a = t * (0.7 + i * 0.13) + i * 2.1;
      const x = 176 + Math.cos(a) * (60 + i * 12);
      const y = 140 + Math.sin(a * 1.3) * (40 + i * 4);
      const grd = g.createRadialGradient(x, y, 0, x, y, 14);
      grd.addColorStop(0, rgba(DISCO[i % DISCO.length], 0.32 * fade));
      grd.addColorStop(1, rgba(DISCO[i % DISCO.length], 0));
      g.fillStyle = grd;
      g.fillRect(x - 14, y - 14, 28, 28);
    }
    g.globalCompositeOperation = 'source-over';
  }

  /** Deux petits nuages qui passent derrière les fenêtres, en journée. */
  private clouds(g: G, t: number) {
    for (const w of WINDOWS) {
      g.save();
      g.beginPath();
      g.rect(w.x, w.y, w.w, 11);
      g.clip();
      for (let i = 0; i < 2; i++) {
        const span = w.w + 30;
        const x = w.x - 15 + ((t * (3 + i * 2) + i * 40 + w.x) % span);
        const y = w.y + 3 + i * 4;
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.fillRect(Math.round(x), y, 9, 2);
        g.fillRect(Math.round(x) + 2, y - 1, 5, 1);
      }
      g.restore();
    }
  }

  /** Le petit cube orange au dos de l'ordinateur, qui s'allume quand l'agent travaille. */
  private logo(g: G, x: number, y: number, on: boolean, t: number) {
    g.fillStyle = on ? (Math.sin(t * 6) > -0.6 ? P.orange : P.orangeHi) : '#8a5a3e';
    g.fillRect(x, y, 2, 2);
  }

  private clockHands(g: G, now: Date) {
    const cx = CLOCK.x + 7, cy = CLOCK.y + 7;
    const m = now.getMinutes() + now.getSeconds() / 60;
    const h = (now.getHours() % 12) + m / 60;
    const hand = (angle: number, len: number, color: string) => {
      g.fillStyle = color;
      for (let i = 0; i <= len; i++) g.fillRect(Math.round(cx + Math.sin(angle) * i), Math.round(cy - Math.cos(angle) * i), 1, 1);
    };
    hand((h / 12) * Math.PI * 2, 3, '#2b2836');
    hand((m / 60) * Math.PI * 2, 4, '#2b2836');
    g.fillStyle = P.orange;
    g.fillRect(cx, cy, 1, 1);
  }

  private twinkle(g: G, t: number) {
    for (const s of this.stars) {
      const a = (Math.sin(t * 1.6 + s.p) + 1) / 2;
      if (a < 0.35) continue;
      g.fillStyle = `rgba(255,255,255,${(a * 0.9).toFixed(2)})`;
      g.fillRect(s.x, s.y, 1, 1);
    }
  }

  /** En journée : de grands rayons de soleil qui tombent des fenêtres. */
  private sunbeams(g: G) {
    g.save();
    g.beginPath();
    g.rect(T, 3 * T, W - 2 * T, H - 4 * T);
    g.clip();
    g.globalCompositeOperation = 'lighter';
    for (const w of WINDOWS) {
      g.fillStyle = 'rgba(255,236,190,0.06)';
      g.beginPath();
      g.moveTo(w.x + 4, 48);
      g.lineTo(w.x + w.w - 4, 48);
      g.lineTo(w.x + w.w + 26, 120);
      g.lineTo(w.x + 30, 120);
      g.closePath();
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    g.restore();
  }

  private lighting(g: G, world: World, tod: TimeOfDay, atDesk: Map<string, Actor>, t: number) {
    const l = this.lg;
    l.globalCompositeOperation = 'source-over';
    l.fillStyle = AMBIENT[tod];
    l.fillRect(0, 0, W, H);
    l.globalCompositeOperation = 'lighter';
    const night = tod === 'night';
    const add = (x: number, y: number, r: number, color: string, a: number) => {
      const grd = l.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, rgba(color, a));
      grd.addColorStop(0.55, rgba(color, a * 0.45));
      grd.addColorStop(1, rgba(color, 0));
      l.fillStyle = grd;
      l.fillRect(x - r, y - r, r * 2, r * 2);
    };
    // le néon (il grésille de temps en temps)
    const flick = Math.sin(t * 0.9) > 0.985 ? 0.25 : 1;
    const neonCol = NEON_COLORS[world.neonIndex][0];
    add(NEON.x + 12, NEON.y + 12, 52, neonCol, 0.75 * flick);
    // les fenêtres : coucher de soleil ou clair de lune
    for (const w of WINDOWS) add(w.x + w.w / 2, w.y + w.h + 8, 58, night ? '#7080d0' : '#ff9a6a', night ? 0.42 : 0.55);
    // le tableau du plan, éclairé
    add(176, 28, 52, '#fff6e8', night ? 0.28 : 0.22);
    // la lampe du chef et le liseré orange de son bureau
    add(9 * T + 12, 7 * T - 6, 40, '#ffd9a0', 0.8);
    add(11 * T, 7 * T + 14, 44, P.orange, 0.32);
    // les lampadaires, le café, le serveur
    if (!world.lampsOff.has('lamp')) add(1 * T + 8, 14 * T - 12, 52, '#ffcf8a', 0.85);
    if (!world.lampsOff.has('lamp-r')) add(20 * T + 8, 14 * T - 12, 52, '#ffcf8a', 0.85);
    // le jukebox, qui pulse sur la musique
    if (world.musicOn) add(15 * T, 13 * T + 4, 30 + world.musicLevel * 18, ['#ff5fa2', P.orange, '#3fd8ff'][Math.floor(t * 1.5) % 3], 0.35 + world.musicLevel * 0.45);
    // les yeux du chat brillent dans le noir
    add(world.cat.x + (world.cat.right ? 4 : -4), world.cat.y - 8, 4, P.orange, 0.5);
    add(16 * T + 14, 14 * T - 8, 14, P.orange, 0.5);
    add(14 * T + 4, 3 * T + 6, 18, '#5fd0ff', 0.35);
    add(11 * T, 15 * T + 8, 30, '#ffe2b8', 0.4);
    if (t < world.printUntil) add(12 * T + 8, 4 * T - 2, 16, '#9effa8', 0.6);
    // les écrans éclairent les visages
    for (const a of atDesk.values()) {
      const on = t - a.actAt < 9;
      const col = on && a.act ? SCREEN[a.act] : '#8fa4d0';
      const sx = a.seat!.x, sy = a.seat!.y - 12;
      add(sx, sy, on ? 26 : 18, a.role === 'design' && on ? '#ff9fd0' : col, on ? 0.75 : 0.35);
    }
    // un projecteur doux suit Max (le patron reste toujours bien visible)
    const chef = world.chef;
    add(chef.x, (chef.seated && chef.seat ? chef.seat.y : chef.y) - 8, 26, '#ffe2c4', 0.42);
    // les yeux des robots
    for (const a of world.actors.values()) {
      if (a.alpha < 0.3) continue;
      add(a.x, (a.seated && a.seat ? a.seat.y : a.y) - 13, 7, P.orange, 0.55);
    }
    g.globalCompositeOperation = 'multiply';
    g.drawImage(this.light, 0, 0);
    // un léger halo sur ce qui brille
    g.globalCompositeOperation = 'lighter';
    const glow = (x: number, y: number, r: number, color: string, a: number) => {
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, rgba(color, a));
      grd.addColorStop(1, rgba(color, 0));
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    };
    glow(NEON.x + 12, NEON.y + 12, 20, neonCol, 0.32 * flick);
    for (const a of world.actors.values()) if (a.alpha > 0.3) glow(a.x, (a.seated && a.seat ? a.seat.y : a.y) - 13, 4, P.orange, 0.35);
    for (const a of atDesk.values()) if (t - a.actAt < 9) glow(a.seat!.x, a.seat!.y - 6, 8, a.act ? SCREEN[a.act] : '#ffffff', 0.18);
    g.globalCompositeOperation = 'source-over';
  }

  /** Le plan, au feutre sur le tableau : une ligne par étape, cochée quand elle est faite. */
  private board(g: G, world: World, t: number) {
    const items = world.plan.slice(0, 5);
    const x0 = BOARD.x + 4;
    items.forEach((it, i) => {
      const y = BOARD.y + 12 + i * 4;
      const done = it.status === 'completed';
      const doing = it.status === 'in_progress';
      // la case
      g.fillStyle = done ? '#2fbf71' : doing ? (Math.floor(t * 3) % 2 ? P.orange : P.orangeDark) : '#8a8ea2';
      g.fillRect(x0, y, 3, 3);
      if (!done) { g.fillStyle = '#f4f5f9'; g.fillRect(x0 + 1, y + 1, 1, 1); }
      // la ligne écrite à la main
      const len = Math.max(18, Math.min(78, Math.round(it.text.length * 1.5)));
      // Stefanove stavke plavim flomasterom, Claudeove crnim
      const ink = done ? '#b4b7c6' : it.ko === 'stefan' ? '#2f6fd6' : doing ? '#3a2f44' : '#2b2836';
      g.fillStyle = ink;
      for (let k = 0; k < len; k++) {
        if ((k * 7 + i * 3) % 11 === 0) continue; // des petits blancs entre les « mots »
        g.fillRect(x0 + 6 + k, y + 1 + (Math.sin((k + i * 5) * 0.9) > 0.6 ? -1 : 0), 1, 1);
      }
      if (done) { g.fillStyle = '#2fbf71'; g.fillRect(x0 + 5, y + 1, len + 2, 1); }
    });
    if (world.plan.length > 5) { g.fillStyle = '#8a8ea2'; g.fillRect(x0 + 6, BOARD.y + 32, 1, 1); g.fillRect(x0 + 8, BOARD.y + 32, 1, 1); g.fillRect(x0 + 10, BOARD.y + 32, 1, 1); }
    // qui fait quoi : une petite tête de robot par agent, en bas à droite du tableau, cochée quand il a rendu son travail
    const team = world.assignments.slice(-12);
    team.forEach((a, i) => {
      const x = BOARD.x + BOARD.w - 8 - (team.length - 1 - i) * 6;
      const y = BOARD.y + 27;
      g.fillStyle = a.status === 'done' ? '#2fbf71' : a.status === 'failed' ? '#e5484d' : ROLES[a.role].color;
      g.fillRect(x, y, 4, 4);
      g.fillStyle = '#15121d';
      g.fillRect(x + 1, y + 1, 2, 1);
      if (a.status === 'working' && Math.floor(t * 2 + i) % 2) { g.fillStyle = '#ff8a3d'; g.fillRect(x + 1, y + 1, 1, 1); }
    });
  }
}
