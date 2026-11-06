// Režim posmatrača: kancelarija ne pokreće nijednog agenta. Hookovi iz naših Claude Code sesija
// (hooks/kancelarija-hook.mjs) šalju ovde šta se dešava, a mi to prevodimo u događaje kancelarije
// (hire / act / act_done / report / leave / plan). Šef je glavna nit sesije, agenti su podagenti.
//
// Redosled koji smo izmerili (faza 0, v2.1.304):
//   PreToolUse(Agent, bez agent_id)  → opis "[Odeljenje] zadatak", subagent_type
//   SubagentStart(agent_id)          → agent je krenuo
//   PostToolUse(Agent).tool_response → { agentId, description, resolvedModel } (async agent)
//   Pre/PostToolUse(agent_id=…)      → šta podagent radi
//   PreToolUse(SubagentHandback)     → rezultat agenta
//   SubagentStop(agent_id)           → može da stigne DVAPUT, zato izlazak ide sa zadrškom
import { readFile } from 'node:fs/promises';
import { cut, describeAct, NAMES, roleOfType } from '../shared/activity.ts';
import type { OfficeEvent, PlanItem, Role } from '../shared/protocol.ts';

type Json = Record<string, any>;

/** Ono što hook šalje (već skraćeno u hooku). */
export interface HookMsg {
  event: string;
  session_id: string;
  cwd?: string;
  agent_id?: string;
  agent_type?: string;
  agent_transcript_path?: string;
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: Json;
  tool_response?: Json;
}

interface Pending { toolUseId: string; type: string; description: string; prompt: string; model: string }
interface AgentInfo { description: string; model: string; prompt: string; type: string }
interface Present {
  session: string;
  since: number;
  tools: number;
  transcript: string;
  stopTimer: NodeJS.Timeout | null;
}

/** Posle poslednjeg SubagentStop čekamo ovoliko pre nego što lik ode (drugi Stop može da stigne). */
const LEAVE_DEBOUNCE_MS = 2500;
/** Koliko čekamo PostToolUse(Agent) sa tačnim agentId pre nego što uparimo po redosledu. */
const MATCH_WAIT_MS = 250;
const ROTATION: Role[] = ['recherche', 'code', 'design', 'redaction', 'analyse'];

/** "[Transkripcija] RMA čas 5" → { dept: "Transkripcija", task: "RMA čas 5" } */
export function splitDept(description: string): { dept: string; task: string } {
  const m = description.match(/^\s*\[([^\]]{1,40})\]\s*(.*)$/);
  return m ? { dept: m[1].trim(), task: m[2].trim() || m[1].trim() } : { dept: '', task: description.trim() };
}

