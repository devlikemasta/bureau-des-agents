// Projekti kancelarije: ~/.kancelarija/projekti/<slug>.json
//   { "slug": "raf", "ime": "RAF 7. semestar", "putanje": ["/Users/…/RAFF"],
//     "odeljenja": [{ "id": "transkripcija", "naziv": "Transkripcija", "ikona": "🎙️", "boja": "#FF8A3D" }, …] }
// Najviše 6 odeljenja (6 kutaka). Redosled u fajlu = redosled kutaka (SLOTS), pa se raspored ne menja
// kad se doda novo odeljenje na kraj.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { SLOTS } from '../shared/activity.ts';
import type { Odeljenje, Role } from '../shared/protocol.ts';

export interface OdeljenjeCfg { id: string; naziv: string; ikona?: string; boja?: string }
export interface Projekat { slug: string; ime: string; putanje?: string[]; odeljenja: OdeljenjeCfg[] }

const BOJE = ['#4FB3FF', '#3DDC97', '#FF8A3D', '#A98BFF', '#FF6FA8', '#FFC93D'];
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

export class Projekti {
  readonly dir: string;
  constructor(dir: string) { this.dir = dir; }

  load(slug: string): Projekat | null {
    try {
      const p = JSON.parse(readFileSync(path.join(this.dir, `${slug.replace(/[^\w.-]/g, '_')}.json`), 'utf8')) as Projekat;
      if (!Array.isArray(p.odeljenja)) p.odeljenja = [];
      return p;
    } catch { return null; }
  }

  /** Projekat čija putanja sadrži cwd (najduža putanja pobeđuje). */
  byCwd(cwd: string): Projekat | null {
    let best: Projekat | null = null, len = 0;
    let files: string[] = [];
    try { files = readdirSync(this.dir).filter((f) => f.endsWith('.json')); } catch { return null; }
    for (const f of files) {
      const p = this.load(f.slice(0, -5));
      for (const root of p?.putanje ?? []) if ((cwd === root || cwd.startsWith(root + '/')) && root.length > len) { best = p; len = root.length; }
    }
    return best;
  }

  /** Odeljenja za prikaz: svako dobija svoj kutak, boju i ikonu. */
  static odeljenja(p: Projekat | null): Odeljenje[] {
    if (!p) return [];
    return p.odeljenja.slice(0, SLOTS.length).map((o, i) => ({
      slot: SLOTS[i], naziv: o.naziv || o.id, ikona: o.ikona || '📁', boja: o.boja || BOJE[i % BOJE.length],
    }));
  }

  /** "[Transkripcija] …" → kutak tog odeljenja; nepoznato → pomoćni sto. */
  static slotOf(p: Projekat | null, dept: string): Role {
    if (!p || !dept) return 'renfort';
    const d = norm(dept);
    const i = p.odeljenja.slice(0, SLOTS.length).findIndex((o) => norm(o.naziv) === d || norm(o.id) === d);
    return i >= 0 ? SLOTS[i] : 'renfort';
  }
}
