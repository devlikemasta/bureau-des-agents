// Les métiers du bureau, et la traduction en français de ce que fait vraiment chaque agent :
// chaque outil de Claude Code devient une action (une icône, une animation, une bulle).
import type { ActKind, MissionStats, Odeljenje, OfficeEvent, Role } from './protocol.ts';

export interface RoleInfo {
  /** le nom du métier, tel qu'il s'affiche dans le bureau */
  label: string;
  icon: string;
  color: string;
  /** l'agent Claude Code (subagent_type) qui fait ce métier */
  type: string;
  what: string;
}

export const ROLES: Record<Role, RoleInfo> = {
  chef: { label: 'Chef de projet', icon: '⭐', color: '#FF8A3D', type: '', what: 'Prima tvoj zahtev, pravi plan, raspoređuje posao i sklapa rezultat.' },
  recherche: { label: 'Recherche', icon: '🔎', color: '#4FB3FF', type: 'chercheur', what: 'Traži po internetu: konkurenciju, cene, mišljenja, vesti, izvore.' },
  code: { label: 'Code', icon: '💻', color: '#3DDC97', type: 'developpeur', what: 'Kod, sajtovi, skripte, automatizacije: sve što se pokreće i testira.' },
  design: { label: 'Design', icon: '🎨', color: '#FF6FA8', type: 'designer', what: 'Uredne veb stranice, makete, vizuali, oblikovanje.' },
  redaction: { label: 'Rédaction', icon: '✍️', color: '#A98BFF', type: 'redacteur', what: 'Objave, mejlovi, članci, skripte za video, izveštaji.' },
  analyse: { label: 'Analyse', icon: '📊', color: '#FFC93D', type: 'analyste', what: 'Brojevi, tabele, fajlovi, poređenja, računanje.' },
  sesti: { label: 'Slobodno', icon: '📦', color: '#5A5F6E', type: '', what: 'Slobodan kutak.' },
  renfort: { label: 'Pomoćni sto', icon: '🤖', color: '#9AA3B5', type: '', what: 'Agent bez odeljenja.' },
};

/** Redosled kojim se odeljenja projekta raspoređuju po kutcima (prvo najveći i najvidljiviji). */
export const SLOTS: Role[] = ['recherche', 'code', 'redaction', 'sesti', 'design', 'analyse'];
const PRAZNO = '#5A5F6E';

/** Odeljenja projekta postaju natpisi, ikone i boje kutaka (menja ROLES na licu mesta). */
export function applyOdeljenja(list: Odeljenje[]) {
  ROLES.chef.label = 'Šef';
  for (const slot of SLOTS) {
    const o = list.find((x) => x.slot === slot);
    ROLES[slot].label = o ? o.naziv : 'Slobodno';
    ROLES[slot].icon = o ? o.ikona : '📦';
    ROLES[slot].color = o ? o.boja : PRAZNO;
    ROLES[slot].what = o ? `Odeljenje ${o.naziv}.` : 'Slobodan kutak.';
  }
}

