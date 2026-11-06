// Qu'y a-t-il sous la souris ? Un robot, le chat, un meuble, le tableau, l'horloge… Le plus en avant gagne.
import { ROLES } from '../../shared/activity.ts';
import type { Role } from '../../shared/protocol.ts';
import { textWidth } from './font.ts';
import { furniturePlacement } from './furniture.ts';
import { BOARD, CLOCK, DOOR, FURNITURE, NEON, POSTER, T, WINDOWS, ZONES } from './layout.ts';
import type { World } from './world.ts';

export type Hit =
  | { kind: 'actor'; id: string; label: string }
  | { kind: 'cat'; label: string }
  | { kind: 'object'; id: string; label: string; role?: Role };

const ZONE_SIGN: Record<string, string> = { chef: 'ŠEF' };

function furnitureLabel(id: string, kind: string, role?: Role): string {
  switch (kind) {
    case 'desk': return `Sto iz kutka ${ROLES[role ?? 'renfort'].label}`;
    case 'chair': return `Radno mesto iz kutka ${ROLES[role ?? 'renfort'].label}`;
    case 'chefDesk': return 'Maxov sto: dokle su stigle duge radnje';
    case 'chefChair': return 'Maxova fotelja';
    case 'rack': return 'Server: Claude Code i tvoja pretplata';
    case 'printer': return 'Štampač: predati fajlovi zadatka';
    case 'cooler': return 'Aparat za vodu';
    case 'easel': return 'Štafelaj dizajn studija';
    case 'plantBig': case 'plantTall': case 'plantSmall': return 'Biljka (voli da je golicaju)';
    case 'sofa': return 'Kauč (omiljeno mesto mačke)';
    case 'tableLow': return 'Klub sto';
    case 'lamp': return 'Podna lampa (klikni da je ugasiš)';
    case 'shelf': return 'Arhiva: prošli zadaci';
    case 'coffee': return 'Aparat za kafu';
    case 'bin': return 'Korpa za otpatke';
    case 'jukebox': return 'Džuboks';
  }
  return id;
}

const placed = FURNITURE.map((f) => {
  const p = furniturePlacement(f);
  return { f, x: p.x, y: p.y, w: p.s.c.width, h: p.s.c.height, sortY: p.sortY };
}).sort((a, b) => b.sortY - a.sortY);

const inRect = (x: number, y: number, r: { x: number; y: number; w: number; h: number }) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

export function hitAt(world: World, x: number, y: number): Hit | null {
  // les robots (le plus en avant d'abord)
  const actors = [...world.actors.values()].sort((a, b) => (b.seated && b.seat ? b.seat.y : b.y) - (a.seated && a.seat ? a.seat.y : a.y));
  for (const a of actors) {
    const ay = a.seated && a.seat ? a.seat.y : a.y;
    if (a.alpha > 0.3 && x >= a.x - 7 && x <= a.x + 7 && y >= ay - 21 && y <= ay + 1) {
      return { kind: 'actor', id: a.id, label: a.id === 'chef' ? 'Max, šef projekta' : `${a.name} · ${ROLES[a.role].label}` };
    }
  }
  if (world.cat.hit(x, y)) return { kind: 'cat', label: 'Pixel, mačka iz kancelarije' };
  // les meubles
  for (const p of placed) {
    if (!inRect(x, y, { x: p.x + 1, y: p.y + 1, w: p.w - 2, h: p.h - 2 })) continue;
    // un pixel transparent du dessin ne compte pas : on regarde le meuble suivant
    return { kind: 'object', id: p.f.id, label: furnitureLabel(p.f.id, p.f.kind, p.f.role), role: p.f.role };
  }
  // le mur du fond et le sol
  if (inRect(x, y, { x: BOARD.x - 2, y: BOARD.y - 2, w: BOARD.w + 4, h: BOARD.h + 6 })) return { kind: 'object', id: 'board', label: 'Tabla: Maxov plan' };
  if (inRect(x, y, { x: CLOCK.x - 1, y: CLOCK.y - 1, w: 16, h: 16 })) return { kind: 'object', id: 'clock', label: 'Sat' };
  if (inRect(x, y, { x: NEON.x, y: NEON.y - 3, w: 26, h: 26 })) return { kind: 'object', id: 'neon', label: 'VibesMoney neon (klikni da promeniš boju)' };
  if (inRect(x, y, POSTER)) return { kind: 'object', id: 'poster', label: 'Poster sa ciljevima' };
  for (const w of WINDOWS) if (inRect(x, y, { x: w.x - 3, y: w.y - 3, w: w.w + 6, h: w.h + 8 })) return { kind: 'object', id: 'window', label: 'Prozor (dan, veče ili noć)' };
  if (inRect(x, y, DOOR)) return { kind: 'object', id: 'door', label: 'Vrata: kroz njih ulazi tim' };
  for (const z of ZONES) {
    const w = textWidth(ZONE_SIGN[z.role] ?? ROLES[z.role].label) + 10;
    const sx = z.x * T + 4, sy = z.role === 'chef' ? (z.y + z.h) * T - 12 : z.y * T + 3;
    if (inRect(x, y, { x: sx, y: sy, w, h: 9 })) return { kind: 'object', id: `zone:${z.role}`, label: `Kutak ${ROLES[z.role].label}: ko tu radi i sa kojim alatima`, role: z.role };
  }
  return null;
}
