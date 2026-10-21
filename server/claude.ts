// Le chef du bureau = un vrai processus Claude Code, lancé sans interface (« -p »), qui parle en JSON
// ligne par ligne :
//   - on lui écrit tes messages sur son entrée (stream-json) ;
//   - il raconte tout sur sa sortie : réflexion, texte, outils, membres de l'équipe appelés, rapports ;
//   - quand il a besoin d'une permission, il la demande (control_request) et attend la réponse du bureau.
// Il tourne avec le compte connecté à Claude Code, donc ton abonnement : on retire toute clé API de son
// environnement pour qu'il ne bascule jamais en facturation à l'usage.
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { describeAct, NAMES, permissionText, roleOfType, ROLES, cut } from '../shared/activity.ts';
import type { OfficeEvent, PlanItem, Quota, Role } from '../shared/protocol.ts';

export interface ClaudeBinary { path: string; version: string }

const WIN = process.platform === 'win32';

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // shell:true sur Windows : npm installe `claude` comme script .cmd, qu'execFile ne peut pas lancer
    // directement (ce n'est pas un .exe) sans passer par cmd.exe.
    execFile(file, args, { timeout: 15000, shell: WIN }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/** Trouve l'exécutable `claude` (sans passer par les alias du terminal). */
export async function findClaude(): Promise<ClaudeBinary | null> {
  const home = os.homedir();
  // Sur Windows, npm écrit claude.cmd/claude.exe (claude sans extension n'est qu'un script Unix, pas exécutable ici).
  const names = WIN ? ['claude.cmd', 'claude.exe', 'claude'] : ['claude'];
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const fromPath = pathDirs.flatMap((d) => names.map((n) => path.join(d, n)));
  const fromHome = names.flatMap((n) => [path.join(home, '.local/bin', n), path.join(home, '.claude/local', n)]);
  const candidates = [process.env.CLAUDE_BIN, ...fromPath, ...fromHome, '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
  for (const c of new Set(candidates.filter((x): x is string => !!x))) {
    if (!existsSync(c)) continue;
    try {
      const out = await run(c, ['--version']);
      return { path: c, version: out.trim().split(/\s+/)[0] ?? out.trim() };
    } catch { /* on essaie le suivant */ }
  }
  return null;
}

export interface ProcessOptions {
  bin: string;
  cwd: string;
  permissionMode: string;
  model?: string;
  resume?: string;
  /** les outils de la séance (mode restreint : rien d'autre n'existe) */
  tools: string[];
  /** ce qui ne demande jamais la permission */
  allowedTools: string[];
  /** l'équipe (option --agents) */
  agents: string;
  /** les consignes du chef, ajoutées à celles de Claude Code */
  appendSystemPrompt: string;
  useApiKey: boolean;
}

type Json = Record<string, any>;

/** Le processus Claude Code d'une mission. */
export class ClaudeProcess {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private stderr = '';
  private exited = false;

  private opts: ProcessOptions;
  private onMessage: (m: Json) => void;
  private onExit: (code: number | null, signal: string | null, stderr: string) => void;

  constructor(opts: ProcessOptions, onMessage: (m: Json) => void, onExit: (code: number | null, signal: string | null, stderr: string) => void) {
    this.opts = opts;
    this.onMessage = onMessage;
    this.onExit = onExit;
  }

  get alive() { return !!this.proc && !this.exited; }

  start() {
    const o = this.opts;
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--permission-prompt-tool', 'stdio', '--permission-mode', o.permissionMode,
      // mode restreint : seuls les outils listés existent, les outils de fichiers restent dans le dossier
      // de la mission, et ni tes réglages ni tes agents personnels ne s'invitent dans le bureau
      '--restricted', '--tools', o.tools.join(','),
      '--agents', o.agents,
      '--append-system-prompt', o.appendSystemPrompt];
    if (o.model) args.push('--model', o.model);
    if (o.resume) args.push('--resume', o.resume);
    if (o.allowedTools.length) args.push('--allowedTools', o.allowedTools.join(','));
    // pas de questions à choix multiples : le chef pose ses questions dans la conversation
    args.push('--disallowedTools', 'AskUserQuestion');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      BUREAU_DES_AGENTS: '1',
      // seule l'équipe du bureau peut être appelée (pas les agents génériques de Claude Code)
      CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: '1',
      // les membres de l'équipe n'appellent pas eux-mêmes d'autres agents : c'est le rôle du chef
      CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '1',
      // l'équipe travaille au premier plan : le chef attend les rapports, puis assemble le rendu
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
    };
    if (!o.useApiKey) { delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; }
    const p = spawn(o.bin, args, { cwd: o.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], shell: WIN });
    this.proc = p;
    readline.createInterface({ input: p.stdout }).on('line', (line) => {
      if (!line.trim()) return;
      let m: Json;
      try { m = JSON.parse(line); } catch { return; }
      this.onMessage(m);
    });
    p.stderr.on('data', (b: Buffer) => { this.stderr = (this.stderr + b.toString()).slice(-4000); });
    const done = (code: number | null, signal: string | null) => {
      if (this.exited) return;
      this.exited = true;
      this.onExit(code, signal, this.stderr);
    };
    // « close » arrive une fois la sortie entièrement lue (contrairement à « exit »)
    p.on('close', (code, signal) => done(code, signal));
    // impossible de lancer claude (supprimé, plus exécutable…) : c'est une fin, en erreur
    p.on('error', (e) => { this.stderr += String(e); done(1, null); });
    p.stdin.on('error', () => { /* processus déjà parti : « close » s'en charge */ });
  }

  private write(o: Json) {
    if (!this.alive) return false;
    this.proc!.stdin.write(JSON.stringify(o) + '\n');
    return true;
  }

  send(text: string) {
    return this.write({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
  }

  answerPermission(requestId: string, allow: boolean, input: unknown) {
    this.write({
      type: 'control_response',
      response: {
        subtype: 'success', request_id: requestId,
        response: allow ? { behavior: 'allow', updatedInput: input ?? {} } : { behavior: 'deny', message: 'Le patron a dit non. Trouve une autre façon de faire, ou demande-lui.' },
      },
    });
  }

  /** Une demande de contrôle qu'on ne sait pas traiter : on répond tout de suite pour ne pas le bloquer. */
  refuseControl(requestId: string) {
    this.write({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error: 'Non pris en charge par le Bureau des agents' } });
  }

  interrupt() {
    this.write({ type: 'control_request', request_id: `stop-${Date.now()}`, request: { subtype: 'interrupt' } });
  }

  stop() {
    if (!this.alive) return;
    this.proc!.stdin.end();
    const p = this.proc!;
    setTimeout(() => { if (!this.exited) p.kill('SIGTERM'); }, 5000);
  }

  /** Arrêt immédiat (quand le pont s'arrête). */
  kill() {
    if (this.alive) this.proc!.kill('SIGTERM');
  }
}

