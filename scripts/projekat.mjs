#!/usr/bin/env node
// Koji projekat kancelarije odgovara folderu? Ispisuje slug, ili NEMA.
//   node scripts/projekat.mjs [folder=cwd]
import { readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.join(process.env.KANCELARIJA_DIR ?? path.join(os.homedir(), '.kancelarija'), 'projekti');
const cwd = path.resolve(process.argv[2] ?? process.cwd());
let best = null, len = 0;
let files = [];
try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { /* nema projekata */ }
for (const f of files) {
  try {
    const p = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    for (const root of p.putanje ?? []) if ((cwd === root || cwd.startsWith(root + '/')) && root.length > len) { best = p; len = root.length; }
  } catch { /* pokvaren fajl */ }
}
console.log(best ? `${best.slug}\t${best.ime}\t${best.odeljenja.map((o) => o.naziv).join(', ')}` : 'NEMA');
