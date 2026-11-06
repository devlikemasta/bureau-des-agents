#!/usr/bin/env node
// Claude javlja dokle je stigla duga radnja (vidi se klikom na šefov sto u kancelariji).
//   node scripts/napredak.mjs "Transkripcija RMA 5" 40 "12/30 min"
//   node scripts/napredak.mjs "Transkripcija RMA 5" - "obrađujem čas 3"   (procenat iz poruke, ako ga ima)
//   node scripts/napredak.mjs --gotovo "Transkripcija RMA 5"
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const gotovo = args[0] === '--gotovo';
if (gotovo) args.shift();
const [naziv, procenat, ...poruka] = args;
if (!naziv) { console.error('Upotreba: napredak.mjs "naziv" [procenat|-] [poruka]  ili  --gotovo "naziv"'); process.exit(1); }
const DIR = process.env.KANCELARIJA_DIR ?? path.join(os.homedir(), '.kancelarija');
let akt;
try { akt = JSON.parse(readFileSync(path.join(DIR, 'aktivno.json'), 'utf8')); } catch { process.exit(0); }
if (!akt?.pid) process.exit(0); // kancelarija ugašena: ćutke
await fetch(`http://127.0.0.1:${akt.port}/napredak`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-kancelarija-token': akt.token },
  body: JSON.stringify({ session_id: process.env.CLAUDE_CODE_SESSION_ID, naziv, procenat: procenat && procenat !== '-' ? procenat : undefined, poruka: poruka.join(' '), gotovo }),
  signal: AbortSignal.timeout(1000),
}).then(() => console.log('Javljeno kancelariji.')).catch(() => console.log('Kancelarija ne odgovara.'));
