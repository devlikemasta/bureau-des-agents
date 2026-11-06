#!/usr/bin/env node
// Prijavljuje (ili odjavljuje) Claude Code sesiju u Kancelariju agenata.
//   node scripts/prijavi.mjs [projekat] [sef|zamenik]     prijava (sesija iz $CLAUDE_CODE_SESSION_ID)
//   node scripts/prijavi.mjs --odjavi                      odjava
//   node scripts/prijavi.mjs --spisak                      ko je prijavljen
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = process.env.KANCELARIJA_DIR ?? path.join(os.homedir(), '.kancelarija');
const FILE = path.join(DIR, 'aktivno.json');
const args = process.argv.slice(2);
const sid = process.env.KANCELARIJA_SESIJA ?? process.env.CLAUDE_CODE_SESSION_ID;

let akt = { port: 4848, pid: 0, token: '', sesije: {} };
try { akt = { ...akt, ...JSON.parse(readFileSync(FILE, 'utf8')) }; } catch { /* prvi put */ }
akt.sesije ??= {};

if (args[0] === '--spisak') { console.log(JSON.stringify(akt.sesije, null, 1)); process.exit(0); }
if (!sid) { console.error('Nema ID sesije ($CLAUDE_CODE_SESSION_ID). Pokreni iz Claude Code sesije.'); process.exit(1); }

if (args[0] === '--odjavi') {
  delete akt.sesije[sid];
} else {
  const projekat = args[0] || path.basename(process.cwd());
  const vec = Object.entries(akt.sesije).some(([id, s]) => id !== sid && s.projekat === projekat && s.uloga === 'sef');
  akt.sesije[sid] = { projekat, uloga: args[1] ?? (vec ? 'zamenik' : 'sef'), at: Date.now() };
}
mkdirSync(DIR, { recursive: true });
writeFileSync(FILE + '.tmp', JSON.stringify(akt, null, 1), { mode: 0o600 });
renameSync(FILE + '.tmp', FILE);
console.log(args[0] === '--odjavi' ? `Odjavljena sesija ${sid.slice(0, 8)}.` : `Prijavljena sesija ${sid.slice(0, 8)}: ${JSON.stringify(akt.sesije[sid])}`);
