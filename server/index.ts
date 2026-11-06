// Le pont entre le bureau et Claude Code. Il sert le bureau (dossier dist/) et ouvre une connexion
// WebSocket sur /ws. Il n'écoute que sur ton ordinateur (127.0.0.1), et refuse toute page qui ne vient
// pas du bureau lui-même : un site web ne peut pas lancer ton équipe à ta place.
//
//   node server/index.ts            le bureau sur http://localhost:4848
//   node server/index.ts --open     … et l'ouvre dans le navigateur
//   node server/index.ts --dev      seulement le pont (le bureau est servi par Vite, port 5174)
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';
import { Bureau } from './bureau.ts';
import { findClaude } from './claude.ts';
import { Observer, type HookMsg } from './observer.ts';
import { Projekti, type Projekat } from './projekti.ts';
import { Tabla } from './tabla.ts';
import { Dnevnik } from './dnevnik.ts';
import { watch } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const args = new Set(process.argv.slice(2));
const DEV = args.has('--dev');
const PORT = Number(process.env.PORT ?? 4848);
const HOST = '127.0.0.1';
const DEV_PORT = 5174;

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "font-src 'self' data:", "media-src 'self' blob: data:", "worker-src 'self' blob:",
  `connect-src 'self' ws://localhost:${PORT} ws://127.0.0.1:${PORT}`, "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'",
].join('; ');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

// L'aperçu des sites faits par l'équipe : servis à part, dans un bac à sable (origine opaque) :
// leurs scripts tournent, mais ils ne peuvent ni lire le bureau, ni se connecter au pont.
const PREVIEW_CSP = "sandbox allow-scripts allow-forms allow-popups allow-modals; frame-ancestors 'self'";

const claude = await findClaude();
// la version du bureau compilé : un onglet resté ouvert se recharge quand elle change
const BUILD = (() => { try { return String(Math.round(statSync(path.join(DIST, 'index.html')).mtimeMs)); } catch { return 'dev'; } })();
const clients = new Set<WebSocket>();

function broadcast(m: ServerMsg) {
  const s = JSON.stringify(m);
  for (const c of clients) if (c.readyState === c.OPEN) c.send(s);
}

const KANC = process.env.KANCELARIJA_DIR ?? path.join(os.homedir(), '.kancelarija');
const bureau = new Bureau(claude, broadcast, process.env.BUREAU_DIR ?? path.join(KANC, 'bureau'));
await bureau.init();

// ── Režim posmatrača: hookovi naših sesija javljaju šta rade agenti ──
// ~/.kancelarija/aktivno.json kaže hooku da kancelarija radi (port, pid, token) i koje sesije prati.
const AKTIVNO = path.join(KANC, 'aktivno.json');
const TOKEN = randomBytes(18).toString('hex');
interface Aktivno { port: number; pid: number; token: string; sesije: Record<string, { projekat?: string; uloga?: string; ime?: string }> }
function readAktivno(): Aktivno | null {
  try { return JSON.parse(readFileSync(AKTIVNO, 'utf8')) as Aktivno; } catch { return null; }
}
function writeAktivno(pid: number) {
  mkdirSync(KANC, { recursive: true });
  const prev = readAktivno();
  const next: Aktivno = { port: PORT, pid, token: pid ? TOKEN : '', sesije: prev?.sesije ?? {} };
  writeFileSync(AKTIVNO + '.tmp', JSON.stringify(next, null, 1), { mode: 0o600 });
  renameSync(AKTIVNO + '.tmp', AKTIVNO);
}
const projekti = new Projekti(path.join(KANC, 'projekti'));
mkdirSync(projekti.dir, { recursive: true });
/** projekat koji kancelarija trenutno prikazuje */
let aktivan: Projekat | null = null;
let aktivanSlug = '';

/** Projekat sesije: iz prijave (slug), pa po folderu, pa ime foldera bez odeljenja. */
function projekatOf(m: HookMsg): { slug: string; p: Projekat | null } {
  const slug = readAktivno()?.sesije?.[m.session_id]?.projekat ?? '';
  const p = (slug && projekti.load(slug)) || (m.cwd ? projekti.byCwd(m.cwd) : null);
  return { slug: p?.slug || slug || (m.cwd ? path.basename(m.cwd) : 'kancelarija'), p };
}