/** Les outils Claude Code de chaque métier (le chef a tous ceux de la séance). */
export const ROLE_TOOLS: Record<Role, string[]> = {
  chef: ['Agent', 'TodoWrite', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Bash'],
  recherche: ['WebSearch', 'WebFetch', 'Read', 'Glob', 'Grep'],
  code: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebFetch'],
  design: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch'],
  redaction: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
  analyse: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
  sesti: [],
  renfort: [],
};

/** Ce que veut dire chaque outil, en français (pour la fiche des métiers). */
export const TOOL_INFO: Record<string, string> = {
  Agent: 'poziva člana tima', TodoWrite: 'upisuje i štiklira plan', Read: 'čita fajl', Write: 'pravi fajl',
  Edit: 'menja fajl', Glob: 'traži fajlove', Grep: 'traži po fajlovima', WebSearch: 'traži na internetu',
  WebFetch: 'čita veb stranicu', Bash: 'pokreće komandu',
};

/** Le métier d'un agent, d'après le type d'agent que le chef a appelé. */
export function roleOfType(type: string): Role {
  for (const [role, info] of Object.entries(ROLES) as [Role, RoleInfo][]) if (info.type && info.type === type) return role;
  return 'renfort';
}

/** Les prénoms des robots, par métier (jamais deux fois le même dans une mission). */
export const NAMES: Record<Role, string[]> = {
  chef: ['Šef'],
  recherche: ['Marko', 'Ana', 'Luka', 'Jelena', 'Nikola', 'Mila', 'Stefan', 'Ivana'],
  code: ['Petar', 'Sara', 'Vuk', 'Teodora', 'Filip', 'Nina'],
  design: ['Mina', 'Lazar', 'Dunja', 'Pavle', 'Lena'],
  redaction: ['Jovan', 'Tamara', 'Uroš', 'Maja', 'Đorđe'],
  analyse: ['Milica', 'Bojan', 'Katarina', 'Dušan', 'Vesna'],
  sesti: ['Ognjen', 'Sofija', 'Relja', 'Hana', 'Andrej'],
  renfort: ['Žika', 'Mika', 'Laza', 'Pera', 'Kosta', 'Bata'],
};

const base = (p: unknown) => (typeof p === 'string' ? p.split(/[\\/]/).filter(Boolean).pop() ?? p : '');
export const cut = (s: unknown, n = 60) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
export const host = (u: unknown) => {
  try { return new URL(String(u)).hostname.replace(/^www\./, ''); } catch { return cut(u, 40); }
};

const MCP_NAMES: Record<string, string> = {
  gmail: 'Gmail', google_drive: 'Google Drive', notion: 'Notion', google_calendar: 'Google Kalendar', calendar: 'Google Kalendar',
  slack: 'Slack', github: 'GitHub', stripe: 'Stripe', hubspot: 'HubSpot', airtable: 'Airtable',
};

/** Le nom lisible d'un connecteur MCP : mcp__claude_ai_Gmail__search_threads → Gmail */
export function mcpName(tool: string): { server: string; action: string } {
  const parts = tool.split('__');
  const raw = (parts[1] ?? '').replace(/^claude_ai_/, '').replace(/^plugin_[^_]+_/, '');
  const server = MCP_NAMES[raw.toLowerCase()] ?? raw.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { server, action: (parts[2] ?? '').replace(/[_-]+/g, ' ') };
}

/** L'action, sa phrase (courte, pour la bulle) et le détail complet (pour le panneau). */
export function describeAct(tool: string, input: Record<string, unknown> | undefined): { kind: ActKind; label: string; detail: string } {
  const i = input ?? {};
  switch (tool) {
    case 'WebSearch': return { kind: 'search', label: `Tražim „${cut(i.query, 44)}”`, detail: String(i.query ?? '') };
    case 'WebFetch': return { kind: 'web', label: `Čitam ${host(i.url)}`, detail: String(i.url ?? '') };
    case 'Read': return { kind: 'read', label: `Čitam ${cut(base(i.file_path), 36)}`, detail: String(i.file_path ?? '') };
    case 'Glob': return { kind: 'read', label: 'Prekopavam folder', detail: String(i.pattern ?? '') };
    case 'Grep': return { kind: 'read', label: `Tražim „${cut(i.pattern, 30)}”`, detail: `${i.pattern ?? ''}${i.path ? ' u ' + i.path : ''}` };
    case 'LS': return { kind: 'read', label: 'Gledam folder', detail: String(i.path ?? '') };
    case 'Write': return { kind: 'write', label: `Pišem ${cut(base(i.file_path), 36)}`, detail: String(i.file_path ?? '') };
    case 'Edit':
    case 'MultiEdit': return { kind: 'edit', label: `Menjam ${cut(base(i.file_path), 34)}`, detail: String(i.file_path ?? '') };
    case 'NotebookEdit': return { kind: 'edit', label: `Menjam ${cut(base(i.notebook_path), 34)}`, detail: String(i.notebook_path ?? '') };
    case 'Bash': {
      const c = String(i.command ?? '').replace(/\s+/g, ' ').trim();
      return { kind: 'bash', label: `Pokrećem ${c.length <= 34 ? `„${c}”` : cut(i.description || c, 40)}`, detail: String(i.command ?? '') };
    }
    case 'TodoWrite': return { kind: 'plan', label: 'Ažuriram plan', detail: '' };
    case 'Skill': return { kind: 'skill', label: `Primenjujem metod ${cut(i.skill ?? i.name, 24)}`, detail: String(i.args ?? '') };
    case 'ToolSearch': return { kind: 'other', label: 'Tražim pravi alat', detail: String(i.query ?? '') };
  }
  if (tool.startsWith('mcp__')) {
    const { server, action } = mcpName(tool);
    return { kind: 'mcp', label: `Idem preko ${server}`, detail: action };
  }
  return { kind: 'other', label: `Koristim ${tool}`, detail: '' };
}

export const emptyStats = (): MissionStats => ({ agents: 0, searches: 0, pages: 0, reads: 0, writes: 0, commands: 0 });

/** Les compteurs de la mission (recherches, pages lues…), mis à jour événement par événement. */
export function countStats(s: MissionStats, ev: OfficeEvent) {
  if (ev.k === 'hire') s.agents++;
  if (ev.k !== 'act') return;
  if (ev.kind === 'search') s.searches++;
  else if (ev.kind === 'web') s.pages++;
  else if (ev.kind === 'read') s.reads++;
  else if (ev.kind === 'write' || ev.kind === 'edit') s.writes++;
  else if (ev.kind === 'bash') s.commands++;
}

/** Remplace le chemin du dossier de la mission par « . » partout où il apparaît en entier. */
export function relToFolder(text: string, folder: string): string {
  if (!folder) return text;
  const esc = folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(esc + '(?=$|[/"\'\\s])', 'g'), '.').replace(/(^|[\s"'])\.\//g, '$1');
}

/** La commande telle qu'elle sera lancée, juste rendue lisible (le dossier de la mission devient « . »). Rien n'est caché. */
export function readableCommand(cmd: unknown, folder: string): string {
  return relToFolder(String(cmd ?? ''), folder).trim().replace(/^cd\s+(?:"\."|'\.'|\.)\s*&&\s*/, '');
}

const FULL_MAX = 72;

/**
 * La demande de permission : la phrase de la bulle, le détail complet, et `full`
 * (vrai seulement si la bulle montre toute l'action : on peut alors répondre directement dans la bulle).
 */
export function permissionText(tool: string, input: Record<string, unknown> | undefined, folder: string): { label: string; detail: string; full: boolean } {
  const i = input ?? {};
  if (tool === 'Bash') {
    const c = readableCommand(i.command, folder);
    const full = c.length > 0 && c.length <= FULL_MAX && !c.includes('\n');
    return { label: `Mogu li da pokrenem „${full ? c : cut(c, 48)}”?`, detail: c, full };
  }
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const raw = String(i.file_path ?? i.notebook_path ?? '');
    const rel = relToFolder(raw, folder);
    const inside = !!folder && raw.startsWith(folder + '/') && !rel.includes('..');
    return { label: `Mogu li da ${tool === 'Write' ? 'upišem' : 'izmenim'} ${inside ? rel : raw}?`, detail: raw, full: inside && rel.length <= FULL_MAX };
  }
  if (tool === 'WebFetch') return { label: `Mogu li da pročitam ${host(i.url)}?`, detail: String(i.url ?? ''), full: false };
  const detail = relToFolder(JSON.stringify(i, null, 2), folder);
  const clipped = detail.length > 1500 ? detail.slice(0, 1499) + '…' : detail;
  if (tool.startsWith('mcp__')) {
    const { server, action } = mcpName(tool);
    return { label: `Mogu li da idem preko ${server} (${action})?`, detail: clipped, full: false };
  }
  return { label: `Mogu li da koristim ${tool}?`, detail: clipped, full: false };
}
