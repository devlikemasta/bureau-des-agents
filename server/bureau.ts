// Le bureau, côté serveur. Il vit dans un vrai dossier, ~/Documents/Bureau des agents/ :
//   - « Règlement du bureau.md » : ce que l'équipe doit savoir sur toi (Max le lit avant chaque mission) ;
//   - « Missions/ » : un dossier par mission, où l'équipe range tout ce qu'elle produit ;
//   - « .bureau/ » (caché) : l'état du bureau et l'enregistrement de chaque mission (pour la rejouer).
// Une mission = une séance Claude Code lancée dans le dossier de la mission. On peut lui reparler
// une fois finie (retouches) : la même séance reprend.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, renameSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { appendFile, copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { countStats, emptyStats } from '../shared/activity.ts';
import type { ClaudeInfo, FileInfo, Logged, MissionInfo, OfficeEvent, Quota, Role, ServerMsg, Settings, TeamEntry, VersionInfo } from '../shared/protocol.ts';
import { ClaudeProcess, Normalizer, type ClaudeBinary, type TurnResult } from './claude.ts';
import { agentsJson, ALWAYS_ALLOWED, chefPrompt, SESSION_TOOLS } from './team.ts';

const RULES_FILE = 'Règlement du bureau.md';

const RULES_TEMPLATE = `# Le règlement du bureau

Max, le chef de projet, lit ce fichier avant chaque mission. Écris-y ce que l'équipe doit savoir
sur toi, avec tes mots, comme si tu briefais de nouveaux collègues.

## Qui je suis
<!-- Par exemple : « Je m'appelle Alex, je suis coach sportif à Lyon. Je vends des programmes en ligne à des femmes de 30 à 45 ans. » -->

## Comment travailler pour moi
- Réponds-moi en français, simplement.
- Va droit au but : je veux des livrables prêts à servir.
- Range tout dans le dossier de la mission, avec des noms de fichiers clairs.
`;

const README = `# Le Bureau des agents

Ici travaille ton équipe d'agents IA (des agents Claude Code).

- « Règlement du bureau.md » : ce que l'équipe doit savoir sur toi. Max, le chef, le lit avant chaque mission.
- « Missions » : un dossier par mission. Tout ce que l'équipe produit (rapports, pages web, textes) y est rangé.

Le dossier caché « .bureau » garde l'état du bureau et l'enregistrement de chaque mission, pour la rejouer.
Tu peux le supprimer pour tout recommencer.
`;

const DEFAULT_SETTINGS: Settings = { chefModel: 'sonnet', teamModel: 'sonnet', permission: 'auto' };
const CHEF_MODELS = ['', 'sonnet', 'opus', 'haiku', 'fable'];
const TEAM_MODELS = ['sonnet', 'haiku', 'opus', 'fable', 'inherit'];
const IDLE_STOP_MS = 15 * 60 * 1000;
const MAX_LOG = 8000;
const MAX_MISSIONS = 300;
/** au-delà, un fichier n'est pas gardé en version (vidéos, gros exports) */
const MAX_VERSION_SIZE = 5_000_000;
const MAX_VERSIONS = 30;

/** Un nom de dossier sûr pour ranger les versions d'un fichier. */
const versionDirName = (rel: string) => rel.replace(/[\\/]+/g, '__').replace(/[^\w.\-À-ÿ ]+/g, '_').slice(0, 160);

interface State { missions: MissionInfo[]; settings: Settings }

interface Live {
  proc: ClaudeProcess;
  norm: Normalizer;
  stopping: boolean;
  /** le dernier message envoyé (pour le renvoyer si la reprise de séance échoue) */
  lastText: string;
  resumed: boolean;
}

