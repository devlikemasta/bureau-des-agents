#!/usr/bin/env node
// Pušta snimljene hook događaje (jsonl: { t, arg, raw }) kroz pravi hook, bez trošenja limita.
//   node scripts/pusti-snimak.mjs <snimak.jsonl> [usporenje=3]
// Sesija iz snimka se privremeno prijavi kao "Test" i odjavi na kraju.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [file, slow = '3'] = process.argv.slice(2);
if (!file) { console.error('Upotreba: node scripts/pusti-snimak.mjs <snimak.jsonl> [usporenje]'); process.exit(1); }
const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const sid = lines.find((l) => l.raw?.session_id)?.raw.session_id;
const env = { ...process.env, KANCELARIJA_SESIJA: sid };
execFileSync('node', [path.join(ROOT, 'scripts/prijavi.mjs'), 'Test', 'sef'], { env, stdio: 'inherit' });

const hook = path.join(ROOT, 'hooks/kancelarija-hook.mjs');
const t0 = lines[0].t;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = t0;
for (const l of lines) {
  await sleep((l.t - last) * Number(slow));
  last = l.t;
  const p = spawn('node', [hook], { stdio: ['pipe', 'ignore', 'inherit'] });
  p.stdin.end(JSON.stringify(l.raw));
  console.log(`${String(l.t - t0).padStart(6)} ms  ${l.arg}${l.raw.tool_name ? ' ' + l.raw.tool_name : ''}${l.raw.agent_id ? ' @' + l.raw.agent_id.slice(0, 6) : ''}`);
}
await sleep(4000);
execFileSync('node', [path.join(ROOT, 'scripts/prijavi.mjs'), '--odjavi'], { env, stdio: 'inherit' });
