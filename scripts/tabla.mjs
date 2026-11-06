#!/usr/bin/env node
// Claude piše po tabli svog projekta (sesija iz $CLAUDE_CODE_SESSION_ID).
//   node scripts/tabla.mjs precrtaj "deo teksta stavke"
//   node scripts/tabla.mjs dodaj "nova stavka"
//   node scripts/tabla.mjs spisak
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [op, ...rest] = process.argv.slice(2);
const DIR = process.env.KANCELARIJA_DIR ?? path.join(os.homedir(), '.kancelarija');
let akt;
try { akt = JSON.parse(readFileSync(path.join(DIR, 'aktivno.json'), 'utf8')); } catch { console.error('Kancelarija nije upaljena.'); process.exit(1); }
if (!['precrtaj', 'dodaj', 'spisak'].includes(op)) { console.error('Upotreba: tabla.mjs precrtaj|dodaj|spisak ["tekst"]'); process.exit(1); }
const r = await fetch(`http://127.0.0.1:${akt.port}/tabla/claude`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-kancelarija-token': akt.token },
  body: JSON.stringify({ session_id: process.env.KANCELARIJA_SESIJA ?? process.env.CLAUDE_CODE_SESSION_ID, op, tekst: rest.join(' ') }),
}).catch(() => null);
if (!r) { console.error('Kancelarija ne odgovara.'); process.exit(1); }
console.log(await r.text());