interface Current {
  mission: MissionInfo;
  log: Logged[];
  live: Live | null;
  /** les prénoms déjà donnés dans cette mission */
  names: Set<string>;
  watcher: FSWatcher | null;
  fileTimers: Map<string, NodeJS.Timeout>;
  idleTimer: NodeJS.Timeout | null;
  /** depuis quand l'équipe travaille (null = au repos) */
  busySince: number | null;
  stopAsked: boolean;
  lastChefText: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Un titre court, tiré de la demande : « Analyse mes 5 concurrents et fais-moi… » → « Analyse mes 5 concurrents et fais-moi » */
function titleOf(prompt: string) {
  const first = prompt.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] ?? '';
  let t = first.replace(/[.!?:;,]+$/, '');
  if (t.length > 46) t = t.slice(0, 46).replace(/\s+\S*$/, '') + '…';
  return t ? t[0].toUpperCase() + t.slice(1) : 'Mission';
}

const cleanName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');

/** Le contenu du règlement, sans les commentaires d'exemple. */
function readRules(dir: string) {
  try {
    return readFileSync(path.join(dir, RULES_FILE), 'utf8').replace(/<!--[\s\S]*?-->/g, '').slice(0, 20000);
  } catch { return ''; }
}

export class Bureau {
  readonly dir: string;
  readonly missionsDir: string;
  private stateFile: string;
  private recDir: string;
  private verDir: string;
  private state: State = { missions: [], settings: { ...DEFAULT_SETTINGS } };
  private saveTimer: NodeJS.Timeout | null = null;
  current: Current | null = null;
  quota: Quota | null = null;

  private claude: ClaudeBinary | null;
  private broadcast: (m: ServerMsg) => void;

  constructor(claude: ClaudeBinary | null, broadcast: (m: ServerMsg) => void, dir?: string) {
    this.claude = claude;
    this.broadcast = broadcast;
    this.dir = dir ?? path.join(os.homedir(), 'Documents', 'Bureau des agents');
    this.missionsDir = path.join(this.dir, 'Missions');
    this.stateFile = path.join(this.dir, '.bureau', 'state.json');
    this.recDir = path.join(this.dir, '.bureau', 'missions');
    this.verDir = path.join(this.dir, '.bureau', 'versions');
  }

