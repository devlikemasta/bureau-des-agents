// Tabla iza šefa, po projektu: ~/.kancelarija/tabla/<slug>.json
// Pišu oboje: Claude preko svog plana (update_plan / TodoWrite), Stefan iz browsera.
// Stefanove izmene se beleže dok ih Claude ne vidi; hook na UserPromptSubmit ih ubaci u razgovor.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PlanItem } from '../shared/protocol.ts';

export interface Stavka { id: string; tekst: string; status: 'otvoreno' | 'u_toku' | 'precrtano'; ko: 'claude' | 'stefan' | 'claude-rucno'; at: number }
interface Promena { at: number; sta: 'dodao' | 'precrtao' | 'vratio' | 'obrisao'; tekst: string }
interface Stanje { stavke: Stavka[]; promene: Promena[] }

const MAX_STAVKI = 40;
const novId = () => randomBytes(5).toString('hex');

export class Tabla {
  private file: string;
  private s: Stanje = { stavke: [], promene: [] };

  constructor(dir: string, slug: string) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, `${slug.replace(/[^\w.-]/g, '_')}.json`);
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Stanje>;
      this.s = { stavke: Array.isArray(raw.stavke) ? raw.stavke : [], promene: Array.isArray(raw.promene) ? raw.promene : [] };
    } catch { /* nova tabla */ }
  }

  /** Za crtanje i za prozor table (PlanItem nosi id i autora). */
  items(): PlanItem[] {
    return this.s.stavke.map((x) => ({
      id: x.id, ko: x.ko === 'stefan' ? 'stefan' : 'claude', text: x.tekst,
      status: x.status === 'precrtano' ? 'completed' : x.status === 'u_toku' ? 'in_progress' : 'pending',
    }));
  }

  /** Claude je promenio plan: njegove stavke se zamenjuju, Stefanove ostaju. */
  izPlana(plan: PlanItem[]) {
    const stare = new Map(this.s.stavke.filter((x) => x.ko === 'claude').map((x) => [x.tekst, x]));
    const claude: Stavka[] = plan.map((p) => ({
      id: stare.get(p.text)?.id ?? novId(), tekst: p.text, ko: 'claude', at: stare.get(p.text)?.at ?? Date.now(),
      status: p.status === 'completed' ? 'precrtano' : p.status === 'in_progress' ? 'u_toku' : 'otvoreno',
    }));
    // ručne stavke (Stefanove i Claudeove van plana) ostaju
    this.s.stavke = [...claude, ...this.s.stavke.filter((x) => x.ko !== 'claude')];
    this.save();
  }

  dodaj(tekst: string) {
    const t = tekst.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!t) return;
    this.s.stavke.push({ id: novId(), tekst: t, status: 'otvoreno', ko: 'stefan', at: Date.now() });
    if (this.s.stavke.length > MAX_STAVKI) this.s.stavke.splice(0, this.s.stavke.length - MAX_STAVKI);
    this.promena('dodao', t);
  }

  precrtaj(id: string) {
    const x = this.s.stavke.find((y) => y.id === id);
    if (!x) return;
    x.status = x.status === 'precrtano' ? 'otvoreno' : 'precrtano';
    this.promena(x.status === 'precrtano' ? 'precrtao' : 'vratio', x.tekst);
  }

  /** Claude precrtava (bilo čiju) stavku po delu teksta; ne beleži se kao Stefanova izmena. */
  claudePrecrta(deo: string): string | null {
    const d = deo.toLowerCase().trim();
    const x = this.s.stavke.find((y) => y.status !== 'precrtano' && (y.id === deo || y.tekst.toLowerCase().includes(d)));
    if (!x || !d) return null;
    x.status = 'precrtano';
    this.save();
    return x.tekst;
  }

  /** Claude dopisuje stavku koja nije deo plana (npr. podsetnik za Stefana). */
  claudeDoda(tekst: string) {
    const t = tekst.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!t) return;
    this.s.stavke.push({ id: novId(), tekst: t, status: 'otvoreno', ko: 'claude-rucno', at: Date.now() });
    this.save();
  }

  obrisi(id: string) {
    const i = this.s.stavke.findIndex((y) => y.id === id);
    if (i < 0) return;
    const [x] = this.s.stavke.splice(i, 1);
    this.promena('obrisao', x.tekst);
  }

  /** Stefanove izmene koje Claude još nije video, kao jedna rečenica (pa se brišu). */
  nevidjeno(): string {
    if (!this.s.promene.length) return '';
    const po = new Map<string, string[]>();
    for (const p of this.s.promene) po.set(p.sta, [...(po.get(p.sta) ?? []), `„${p.tekst}”`]);
    this.s.promene = [];
    this.save();
    const delovi = [...po].map(([sta, t]) => `${sta} ${t.join(', ')}`);
    return `[Kancelarija] Stefan je na tabli: ${delovi.join('; ')}. Uzmi to u obzir (stavke koje je dodao su zadaci za tebe).`;
  }

  private promena(sta: Promena['sta'], tekst: string) {
    this.s.promene.push({ at: Date.now(), sta, tekst });
    if (this.s.promene.length > 50) this.s.promene.splice(0, this.s.promene.length - 50);
    this.save();
  }

  private save() {
    try {
      writeFileSync(this.file + '.tmp', JSON.stringify(this.s, null, 1));
      renameSync(this.file + '.tmp', this.file);
    } catch (e) {
      console.error('  ⚠  tabla:', e instanceof Error ? e.message : e);
    }
  }
}
