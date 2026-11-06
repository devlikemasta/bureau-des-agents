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
    case 'desk': return `Un bureau du coin ${ROLES[role ?? 'renfort'].label}`;
    case 'chair': return `Un poste du coin ${ROLES[role ?? 'renfort'].label}`;
    case 'chefDesk': return 'Le bureau de Max : les rapports de l’équipe';
    case 'chefChair': return 'Le fauteuil de Max';
    case 'rack': return 'Le serveur : Claude Code et ton abonnement';
    case 'printer': return 'L’imprimante : les rendus de la mission';
    case 'cooler': return 'La fontaine à eau';
    case 'easel': return 'Le chevalet du studio design';
    case 'plantBig': case 'plantTall': case 'plantSmall': return 'Une plante (elle aime qu’on la chatouille)';
    case 'sofa': return 'Le canapé (la place préférée du chat)';
    case 'tableLow': return 'La table basse';
    case 'lamp': return 'Un lampadaire (clique pour l’éteindre)';
    case 'shelf': return 'Les archives : les missions passées';
    case 'coffee': return 'La machine à café';
    case 'bin': return 'La corbeille';
    case 'jukebox': return 'Le jukebox';
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
      return { kind: 'actor', id: a.id, label: a.id === 'chef' ? 'Max, le chef de projet' : `${a.name} · ${ROLES[a.role].label}` };
    }
  }
  if (world.cat.hit(x, y)) return { kind: 'cat', label: 'Pixel, le chat du bureau' };
  // les meubles
  for (const p of placed) {
    if (!inRect(x, y, { x: p.x + 1, y: p.y + 1, w: p.w - 2, h: p.h - 2 })) continue;
    // un pixel transparent du dessin ne compte pas : on regarde le meuble suivant
    return { kind: 'object', id: p.f.id, label: furnitureLabel(p.f.id, p.f.kind, p.f.role), role: p.f.role };
  }
  // le mur du fond et le sol
  if (inRect(x, y, { x: BOARD.x - 2, y: BOARD.y - 2, w: BOARD.w + 4, h: BOARD.h + 6 })) return { kind: 'object', id: 'board', label: 'Le tableau : le plan de Max' };
  if (inRect(x, y, { x: CLOCK.x - 1, y: CLOCK.y - 1, w: 16, h: 16 })) return { kind: 'object', id: 'clock', label: 'L’horloge' };
  if (inRect(x, y, { x: NEON.x, y: NEON.y - 3, w: 26, h: 26 })) return { kind: 'object', id: 'neon', label: 'Le néon VibesMoney (clique pour changer sa couleur)' };
  if (inRect(x, y, POSTER)) return { kind: 'object', id: 'poster', label: 'L’affiche des objectifs' };
  for (const w of WINDOWS) if (inRect(x, y, { x: w.x - 3, y: w.y - 3, w: w.w + 6, h: w.h + 8 })) return { kind: 'object', id: 'window', label: 'La fenêtre (jour, soir ou nuit)' };
  if (inRect(x, y, DOOR)) return { kind: 'object', id: 'door', label: 'La porte : c’est par là qu’arrive l’équipe' };
  for (const z of ZONES) {
    const w = textWidth(ZONE_SIGN[z.role] ?? ROLES[z.role].label) + 10;
    const sx = z.x * T + 4, sy = z.role === 'chef' ? (z.y + z.h) * T - 12 : z.y * T + 3;
    if (inRect(x, y, { x: sx, y: sy, w, h: 9 })) return { kind: 'object', id: `zone:${z.role}`, label: `Le coin ${ROLES[z.role].label} : qui y travaille, avec quels outils`, role: z.role };
  }
  return null;
}