/** Faza 1: odeljenje se raspoređuje na jedan od 5 postojećih kutaka (faza 2 crta prava odeljenja). */
function roleOf(dept: string, type: string): Role {
  if (!dept) return roleOfType(type);
  let h = 0;
  for (const ch of dept.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ROTATION[h % ROTATION.length];
}

export class Observer {
  private queue = new Map<string, Pending[]>();          // sesija → Agent pozivi koji još nisu upareni
  private info = new Map<string, AgentInfo>();           // agent_id → opis i model (iz PostToolUse(Agent))
  private waiting = new Map<string, NodeJS.Timeout>();   // agent_id → čeka uparivanje
  private present = new Map<string, Present>();          // agent_id → prisutan u kancelariji
  private plans = new Map<string, PlanItem[]>();         // sesija → poslednji plan
  private names = new Set<string>();
  private emit: (ev: OfficeEvent) => void;

  constructor(emit: (ev: OfficeEvent) => void) {
    this.emit = emit;
  }

  handle(m: HookMsg) {
    const s = m.session_id;
    if (!s) return;
    switch (m.event) {
      case 'PreToolUse': return m.agent_id ? this.agentPre(m) : this.chefPre(m);
      case 'PostToolUse': return m.agent_id ? this.agentPost(m) : this.chefPost(m);
      case 'SubagentStart': return this.start(m);
      case 'SubagentStop': return this.stop(m);
      case 'SessionEnd': return this.sessionEnd(s);
    }
  }

  // ── Šef (glavna nit sesije) ──
  private chefPre(m: HookMsg) {
    const tool = m.tool_name ?? '';
    const input = m.tool_input ?? {};
    if (tool === 'Agent' || tool === 'Task') {
      const q = this.queue.get(m.session_id) ?? [];
      q.push({
        toolUseId: m.tool_use_id ?? '', type: String(input.subagent_type ?? 'general-purpose'),
        description: String(input.description ?? ''), prompt: String(input.prompt ?? ''), model: String(input.model ?? ''),
      });
      this.queue.set(m.session_id, q);
      return;
    }
    if (tool === 'TodoWrite' || tool.endsWith('update_plan')) { this.plan(m.session_id, tool, input); return; }
    if (tool.endsWith('wrap_up')) return;
    const { kind, label, detail } = describeAct(tool, input);
    this.emit({ k: 'act', who: 'chef', id: m.tool_use_id ?? '', kind, tool, label, detail });
  }

  private chefPost(m: HookMsg) {
    const tool = m.tool_name ?? '';
    if (tool === 'Agent' || tool === 'Task') {
      const r = m.tool_response ?? {};
      const q = this.queue.get(m.session_id);
      if (q) { const i = q.findIndex((p) => p.toolUseId === m.tool_use_id); if (i >= 0) q.splice(i, 1); }
      const agentId = String(r.agentId ?? '');
      if (!agentId) return;
      const input = m.tool_input ?? {};
      if (!this.info.has(agentId)) {
        this.info.set(agentId, {
          description: String(r.description ?? input.description ?? ''), model: String(r.resolvedModel ?? input.model ?? ''),
          prompt: String(r.prompt ?? input.prompt ?? ''), type: String(input.subagent_type ?? 'general-purpose'),
        });
      }
      // agent je već javio SubagentStart i čeka opis: sad ga imamo
      const t = this.waiting.get(agentId);
      if (t) { clearTimeout(t); this.waiting.delete(agentId); this.hire(agentId, m.session_id, ''); }
      return;
    }
    if (tool.endsWith('update_plan') || tool === 'TodoWrite' || tool.endsWith('wrap_up')) return;
    this.emit({ k: 'act_done', who: 'chef', id: m.tool_use_id ?? '', ok: !m.tool_response?.is_error });
  }

  /** update_plan (desktop aplikacija) ili TodoWrite → tabla. */
  private plan(session: string, tool: string, input: Json) {
    let items = this.plans.get(session) ?? [];
    if (tool === 'TodoWrite') {
      const todos = Array.isArray(input.todos) ? (input.todos as Json[]) : [];
      items = todos.map((t) => ({ text: cut(t.content ?? t.activeForm ?? '', 90), status: status(t.status) }));
    } else if (Array.isArray(input.items)) {
      items = (input.items as Json[]).map((t) => ({ text: cut(t.content ?? '', 90), status: status(t.status) }));
    } else {
      items = items.map((x) => ({ ...x }));
      if (input.advance) {
        const cur = items.findIndex((x) => x.status === 'in_progress');
        if (cur >= 0) items[cur].status = 'completed';
        const next = items.findIndex((x) => x.status === 'pending');
        if (next >= 0) items[next].status = 'in_progress';
      }
      if (Array.isArray(input.done)) for (const n of input.done) if (items[n - 1]) items[n - 1].status = 'completed';
      if (typeof input.start === 'number' && items[input.start - 1]) items[input.start - 1].status = 'in_progress';
    }
    this.plans.set(session, items);
    this.emit({ k: 'plan', items });
  }

  // ── Agenti ──
  private start(m: HookMsg) {
    const id = m.agent_id;
    if (!id || this.present.has(id) || this.waiting.has(id)) return;
    if (this.info.has(id)) { this.hire(id, m.session_id, m.agent_type ?? ''); return; }
    // tačan opis stiže u PostToolUse(Agent) za par ms; ako ne stigne (sinhroni agent), uparujemo po redosledu
    this.waiting.set(id, setTimeout(() => {
      this.waiting.delete(id);
      const q = this.queue.get(m.session_id) ?? [];
      const i = Math.max(0, q.findIndex((p) => p.type === m.agent_type));
      const p = q.splice(i, 1)[0];
      if (p) this.info.set(id, { description: p.description, model: p.model, prompt: p.prompt, type: p.type });
      this.hire(id, m.session_id, m.agent_type ?? '');
    }, MATCH_WAIT_MS));
  }

  private hire(id: string, session: string, type: string) {
    if (this.present.has(id)) return;
    const inf = this.info.get(id) ?? { description: type || 'Agent', model: '', prompt: '', type };
    const { dept, task } = splitDept(inf.description);
    const role = roleOf(dept, inf.type || type);
    this.present.set(id, { session, since: Date.now(), tools: 0, transcript: '', stopTimer: null });
    this.emit({
      k: 'hire', id, role, type: inf.type || type, name: this.pickName(role), task: cut(task || 'Zadatak', 48),
      prompt: cut(inf.prompt, 2000), model: inf.model, dept,
    });
  }

  private agentPre(m: HookMsg) {
    const id = m.agent_id!;
    const p = this.present.get(id);
    if (!p) return;
    this.keepAlive(p);
    const tool = m.tool_name ?? '';
    const input = m.tool_input ?? {};
    if (tool === 'SubagentHandback') {
      this.emit({ k: 'report', who: id, text: String(input.message ?? '').slice(0, 20000) });
      return;
    }
    p.tools++;
    const { kind, label, detail } = describeAct(tool, input);
    this.emit({ k: 'act', who: id, id: m.tool_use_id ?? '', kind, tool, label, detail });
  }

  private agentPost(m: HookMsg) {
    const id = m.agent_id!;
    const p = this.present.get(id);
    if (!p || m.tool_name === 'SubagentHandback') return;
    this.keepAlive(p);
    this.emit({ k: 'act_done', who: id, id: m.tool_use_id ?? '', ok: !m.tool_response?.is_error });
  }

  /** Agent i dalje radi: otkazujemo izlazak ako je SubagentStop stigao prerano. */
  private keepAlive(p: Present) {
    if (p.stopTimer) { clearTimeout(p.stopTimer); p.stopTimer = null; }
  }

  private stop(m: HookMsg) {
    const id = m.agent_id;
    if (!id) return;
    const w = this.waiting.get(id);
    if (w) { clearTimeout(w); this.waiting.delete(id); this.hire(id, m.session_id, m.agent_type ?? ''); }
    const p = this.present.get(id);
    if (!p) return;
    if (m.agent_transcript_path) p.transcript = m.agent_transcript_path;
    if (p.stopTimer) clearTimeout(p.stopTimer);
    p.stopTimer = setTimeout(() => void this.leave(id, true), LEAVE_DEBOUNCE_MS);
  }

  private async leave(id: string, ok: boolean) {
    const p = this.present.get(id);
    if (!p) return;
    this.present.delete(id);
    this.info.delete(id);
    const tokens = p.transcript ? await tokensOf(p.transcript) : 0;
    this.emit({ k: 'leave', who: id, ok, tokens, tools: p.tools, ms: Date.now() - p.since });
  }

  private sessionEnd(session: string) {
    for (const [id, p] of this.present) if (p.session === session) { this.keepAlive(p); void this.leave(id, false); }
    this.queue.delete(session);
    this.plans.delete(session);
  }

  /** Ko je trenutno u kancelariji (za ispis na serveru i proveru). */
  presentCount() { return this.present.size; }

  /** Server se gasi ili posmatranje se zatvara: svi izlaze. */
  clear() {
    for (const p of this.present.values()) this.keepAlive(p);
    for (const t of this.waiting.values()) clearTimeout(t);
    this.present.clear(); this.waiting.clear(); this.queue.clear(); this.info.clear(); this.plans.clear(); this.names.clear();
  }

  private pickName(role: Role) {
    const name = NAMES[role].find((n) => !this.names.has(n)) ?? `Agent ${this.names.size + 1}`;
    this.names.add(name);
    return name;
  }
}

const status = (s: unknown): PlanItem['status'] => (s === 'completed' ? 'completed' : s === 'in_progress' ? 'in_progress' : 'pending');

/** Tokeni agenta iz njegovog transcripta (ulaz + izlaz + upis u keš; čitanje iz keša se ne broji). */
async function tokensOf(file: string): Promise<number> {
  try {
    const raw = await readFile(file, 'utf8');
    let n = 0;
    for (const line of raw.split('\n')) {
      if (!line.includes('"usage"')) continue;
      try {
        const u = JSON.parse(line)?.message?.usage;
        if (u) n += (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      } catch { /* prekinut red */ }
    }
    return n;
  } catch { return 0; }
}