export interface TurnResult { ok: boolean; text: string; ms: number; subtype: string }

/**
 * Traduit ce que raconte Claude Code en événements du bureau.
 * `who` vaut « chef » (l'agent principal) ou l'identifiant de l'appel Agent qui a fait venir un membre
 * de l'équipe (on le retrouve dans parent_tool_use_id sur tous ses messages).
 */
export class Normalizer {
  private whoOfTool = new Map<string, string>();      // appel d'outil → qui l'a fait
  private agentOfTask = new Map<string, string>();    // task_id → membre de l'équipe
  private reported = new Set<string>();
  private typing = new Map<string, string>();         // texte en cours d'écriture, par agent
  private typingSentAt = new Map<string, number>();
  private pendingInputs = new Map<string, unknown>(); // demandes de permission → entrée de l'outil
  /** les membres de l'équipe présents (appelés, pas encore repartis) */
  readonly present = new Set<string>();
  /** qui a écrit quel fichier en dernier (pour attribuer les fichiers du dossier) */
  readonly writers = new Map<string, string>();
  /** vrai dès que Claude Code a démarré (message init) */
  started = false;
  sessionId = '';

  private emit: (ev: OfficeEvent) => void;
  private onQuota: (q: Quota) => void;
  private onResult: (r: TurnResult) => void;
  private folder: string;
  /** les prénoms déjà pris dans cette mission (partagés entre les reprises) */
  private names: Set<string>;