const TABLE_DIR = path.join(KANC, 'tabla');
const table = new Map<string, Tabla>();
const tablaOf = (slug: string) => { let t = table.get(slug); if (!t) { t = new Tabla(TABLE_DIR, slug); table.set(slug, t); } return t; };
const pokaziTablu = () => { if (aktivanSlug) bureau.observe({ k: 'plan', items: tablaOf(aktivanSlug).items() }); };

function prikazi(slug: string, p: Projekat | null) {
  const promena = slug !== aktivanSlug || JSON.stringify(p?.odeljenja) !== JSON.stringify(aktivan?.odeljenja);
  aktivan = p; aktivanSlug = slug;
  if (promena) broadcast({ t: 'odeljenja', list: Projekti.odeljenja(p) });
}

const dnevnik = new Dnevnik(path.join(KANC, 'log'));
const zaposleni = new Map<string, { ime: string; odeljenje: string; zadatak: string; model: string; at: number }>();

const observer = new Observer((ev) => {
  // Claudeov plan ide na tablu projekta, zajedno sa Stefanovim stavkama
  if (ev.k === 'plan' && aktivanSlug) { tablaOf(aktivanSlug).izPlana(ev.items); pokaziTablu(); return; }
  if (ev.k === 'hire' && ev.type !== 'zamenik') zaposleni.set(ev.id, { ime: ev.name, odeljenje: ev.dept ?? '', zadatak: ev.task, model: ev.model ?? '', at: Date.now() });
  if (ev.k === 'leave') {
    const z = zaposleni.get(ev.who);
    zaposleni.delete(ev.who);
    if (z && aktivanSlug) dnevnik.upisi(aktivanSlug, { ...z, at: Date.now(), tokeni: ev.tokens, alati: ev.tools, ms: ev.ms, ok: ev.ok });
  }
  bureau.observe(ev);
}, (_session, dept) => Projekti.slotOf(aktivan, dept), (session) => {
  const s = readAktivno()?.sesije?.[session];
  return { uloga: s?.uloga ?? 'sef', ime: s?.ime ?? '' };
});

function onHook(m: HookMsg) {
  const { slug, p } = projekatOf(m);
  prikazi(slug, p);
  const pre = bureau.current?.mission.id;
  bureau.beginObserve(p?.ime || slug, m.cwd ?? os.homedir());
  if (bureau.current?.mission.id !== pre) pokaziTablu();
  observer.handle(m);
}

// Claude doda odeljenje u fajl projekta → kancelarija se odmah presloži
try {
  watch(projekti.dir, () => { if (aktivanSlug) prikazi(aktivanSlug, projekti.load(aktivanSlug)); }).on('error', () => {});
} catch { /* bez praćenja: promena se vidi na sledećem događaju */ }

/** Hook na UserPromptSubmit pita: šta je Stefan menjao na tabli od poslednje poruke? */
async function nevidjenoRoute(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== 'POST' || req.headers['x-kancelarija-token'] !== TOKEN) { res.writeHead(403).end(); return; }
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 10_000) { res.writeHead(413).end(); return; } }
  let slug = '';
  try { slug = readAktivno()?.sesije?.[(JSON.parse(body) as { session_id?: string }).session_id ?? '']?.projekat ?? ''; } catch { /* prazno */ }
  // samo šef vidi izmene (zamenik ih ne "troši")
  const uloga = (() => { try { return readAktivno()?.sesije?.[(JSON.parse(body) as { session_id: string }).session_id]?.uloga; } catch { return ''; } })();
  const text = slug && uloga !== 'zamenik' ? tablaOf(slug).nevidjeno() : '';
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(text);
}

