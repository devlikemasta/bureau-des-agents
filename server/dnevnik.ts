// Dnevni log po projektu: ~/.kancelarija/log/<slug>/YYYY-MM-DD.jsonl, jedan red po agentu kad ode.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { DnevnikRed } from '../shared/protocol.ts';

const dan = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const safe = (s: string) => s.replace(/[^\w.-]/g, '_');

export class Dnevnik {
  private dir: string;
  constructor(dir: string) { this.dir = dir; }

  upisi(slug: string, red: DnevnikRed) {
    try {
      const d = path.join(this.dir, safe(slug));
      mkdirSync(d, { recursive: true });
      appendFileSync(path.join(d, `${dan(red.at)}.jsonl`), JSON.stringify(red) + '\n');
    } catch (e) { console.error('  ⚠  dnevnik:', e instanceof Error ? e.message : e); }
  }

  danas(slug: string): DnevnikRed[] {
    try {
      return readFileSync(path.join(this.dir, safe(slug), `${dan()}.jsonl`), 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l) as DnevnikRed; } catch { return null; } }).filter((x): x is DnevnikRed => !!x);
    } catch { return []; }
  }
}