  constructor(opts: { emit: (ev: OfficeEvent) => void; onQuota: (q: Quota) => void; onResult: (r: TurnResult) => void; folder: string; names: Set<string> }) {
    this.emit = opts.emit;
    this.onQuota = opts.onQuota;
    this.onResult = opts.onResult;
    this.folder = opts.folder;
    this.names = opts.names;
  }

  inputOf(requestId: string) { return this.pendingInputs.get(requestId); }
  forgetRequest(requestId: string) { this.pendingInputs.delete(requestId); }
  hasRequest(requestId: string) { return this.pendingInputs.has(requestId); }
  pendingRequests() { return [...this.pendingInputs.keys()]; }

  private pickName(role: Role) {
    const name = NAMES[role].find((n) => !this.names.has(n)) ?? `${ROLES[role].label} ${this.names.size + 1}`;
    this.names.add(name);
    return name;
  }

  /** Renvoie l'identifiant de la demande de contrôle qu'il faut refuser (inconnue), sinon null. */
  handle(m: Json): string | null {
    switch (m.type) {
      case 'system': this.system(m); break;
      case 'stream_event': this.stream(m); break;
      case 'assistant': this.assistant(m); break;
      case 'user': this.user(m); break;
      case 'result':
        this.typing.clear();
        this.onResult({ ok: !m.is_error && m.subtype === 'success', text: String(m.result ?? ''), ms: Number(m.duration_ms ?? 0), subtype: String(m.subtype ?? '') });
        break;
      case 'rate_limit_event': {
        const w = m.rate_limit_info?.unifiedWindows ?? {};
        if (w.five_hour) this.onQuota({ fiveHour: Number(w.five_hour.utilization ?? 0), resetsAt: Number(w.five_hour.resetsAt ?? 0) || null });
        break;
      }
      case 'control_request': {
        const r = m.request ?? {};
        if (r.subtype !== 'can_use_tool') return String(m.request_id ?? '');
        const tool = String(r.tool_name ?? '');
        const input = (r.input ?? {}) as Record<string, unknown>;
        this.pendingInputs.set(m.request_id, input);
        const who = (r.tool_use_id && this.whoOfTool.get(r.tool_use_id)) || 'chef';
        const { label, detail, full } = permissionText(tool, input, this.folder);
        this.emit({ k: 'ask', who, requestId: m.request_id, tool, label, detail, full });
        break;
      }
      case 'control_cancel_request': {
        // Claude Code retire sa demande (interruption, fin de tour) : on range la bulle
        const id = String(m.request_id ?? '');
        if (this.pendingInputs.has(id)) {
          this.pendingInputs.delete(id);
          this.emit({ k: 'ask_done', requestId: id, allow: false, cancelled: true });
        }
        break;
      }
    }
    return null;
  }

  private system(m: Json) {
    switch (m.subtype) {
      case 'init':
        this.started = true;
        this.sessionId = String(m.session_id ?? '');
        this.emit({ k: 'init', model: String(m.model ?? ''), auth: String(m.apiKeySource ?? '') });
        break;
      case 'task_started':
        if (m.task_id && m.tool_use_id) this.agentOfTask.set(m.task_id, m.tool_use_id);
        break;
      case 'task_notification':
        if (m.tool_use_id && m.status) this.leave(m.tool_use_id, m.status === 'completed', m.usage);
        break;
    }
  }

  private leave(id: string, ok: boolean, usage?: Json) {
    if (!this.present.has(id)) return;
    this.present.delete(id);
    this.emit({ k: 'leave', who: id, ok, tokens: Number(usage?.total_tokens ?? 0), tools: Number(usage?.tool_uses ?? 0), ms: Number(usage?.duration_ms ?? 0) });
  }