  async init() {
    const fresh = !existsSync(this.dir);
    await mkdir(this.recDir, { recursive: true });
    await mkdir(this.missionsDir, { recursive: true });
    if (fresh) await writeFile(path.join(this.dir, 'LISEZ-MOI.md'), README);
    if (!existsSync(path.join(this.dir, RULES_FILE))) await writeFile(path.join(this.dir, RULES_FILE), RULES_TEMPLATE);
    if (existsSync(this.stateFile)) {
      try {
        const s = JSON.parse(await readFile(this.stateFile, 'utf8')) as Partial<State>;
        this.state = { missions: Array.isArray(s.missions) ? s.missions : [], settings: { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) } };
      } catch { /* état illisible : on repart proprement */ }
    }
    // une mission restée « au travail » (le bureau a été coupé pendant qu'elle tournait) est arrêtée
    for (const m of this.state.missions) if (m.status === 'working') m.status = 'stopped';
  }

  claudeInfo(): ClaudeInfo {
    return this.claude ? { found: true, version: this.claude.version, path: this.claude.path } : { found: false };
  }

  get settings() { return this.state.settings; }

  setSettings(p: Partial<Settings>) {
    const cur = this.state.settings;
    this.state.settings = {
      chefModel: typeof p.chefModel === 'string' && CHEF_MODELS.includes(p.chefModel) ? p.chefModel : cur.chefModel,
      teamModel: typeof p.teamModel === 'string' && TEAM_MODELS.includes(p.teamModel) ? p.teamModel : cur.teamModel,
      permission: p.permission === 'ask' || p.permission === 'auto' ? p.permission : cur.permission,
    };
    this.save();
    this.broadcast({ t: 'settings', settings: this.state.settings });
  }

  missions(): MissionInfo[] {
    return [...this.state.missions].sort((a, b) => b.createdAt - a.createdAt).slice(0, 60);
  }

  hello(): ServerMsg {
    const c = this.current;
    return {
      t: 'hello', claude: this.claudeInfo(), dir: this.dir, settings: this.settings, quota: this.quota,
      missions: this.missions(), current: c ? { mission: c.mission, log: c.log } : null,
    };
  }

  private mission(id: string) { return this.state.missions.find((m) => m.id === id) ?? null; }

  // ── Une nouvelle mission ──
  async start(prompt: string) {
    const text = prompt.trim();
    if (!text) throw new Error('Dis à Max ce que tu veux.');
    if (!this.claude) throw new Error('Claude Code n’est pas installé sur cet ordinateur.');
    if (this.current?.mission.status === 'working') throw new Error('L’équipe est déjà sur une mission. Attends qu’elle la rende, ou arrête-la.');
    if (this.current) this.close();

    const now = new Date();
    const title = titleOf(text);
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}h${pad(now.getMinutes())}`;
    let folder = path.join(this.missionsDir, cleanName(`${stamp} · ${title.replace(/…$/, '')}`).slice(0, 90));
    for (let n = 2; existsSync(folder); n++) folder = path.join(this.missionsDir, cleanName(`${stamp} · ${title.replace(/…$/, '')} ${n}`).slice(0, 90));
    await mkdir(folder, { recursive: true });

    const mission: MissionInfo = {
      id: 'm' + Date.now().toString(36), title, prompt: text, folder, createdAt: Date.now(), workMs: 0,
      status: 'working', stats: emptyStats(), files: [],
    };
    this.state.missions.push(mission);
    if (this.state.missions.length > MAX_MISSIONS) this.state.missions.splice(0, this.state.missions.length - MAX_MISSIONS);
    this.save();
    const cur: Current = {
      mission, log: [], live: null, names: new Set(), watcher: null, fileTimers: new Map(), idleTimer: null,
      busySince: Date.now(), stopAsked: false, lastChefText: '',
    };
    this.current = cur;
    this.watch(cur);
    this.broadcast({ t: 'mission', mission });
    this.say(text);
  }

  // ── Režim posmatrača ──
  /** Otvara posmatračku misiju za projekat (ili ostavlja postojeću ako je ista). */
  beginObserve(title: string, folder: string) {
    const c = this.current;
    if (c?.mission.posmatrac && c.mission.status === 'working' && c.mission.title === title) return;
    if (c) this.close();
    const mission: MissionInfo = {
      id: 'm' + Date.now().toString(36), title, prompt: '', folder, createdAt: Date.now(), workMs: 0,
      status: 'working', stats: emptyStats(), files: [], posmatrac: true,
    };
    this.state.missions.push(mission);
    if (this.state.missions.length > MAX_MISSIONS) this.state.missions.splice(0, this.state.missions.length - MAX_MISSIONS);
    this.save();
    // bez praćenja fajlova: folder projekta može biti ogroman (npr. ~)
    this.current = {
      mission, log: [], live: null, names: new Set(), watcher: null, fileTimers: new Map(), idleTimer: null,
      busySince: Date.now(), stopAsked: false, lastChefText: '',
    };
    this.broadcast({ t: 'mission', mission });
  }

  /** Događaj iz posmatrača (hookovi naših sesija). */
  observe(ev: OfficeEvent) {
    const cur = this.current;
    if (!cur || !cur.mission.posmatrac) return;
    countStats(cur.mission.stats, ev);
    this.record(cur, ev);
    if (ev.k === 'hire' || ev.k === 'leave') this.save();
  }

  /** Parler à Max : la mission, puis les retouches. S'il s'était endormi, il reprend sa séance. */
  say(text: string) {
    const cur = this.current;
    if (!cur) throw new Error('Lance d’abord une mission.');
    const clean = text.trim();
    if (!clean) return;
    if (!this.claude) throw new Error('Claude Code n’est pas installé sur cet ordinateur.');
    let l = cur.live;
    if (!l || !l.proc.alive) l = this.spawn(cur);
    if (cur.idleTimer) { clearTimeout(cur.idleTimer); cur.idleTimer = null; }
    l.lastText = clean;
    cur.stopAsked = false;
    if (cur.mission.status !== 'working') {
      cur.mission.status = 'working';
      cur.mission.endedAt = undefined;
      cur.busySince = Date.now();
      this.broadcast({ t: 'mission', mission: cur.mission });
    }
    this.record(cur, { k: 'start', text: clean });
    l.proc.send(clean);
  }

  private spawn(cur: Current, opts: { fresh?: boolean } = {}): Live {
    if (!this.claude) throw new Error('Claude Code n’est pas installé sur cet ordinateur.');
    const s = this.settings;
    const resume = opts.fresh ? undefined : cur.mission.sessionId;
    // le Normalizer renvoie vers la mission courante ; « proc » est connu dès que la ligne suivante a tourné
    const norm: Normalizer = new Normalizer({
      emit: (ev) => { if (cur.live?.proc === proc) this.onEvent(cur, ev); },
      onQuota: (q) => { this.quota = q; this.broadcast({ t: 'quota', quota: q }); },
      onResult: (r) => { if (cur.live?.proc === proc) this.onResult(cur, r); },
      folder: cur.mission.folder,
      names: cur.names,
    });
    const proc: ClaudeProcess = new ClaudeProcess(
      {
        bin: this.claude.path, cwd: cur.mission.folder, permissionMode: s.permission === 'ask' ? 'acceptEdits' : 'auto',
        model: s.chefModel || undefined, resume, tools: SESSION_TOOLS, allowedTools: ALWAYS_ALLOWED,
        agents: agentsJson(s), appendSystemPrompt: chefPrompt(readRules(this.dir)), useApiKey: process.env.BUREAU_USE_API_KEY === '1',
      },
      (m) => {
        if (cur.live?.proc !== proc) return; // un ancien processus qui parle encore
        const refuse = norm.handle(m);
        if (refuse) proc.refuseControl(refuse);
      },
      (code, signal, stderr) => this.onExit(cur, proc, code, signal, stderr),
    );
    const l: Live = { proc, norm, stopping: false, lastText: '', resumed: !!resume };
    cur.live = l;
    proc.start();
    return l;
  }

  private onEvent(cur: Current, ev: OfficeEvent) {
    const m = cur.mission;
    if (ev.k === 'init') {
      const sid = cur.live?.norm.sessionId;
      if (sid) m.sessionId = sid;
      m.model = ev.model;
    }
    if (ev.k === 'say' && ev.who === 'chef') cur.lastChefText = ev.text;
    countStats(m.stats, ev);
    this.record(cur, ev);
    if (ev.k === 'hire' || ev.k === 'init') this.save();
  }

  private onResult(cur: Current, r: TurnResult) {
    const l = cur.live;
    // des membres de l'équipe travaillent encore : Max reprendra la main quand ils auront rendu leur travail
    if (l && l.norm.present.size > 0 && r.ok && !cur.stopAsked) return;
    this.finish(cur, r.ok, r.text.trim() || cur.lastChefText, r.ms, cur.stopAsked);
  }

  private finish(cur: Current, ok: boolean, text: string, ms: number, stopped: boolean) {
    const m = cur.mission;
    if (m.status !== 'working') return;
    // ceux qui travaillaient encore (mission arrêtée, erreur) quittent leur poste
    const present = cur.live?.norm.present;
    if (present?.size) {
      for (const id of present) this.record(cur, { k: 'leave', who: id, ok: false, tokens: 0, tools: 0, ms: 0 });
      present.clear();
    }
    const now = Date.now();
    m.status = ok ? 'done' : stopped ? 'stopped' : 'error';
    m.endedAt = now;
    if (cur.busySince) m.workMs += now - cur.busySince;
    cur.busySince = null;
    if (text) m.final = text.slice(0, 20000);
    // les demandes encore ouvertes n'ont plus d'objet
    const l = cur.live;
    if (l) for (const id of l.norm.pendingRequests()) { l.norm.forgetRequest(id); this.record(cur, { k: 'ask_done', requestId: id, allow: false, cancelled: true }); }
    this.record(cur, { k: 'end', ok, text: m.final ?? '', ms, stopped });
    this.broadcast({ t: 'mission', mission: m });
    this.save();
    // Max reste disponible un moment pour les retouches, puis s'endort (il reprendra sa séance si on lui reparle)
    if (cur.idleTimer) clearTimeout(cur.idleTimer);
    cur.idleTimer = setTimeout(() => {
      if (this.current === cur && cur.mission.status !== 'working' && cur.live) { cur.live.stopping = true; cur.live.proc.stop(); }
    }, IDLE_STOP_MS);
  }

  private onExit(cur: Current, proc: ClaudeProcess, code: number | null, signal: string | null, stderr: string) {
    const l = cur.live;
    if (!l || l.proc !== proc) return;
    cur.live = null;
    const failed = !l.stopping && (code !== 0 || signal !== null);
    // La séance à reprendre n'existe plus (Claude Code efface les vieilles séances) : on repart de zéro.
    if (failed && l.resumed && !l.norm.started && l.lastText && this.current === cur) {
      this.record(cur, { k: 'error', message: 'Je ne retrouve plus notre ancienne conversation : je reprends de zéro, avec ton dernier message.' });
      cur.mission.sessionId = undefined;
      const fresh = this.spawn(cur, { fresh: true });
      fresh.lastText = l.lastText;
      fresh.proc.send(l.lastText);
      return;
    }
    if (cur.mission.status === 'working') {
      const message = failed
        ? (stderr.split('\n').filter(Boolean).slice(-3).join(' ') || (signal ? `Claude Code s’est arrêté (${signal}).` : `Claude Code s’est arrêté (code ${code}).`))
        : 'Claude Code s’est arrêté.';
      if (!cur.stopAsked) this.record(cur, { k: 'error', message });
      // les membres de l'équipe encore présents s'en vont
      for (const id of l.norm.present) this.record(cur, { k: 'leave', who: id, ok: false, tokens: 0, tools: 0, ms: 0 });
      l.norm.present.clear();
      cur.live = l; // le temps de ranger les demandes ouvertes
      this.finish(cur, false, cur.lastChefText, 0, cur.stopAsked);
      cur.live = null;
    }
  }

  private record(cur: Current, ev: OfficeEvent) {
    const at = Date.now();
    this.broadcast({ t: 'ev', missionId: cur.mission.id, at, ev });
    if (ev.k === 'typing') return; // trop bavard pour l'enregistrement
    cur.log.push({ at, ev });
    if (cur.log.length > MAX_LOG) cur.log.splice(0, cur.log.length - MAX_LOG);
    void appendFile(path.join(this.recDir, `${cur.mission.id}.jsonl`), JSON.stringify({ at, ev }) + '\n').catch(() => {});
  }

  // ── Les fichiers produits par l'équipe ──
  private watch(cur: Current) {
    const folder = cur.mission.folder;
    try {
      cur.watcher = watch(folder, { recursive: true }, (_type, name) => {
        if (!name) return;
        const rel = String(name);
        if (rel.split(path.sep).some((p) => p.startsWith('.') || p === 'node_modules')) return;
        const prev = cur.fileTimers.get(rel);
        if (prev) clearTimeout(prev);
        cur.fileTimers.set(rel, setTimeout(() => { cur.fileTimers.delete(rel); void this.fileChanged(cur, rel); }, 350));
      });
      cur.watcher.on('error', () => {});
    } catch { cur.watcher = null; }
  }

  private async fileChanged(cur: Current, rel: string) {
    if (this.current !== cur) return;
    const abs = path.join(cur.mission.folder, rel);
    const st = await stat(abs).catch(() => null);
    if (!st || !st.isFile()) return;
    const files = cur.mission.files;
    const i = files.findIndex((f) => f.path === rel);
    if (i >= 0 && files[i].size === st.size && files[i].at === st.mtimeMs) return;
    const file: FileInfo = {
      path: rel, name: path.basename(rel), ext: path.extname(rel).slice(1).toLowerCase(), size: st.size, at: st.mtimeMs,
      by: cur.live?.norm.writers.get(abs) ?? (i >= 0 ? files[i].by : 'chef'),
    };
    if (i >= 0) files[i] = file; else files.push(file);
    this.record(cur, { k: 'file', file, isNew: i < 0 });
    this.save();
    if (st.size <= MAX_VERSION_SIZE) void this.keepVersion(cur.mission.id, rel, abs, st.mtimeMs, file.by);
  }

  /** Garde une copie de chaque version d'un rendu (l'historique des versions). */
  private async keepVersion(missionId: string, rel: string, abs: string, at: number, by: string) {
    try {
      const dir = path.join(this.verDir, missionId, versionDirName(rel));
      await mkdir(dir, { recursive: true });
      const safeBy = by.replace(/[^\w-]/g, '').slice(0, 64) || 'chef';
      await copyFile(abs, path.join(dir, `${Math.round(at)}__${safeBy}${path.extname(rel)}`));
      const all = (await readdir(dir)).sort();
      for (const old of all.slice(0, Math.max(0, all.length - MAX_VERSIONS))) await unlink(path.join(dir, old)).catch(() => {});
    } catch { /* pas de version cette fois : le fichier reste là */ }
  }

  /** Les versions d'un rendu, de la plus récente à la plus ancienne. */
  async versions(missionId: string, file: string): Promise<VersionInfo[]> {
    this.inside(missionId, file);
    const dir = path.join(this.verDir, missionId, versionDirName(file));
    const names = await readdir(dir).catch(() => [] as string[]);
    const out: VersionInfo[] = [];
    for (const n of names) {
      const m = n.match(/^(\d+)__([\w-]*)/);
      if (!m) continue;
      const st = await stat(path.join(dir, n)).catch(() => null);
      if (st) out.push({ id: n, at: Number(m[1]), size: st.size, by: m[2] || 'chef' });
    }
    return out.sort((a, b) => b.at - a.at);
  }

  /** Le chemin d'un fichier de la mission pour l'aperçu des sites (null s'il sort du dossier). */
  previewPath(missionId: string, rel: string): string | null {
    const m = this.mission(missionId);
    if (!m) return null;
    const target = path.resolve(m.folder, rel);
    if (!target.startsWith(m.folder + path.sep) || !existsSync(target)) return null;
    return target;
  }

  /** Tous les agents passés au bureau, mission par mission (les plus récentes d'abord). */
  async teamHistory(): Promise<TeamEntry[]> {
    const out: TeamEntry[] = [];
    for (const m of this.missions().slice(0, 40)) {
      const raw = await readFile(path.join(this.recDir, `${m.id}.jsonl`), 'utf8').catch(() => '');
      const byId = new Map<string, TeamEntry>();
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        let l: Logged;
        try { l = JSON.parse(line) as Logged; } catch { continue; }
        const ev = l.ev;
        if (ev.k === 'hire') {
          byId.set(ev.id, {
            missionId: m.id, missionTitle: m.title, at: l.at, id: ev.id, name: ev.name, role: ev.role as Role, task: ev.task,
            status: 'working', tools: 0, tokens: 0, ms: 0, report: '',
          });
        } else if (ev.k === 'report') {
          const e = byId.get(ev.who);
          if (e) e.report = ev.text.slice(0, 600);
        } else if (ev.k === 'leave') {
          const e = byId.get(ev.who);
          if (e) Object.assign(e, { status: ev.ok ? 'done' : 'failed', tools: ev.tools, tokens: ev.tokens, ms: ev.ms || l.at - e.at });
        }
      }
      out.push(...[...byId.values()].reverse());
    }
    return out;
  }

  // ── Les commandes du bureau ──
  stop() {
    const cur = this.current;
    if (!cur || cur.mission.status !== 'working') return;
    cur.stopAsked = true;
    if (cur.live?.proc.alive) cur.live.proc.interrupt();
    else this.finish(cur, false, cur.lastChefText, 0, true);
  }

  answer(requestId: string, allow: boolean) {
    const cur = this.current;
    const l = cur?.live;
    if (!cur || !l || !l.norm.hasRequest(requestId)) return;
    l.proc.answerPermission(requestId, allow, l.norm.inputOf(requestId));
    l.norm.forgetRequest(requestId);
    this.record(cur, { k: 'ask_done', requestId, allow });
  }

  /** On range la mission (fin de journée) : le bureau est prêt pour la suivante. */
  close() {
    const cur = this.current;
    if (!cur) return;
    if (cur.mission.status === 'working') { cur.stopAsked = true; this.finish(cur, false, cur.lastChefText, 0, true); }
    if (cur.idleTimer) clearTimeout(cur.idleTimer);
    for (const t of cur.fileTimers.values()) clearTimeout(t);
    cur.watcher?.close();
    if (cur.live) { cur.live.stopping = true; cur.live.proc.stop(); }
    this.current = null;
    this.broadcast({ t: 'closed', missionId: cur.mission.id });
    this.save();
  }

  /** Le chemin d'un fichier de la mission (refusé s'il sort du dossier). */
  private inside(missionId: string, file?: string) {
    const m = this.mission(missionId);
    if (!m) throw new Error('Cette mission n’existe plus.');
    if (!file) return { m, target: m.folder };
    const target = path.resolve(m.folder, file);
    if (!target.startsWith(m.folder + path.sep) || !existsSync(target)) throw new Error('Ce fichier n’est pas dans le dossier de la mission.');
    return { m, target };
  }

  /** Ouvre le dossier de la mission (ou un de ses fichiers) avec l'appli par défaut. */
  open(missionId: string, file?: string) {
    const { target } = this.inside(missionId, file);
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    execFile(opener, [target], () => {});
  }

  /** Ouvre le dossier du bureau, ou son règlement (dans l'éditeur de texte par défaut). */
  openRoot(rules: boolean) {
    const target = rules ? path.join(this.dir, RULES_FILE) : this.dir;
    if (rules && !existsSync(target)) writeFileSync(target, RULES_TEMPLATE);
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    execFile(opener, rules && process.platform === 'darwin' ? ['-t', target] : [target], () => {});
  }

  /** Le texte d'un rendu (rapport, CSV…), pour le lire dans le bureau. */
  async readText(missionId: string, file: string, version?: string) {
    let { target } = this.inside(missionId, file);
    if (version) {
      if (!/^\d+__[\w-]*(\.[\w-]+)?$/.test(version)) throw new Error('Version inconnue.');
      target = path.join(this.verDir, missionId, versionDirName(file), version);
      if (!existsSync(target)) throw new Error('Cette version n’existe plus.');
    }
    const st = await stat(target);
    const max = 400_000;
    const buf = await readFile(target);
    return { text: buf.subarray(0, max).toString('utf8'), truncated: st.size > max };
  }

  /** L'enregistrement d'une mission, pour la rejouer (pratique pour filmer sans relancer l'équipe). */
  async replay(missionId: string): Promise<{ mission: MissionInfo; log: Logged[] }> {
    const m = this.mission(missionId);
    if (!m) throw new Error('Cette mission n’existe plus.');
    const raw = await readFile(path.join(this.recDir, `${m.id}.jsonl`), 'utf8').catch(() => '');
    const log: Logged[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { log.push(JSON.parse(line) as Logged); } catch { /* ligne coupée */ }
    }
    if (!log.length) throw new Error('Cette mission n’a pas été enregistrée.');
    return { mission: m, log };
  }

  /** Sauvegarde groupée (au plus une fois par seconde), écrite d'un coup pour ne jamais laisser un fichier à moitié écrit. */
  save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      try {
        const tmp = this.stateFile + '.tmp';
        await writeFile(tmp, JSON.stringify(this.state));
        await rename(tmp, this.stateFile);
      } catch (e) {
        console.error('  ⚠  Sauvegarde du bureau impossible :', e instanceof Error ? e.message : e);
      }
    }, 1000);
  }

  /** Le pont s'arrête : tout le monde s'arrête tout de suite, et on sauvegarde. */
  shutdown() {
    const cur = this.current;
    if (cur) {
      if (cur.mission.status === 'working') { cur.mission.status = 'stopped'; cur.mission.endedAt = Date.now(); if (cur.busySince) cur.mission.workMs += Date.now() - cur.busySince; }
      cur.watcher?.close();
      if (cur.live) { cur.live.stopping = true; cur.live.proc.kill(); }
    }
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    try {
      const tmp = this.stateFile + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.state));
      renameSync(tmp, this.stateFile);
    } catch { /* tant pis : l'état de la dernière sauvegarde reste */ }
  }
}