/** scripts/tabla.mjs: Claude precrtava ili dopisuje stavku na tabli svog projekta. */
async function claudeTablaRoute(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== 'POST' || req.headers['x-kancelarija-token'] !== TOKEN) { res.writeHead(403).end(); return; }
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 10_000) { res.writeHead(413).end(); return; } }
  let m: { session_id?: string; op?: string; tekst?: string } = {};
  try { m = JSON.parse(body); } catch { /* prazno */ }
  const slug = readAktivno()?.sesije?.[m.session_id ?? '']?.projekat ?? '';
  if (!slug) { res.writeHead(404).end('Sesija nije prijavljena u kancelariju.'); return; }
  const t = tablaOf(slug);
  let out = '';
  if (m.op === 'precrtaj') { const x = t.claudePrecrta(str(m.tekst, 200)); out = x ? `Precrtano: ${x}` : 'Nema takve otvorene stavke.'; }
  else if (m.op === 'dodaj') { t.claudeDoda(str(m.tekst, 200)); out = 'Dodato.'; }
  else if (m.op === 'spisak') out = t.items().map((x) => `${x.status === 'completed' ? '✓' : '·'} ${x.text}${x.ko === 'stefan' ? ' (Stefan)' : ''}`).join('\n') || '(prazno)';
  if (slug === aktivanSlug && m.op !== 'spisak') pokaziTablu();
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(out);
}

async function hookRoute(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== 'POST' || req.headers['x-kancelarija-token'] !== TOKEN) { res.writeHead(403).end(); return; }
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 400_000) { res.writeHead(413).end(); return; } }
  res.writeHead(204).end();
  try { onHook(JSON.parse(body) as HookMsg); } catch (e) { console.error('  ⚠  hook:', e instanceof Error ? e.message : e); }
}

// ── Le serveur web (le bureau compilé) ──
const server = http.createServer(async (req, res) => {
  const url0 = new URL(req.url ?? '/', 'http://x');
  if (url0.pathname === '/hook') { await hookRoute(req, res); return; }
  if (url0.pathname === '/tabla/nevidjeno') { await nevidjenoRoute(req, res); return; }
  if (url0.pathname === '/tabla/claude') { await claudeTablaRoute(req, res); return; }
  if (url0.pathname.startsWith('/apercu/')) { await preview(url0, res); return; }
  if (DEV) { res.writeHead(404).end(`Mode développement : le bureau est sur http://localhost:${DEV_PORT}`); return; }
  try {
    const url = url0;
    let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
    if (file !== DIST && !file.startsWith(DIST + path.sep)) { res.writeHead(403).end(); return; }
    if (!existsSync(file) || file === DIST || file.endsWith(path.sep)) file = path.join(DIST, 'index.html');
    const body = await readFile(file);
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      // aucun script venu d'ailleurs : même un lien piégé dans un rapport ne peut rien exécuter
      ...(ext === '.html' ? { 'Content-Security-Policy': CSP } : {}),
    });
    res.end(body);
  } catch {
    res.writeHead(500).end('Le bureau n’est pas compilé : lance « npm start ».');
  }
});

/** /apercu/<mission>/<chemin> : un fichier de la mission, dans le bac à sable. */
async function preview(url: URL, res: http.ServerResponse) {
  try {
    const parts = url.pathname.split('/').slice(2).map((p) => decodeURIComponent(p));
    const missionId = parts.shift() ?? '';
    let rel = parts.join('/');
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    const file = bureau.previewPath(missionId, rel);
    if (!file) { res.writeHead(404, { 'Content-Security-Policy': PREVIEW_CSP }).end('Introuvable dans le dossier de la mission.'); return; }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Security-Policy': PREVIEW_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(500, { 'Content-Security-Policy': PREVIEW_CSP }).end();
  }
}

// ── La connexion avec le bureau ──
// Seul le bureau lui-même peut se connecter (et, en développement, la page servie par Vite).
const allowedOrigins = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`, ...(DEV ? [`http://localhost:${DEV_PORT}`, `http://127.0.0.1:${DEV_PORT}`] : [])]);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });

server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin ?? '';
  if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws' || !allowedOrigins.has(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  const send = (m: ServerMsg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
  send({ ...bureau.hello(), build: BUILD, odeljenja: Projekti.odeljenja(aktivan) } as ServerMsg);
  ws.on('message', async (data) => {
    let m: ClientMsg;
    try { m = JSON.parse(String(data)); } catch { return; }
    try {
      await handle(m, send);
    } catch (e) {
      send({ t: 'toast', kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  });
});

const str = (v: unknown, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : '');

async function handle(m: ClientMsg, send: (m: ServerMsg) => void) {
  switch (m.t) {
    case 'start': case 'say': case 'stop': case 'answer':
      // režim posmatrača: Max se ne pokreće iz kancelarije, šef je Claude Code chat
      if (bureau.current?.mission.posmatrac || m.t === 'start') { send({ t: 'toast', kind: 'info', text: 'Zadatke daješ u Claude Code chatu. Kancelarija samo prikazuje agente.' }); break; }
      if (m.t === 'say') bureau.say(str(m.text));
      else if (m.t === 'stop') bureau.stop();
      else bureau.answer(str(m.requestId, 100), m.allow === true);
      break;

    case 'new':
      bureau.close();
      break;
    case 'open':
      bureau.open(str(m.missionId, 40), m.file ? str(m.file, 1000) : undefined);
      break;
    case 'open_root':
      bureau.openRoot(m.rules === true);
      break;
    case 'read': {
      const file = str(m.file, 1000);
      const version = m.version ? str(m.version, 120) : undefined;
      const { text, truncated } = await bureau.readText(str(m.missionId, 40), file, version);
      send({ t: 'file_text', missionId: m.missionId, file, text, truncated, version });
      break;
    }
    case 'versions': {
      const file = str(m.file, 1000);
      send({ t: 'versions', missionId: m.missionId, file, list: await bureau.versions(str(m.missionId, 40), file) });
      break;
    }
    case 'team_history':
      send({ t: 'team_history', entries: await bureau.teamHistory() });
      break;
    case 'replay': {
      const { mission, log } = await bureau.replay(str(m.missionId, 40));
      send({ t: 'replay', mission, log });
      break;
    }
    case 'settings':
      bureau.setSettings(m.settings ?? {});
      break;
    case 'dnevnik':
      send({ t: 'dnevnik', projekat: aktivan?.ime || aktivanSlug, redovi: aktivanSlug ? dnevnik.danas(aktivanSlug) : [] });
      break;
    case 'tabla_dodaj': case 'tabla_precrtaj': case 'tabla_obrisi': {
      if (!aktivanSlug) { send({ t: 'toast', kind: 'info', text: 'Kancelarija još ne prati nijedan projekat.' }); break; }
      const t = tablaOf(aktivanSlug);
      if (m.t === 'tabla_dodaj') t.dodaj(str(m.tekst, 200));
      else if (m.t === 'tabla_precrtaj') t.precrtaj(str(m.id, 40));
      else t.obrisi(str(m.id, 40));
      pokaziTablu();
      break;
    }
  }
}

function listen(port: number) {
  server.once('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`  Port ${port} je već zauzet: kancelarija možda već radi (http://localhost:${port}).`);
      process.exit(1);
    }
    throw e;
  });
  server.listen(port, HOST, () => {
    writeAktivno(process.pid);
    const url = `http://localhost:${port}`;
    console.log('');
    console.log('  🏢  Kancelarija agenata');
    console.log(`  ➜  ${DEV ? `Most je spreman (kancelarija: http://localhost:${DEV_PORT})` : url}`);
    console.log(`  📁  Zadaci: ${bureau.missionsDir}`);
    console.log(claude ? `  ✓  Claude Code ${claude.version} (${claude.path})` : '  ✗  Claude Code nije pronađen: kancelarija će raditi u demo režimu.');
    console.log('  ⏹  Za zaustavljanje: Ctrl + C');
    console.log('');
    if (args.has('--open') && !DEV) {
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
      execFile(opener, [url], () => {});
    }
  });
}

listen(PORT);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    try { writeAktivno(0); } catch { /* svejedno: hook proverava i pid */ }
    observer.clear();
    bureau.shutdown();
    setTimeout(() => process.exit(0), 300);
  });
}