  private stream(m: Json) {
    const who: string = m.parent_tool_use_id ?? 'chef';
    const e = m.event ?? {};
    if (e.type === 'content_block_start') {
      const b = e.content_block ?? {};
      if (b.type === 'thinking') this.emit({ k: 'think', who });
      if (b.type === 'text') this.typing.set(who, '');
    } else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
      const text = (this.typing.get(who) ?? '') + String(e.delta.text ?? '');
      this.typing.set(who, text);
      const now = Date.now();
      if (now - (this.typingSentAt.get(who) ?? 0) > 120) {
        this.typingSentAt.set(who, now);
        this.emit({ k: 'typing', who, text });
      }
    }
  }

  private assistant(m: Json) {
    const who: string = m.parent_tool_use_id ?? 'chef';
    const content = Array.isArray(m.message?.content) ? m.message.content : [];
    for (const c of content as Json[]) {
      if (c.type === 'text' && String(c.text ?? '').trim()) {
        this.typing.delete(who);
        this.emit({ k: 'say', who, text: String(c.text) });
      } else if (c.type === 'tool_use') {
        const name = String(c.name ?? '');
        const input = (c.input ?? {}) as Record<string, unknown>;
        this.whoOfTool.set(c.id, who);
        if (name === 'Agent' || name === 'Task') {
          const type = String(input.subagent_type ?? '');
          const role = roleOfType(type);
          this.present.add(c.id);
          this.emit({ k: 'hire', id: c.id, role, type, name: this.pickName(role), task: cut(input.description || ROLES[role].label, 48), prompt: cut(input.prompt, 2000) });
        } else if (name === 'SubagentHandback') {
          this.reported.add(who);
          this.emit({ k: 'report', who, text: String(input.message ?? '').slice(0, 20000) });
        } else if (name === 'TodoWrite' && who === 'chef') {
          const todos = Array.isArray(input.todos) ? (input.todos as Json[]) : [];
          const items: PlanItem[] = todos.map((t) => ({
            text: cut(t.content ?? t.activeForm ?? '', 90),
            status: t.status === 'completed' ? 'completed' : t.status === 'in_progress' ? 'in_progress' : 'pending',
          }));
          this.emit({ k: 'plan', items });
        } else {
          const { kind, label, detail } = describeAct(name, input);
          if ((name === 'Write' || name === 'Edit' || name === 'MultiEdit') && typeof input.file_path === 'string') this.writers.set(input.file_path, who);
          this.emit({ k: 'act', who, id: c.id, kind, tool: name, label, detail });
        }
      }
    }
  }

  private user(m: Json) {
    const content = Array.isArray(m.message?.content) ? m.message.content : [];
    for (const c of content as Json[]) {
      if (c.type !== 'tool_result') continue;
      const id = String(c.tool_use_id ?? '');
      const who = this.whoOfTool.get(id);
      if (who === undefined) continue;
      if (this.present.has(id)) {
        // le rapport d'un membre de l'équipe revient au chef : s'il n'a pas été rendu en direct, on le prend ici
        const r = (m.tool_use_result ?? {}) as Json;
        if (!this.reported.has(id)) {
          const text = typeof r.handbackReport?.text === 'string' ? r.handbackReport.text : textOf(c.content);
          if (text.trim()) { this.reported.add(id); this.emit({ k: 'report', who: id, text: text.slice(0, 20000) }); }
        }
        this.leave(id, !c.is_error && r.status !== 'failed', r.usage ?? { total_tokens: r.totalTokens, tool_uses: r.totalToolUseCount, duration_ms: r.totalDurationMs });
        continue;
      }
      this.emit({ k: 'act_done', who, id, ok: !c.is_error });
    }
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c: Json) => (c?.type === 'text' ? String(c.text ?? '') : '')).join('\n');
  return '';
}
