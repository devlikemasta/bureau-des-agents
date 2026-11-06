// Duge radnje (transkripcija, render, preuzimanje…) i dokle su stigle. Vide se klikom na šefov sto.
// Dva izvora:
//   1. automatski: svaka pozadinska Bash komanda (run_in_background) iz prijavljene sesije. Pratimo njen
//      izlazni fajl (poslednji red, procenat ako ga ispisuje); kraj javlja <task-notification> u sledećoj
//      poruci sesije (hook UserPromptSubmit);
//   2. ručno: Claude kad ionako proverava napredak, javi ga: scripts/napredak.mjs "Transkripcija RMA 5" 40 "12/30 min".
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Radnja } from '../shared/protocol.ts';

interface Unos extends Radnja { outFile?: string; session: string; taskId?: string }

const MAX = 30;
/** posle ovoliko bez nove linije u izlazu, radnja se označava kao „tiha” */
const TIHO_MS = 3 * 60_000;

/** Poslednja neprazna linija izlaza (bez ANSI boja; \r znači da je red prepisan, kao kod traka napretka). */
function poslednjiRed(file: string): string {
  try {
    const size = statSync(file).size;
    const n = Math.min(size, 4096);
    const buf = Buffer.alloc(n);
    const fd = openSync(file, 'r');
    readSync(fd, buf, 0, n, size - n);
    closeSync(fd);
    const text = buf.toString('utf8').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    const lines = text.split(/\r?\n|\r/).map((l) => l.trim()).filter(Boolean);
    return (lines.at(-1) ?? '').slice(0, 160);
  } catch { return ''; }
}

/** Procenat iz teksta: "45%", "45.2 %", "12/30" → broj 0..100. */
export function procenatIz(text: string): number | undefined {
  const pct = [...text.matchAll(/(\d{1,3}(?:[.,]\d+)?)\s?%/g)].at(-1);
  if (pct) { const v = parseFloat(pct[1].replace(',', '.')); if (v >= 0 && v <= 100) return Math.round(v); }
  const frac = [...text.matchAll(/\b(\d{1,6})\s?\/\s?(\d{1,6})\b/g)].at(-1);
  if (frac) { const a = +frac[1], b = +frac[2]; if (b > 0 && a <= b) return Math.round((a / b) * 100); }
  return undefined;
}

/** Izlazni fajl pozadinske komande: /private/tmp/claude-<uid>/<folder>/<sesija>/tasks/<id>.output */
function nadjiIzlaz(session: string, taskId: string): string | undefined {
  const roots = [`/private/tmp/claude-${process.getuid?.() ?? ''}`, path.join(os.tmpdir(), `claude-${process.getuid?.() ?? ''}`)];
  for (const root of roots) {
    let dirs: string[] = [];
    try { dirs = readdirSync(root); } catch { continue; }
    for (const d of dirs) {
      const f = path.join(root, d, session, 'tasks', `${taskId}.output`);
      if (existsSync(f)) return f;
    }
  }
  return undefined;
}

export class Napredak {
  private list: Unos[] = [];

  /** Pozadinska Bash komanda je krenula. */
  bash(session: string, taskId: string, naziv: string, ko: string) {
    if (this.list.some((x) => x.taskId === taskId)) return;
    this.add({ id: `bash-${taskId}`, taskId, session, naziv: naziv.slice(0, 80) || 'Pozadinska komanda', ko, izvor: 'auto', start: Date.now(), azurirano: Date.now(), stanje: 'radi', poruka: '' });
  }

  /** <task-notification> sa statusom: radnja je gotova (ili pala). */
  kraj(taskId: string, status: string) {
    const x = this.list.find((y) => y.taskId === taskId);
    if (!x || x.stanje !== 'radi') return;
    x.stanje = status === 'completed' ? 'gotovo' : 'greska';
    if (x.stanje === 'gotovo') x.procenat = 100;
    x.azurirano = Date.now();
  }

  /** Ručno javljanje: naziv je ključ (ista radnja se ažurira). */
  rucno(session: string, naziv: string, procenat: number | undefined, poruka: string, gotovo: boolean) {
    const n = naziv.trim().slice(0, 80);
    if (!n) return;
    let x = this.list.find((y) => y.naziv.toLowerCase() === n.toLowerCase() && y.stanje === 'radi');
    if (!x) { x = { id: `rucno-${Date.now().toString(36)}`, session, naziv: n, ko: 'Max', izvor: 'rucno', start: Date.now(), azurirano: Date.now(), stanje: 'radi', poruka: '' }; this.add(x); }
    if (procenat !== undefined && !Number.isNaN(procenat)) x.procenat = Math.max(0, Math.min(100, Math.round(procenat)));
    if (poruka) x.poruka = poruka.slice(0, 160);
    x.azurirano = Date.now();
    if (gotovo) { x.stanje = 'gotovo'; x.procenat = 100; }
  }

  /** Stanje za prikaz: auto radnje dobijaju svež poslednji red i procenat iz izlaza. */
  pregled(): Radnja[] {
    const now = Date.now();
    for (const x of this.list) {
      if (x.izvor !== 'auto' || x.stanje !== 'radi') continue;
      x.outFile ??= x.taskId ? nadjiIzlaz(x.session, x.taskId) : undefined;
      if (!x.outFile) continue;
      const red = poslednjiRed(x.outFile);
      if (red) x.poruka = red;
      const p = procenatIz(red);
      if (p !== undefined) x.procenat = p;
      try { x.azurirano = statSync(x.outFile).mtimeMs; } catch { /* fajl obrisan */ }
    }
    return this.list.map(({ outFile: _o, session: _s, taskId: _t, ...r }) => ({ ...r, tiho: r.stanje === 'radi' && now - r.azurirano > TIHO_MS }))
      .sort((a, b) => (a.stanje === 'radi' ? 0 : 1) - (b.stanje === 'radi' ? 0 : 1) || b.start - a.start);
  }

  aktivnih() { return this.list.filter((x) => x.stanje === 'radi').length; }

  private add(x: Unos) {
    this.list.push(x);
    // čuvamo najviše MAX; prvo izbacujemo završene
    while (this.list.length > MAX) {
      const i = this.list.findIndex((y) => y.stanje !== 'radi');
      this.list.splice(i >= 0 ? i : 0, 1);
    }
  }
}
