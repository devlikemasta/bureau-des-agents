// Les fenêtres par-dessus le bureau : la carte du rendu final, la lecture d'un fichier,
// les missions précédentes, les réglages, et les petites notifications.
import { useMemo } from 'react';
import { sfx } from '../audio/sfx.ts';
import { savePref, useOffice } from '../state/store.ts';
import { applySound } from '../audio/sound.ts';
import { FileList } from './Panel.tsx';
import { fmtDate, fmtDuration, plural, tilde } from './format.ts';
import { mdToHtml } from './md.ts';
import { tidy } from './tidy.ts';

/** La mission est rendue : Max te présente le travail de l'équipe. */
export function FinalCard() {
  const show = useOffice((s) => s.showFinal);
  const final = useOffice((s) => s.final);
  const mission = useOffice((s) => s.mission);
  const stats = useOffice((s) => s.stats);
  const workMs = useOffice((s) => s.workMs);
  const files = useOffice((s) => s.files.length);
  const send = useOffice((s) => s.send);
  const replaying = useOffice((s) => s.replaying);
  const html = useMemo(() => (final?.text ? mdToHtml(tidy(final.text)) : ''), [final?.text]);
  if (!show || !final || !mission) return null;
  const close = () => useOffice.setState({ showFinal: false });
  return (
    <div className="final" role="dialog" aria-label="Rezultat zadatka">
      <button className="close" onClick={close} aria-label="Zatvori">×</button>
      <div className="final-head">
        <span className="final-badge"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
        <div>
          <b>Zadatak je završen</b>
          <span>{mission.title} · {fmtDuration(workMs)}</span>
        </div>
      </div>
      <div className="final-stats">
        <span>🤖 {plural(stats.agents, 'agent', 'agenata')}</span>
        <span>🔎 {plural(stats.searches, 'pretraga', 'pretraga')}</span>
        <span>🌐 {plural(stats.pages, 'pročitana stranica', 'pročitanih stranica')}</span>
        <span>📄 {plural(files, 'fajl', 'fajlova')}</span>
      </div>
      {html && <div className="md final-text" dangerouslySetInnerHTML={{ __html: html }} />}
      {files > 0 && <FileList />}
      {!replaying && (
        <div className="final-actions">
          <button className="btn" onClick={() => send({ t: 'open', missionId: mission.id })}>Otvori folder</button>
          <button className="btn" onClick={() => { close(); useOffice.setState({ draft: ' ' }); }}>Traži izmenu</button>
          <button className="btn primary" onClick={() => { sfx('click'); close(); send({ t: 'new' }); }}>Novi zadatak</button>
        </div>
      )}
    </div>
  );
}

/** Lire un rendu (rapport, tableau…) sans quitter le bureau. */
export function Viewer() {
  const viewer = useOffice((s) => s.viewer);
  const send = useOffice((s) => s.send);
  const agents = useOffice((s) => s.agents);
  const versions = useOffice((s) => (s.viewer ? s.versions[`${s.viewer.missionId}|${s.viewer.file}`] : undefined));
  const html = useMemo(() => {
    if (!viewer?.text) return '';
    const ext = viewer.file.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'md' || ext === 'markdown') return mdToHtml(viewer.text);
    if (['html', 'htm', 'css', 'js', 'ts', 'py', 'json', 'svg'].includes(ext)) return '';
    if (ext === 'csv') {
      const sep = viewer.text.includes(';') && !viewer.text.split('\n')[0].includes(',') ? ';' : ',';
      const rows = viewer.text.trim().split('\n').slice(0, 200).map((r) => r.split(sep));
      const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!).replace(/^"|"$/g, '');
      return `<table>${rows.map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('')}</table>`;
    }
    return '';
  }, [viewer]);
  if (!viewer) return null;
  const close = () => useOffice.setState({ viewer: null });
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal viewer" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>{viewer.file}</b>
          <div className="row">
            {versions && versions.length > 1 && (
              <select
                className="versions"
                title="Istorija verzija ovog fajla"
                value={viewer.version ?? ''}
                onChange={(e) => {
                  const v = e.target.value || undefined;
                  useOffice.setState({ viewer: { ...viewer, text: undefined, version: v } });
                  send({ t: 'read', missionId: viewer.missionId, file: viewer.file, version: v });
                }}
              >
                <option value="">Trenutna verzija</option>
                {versions.slice(1).map((v, i) => (
                  <option key={v.id} value={v.id}>
                    v{versions.length - 1 - i} · {new Date(v.at).toLocaleString('sr-RS', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })} · {v.by === 'chef' ? 'Max' : agents[v.by]?.name ?? 'tim'}
                  </option>
                ))}
              </select>
            )}
            <button className="btn small" onClick={() => send({ t: 'open', missionId: viewer.missionId, file: viewer.file })}>Otvori u aplikaciji</button>
            <button className="close" onClick={close} aria-label="Zatvori">×</button>
          </div>
        </div>
        <div className="modal-body">
          {viewer.text === undefined ? <p className="muted">Otvaram…</p>
            : html ? <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
              : <pre className="plain">{viewer.text}</pre>}
          {viewer.truncated && <p className="small muted">(Dug fajl: prikazan je samo početak.)</p>}
        </div>
      </div>
    </div>
  );
}

/** Les missions précédentes : on peut les rejouer (pour filmer) ou ouvrir leur dossier. */
export function History() {
  const open = useOffice((s) => s.historyOpen);
  const missions = useOffice((s) => s.missions);
  const send = useOffice((s) => s.send);
  const connection = useOffice((s) => s.connection);
  if (!open) return null;
  const close = () => useOffice.setState({ historyOpen: false });
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal history" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><b>Prethodni zadaci</b><button className="close" onClick={close} aria-label="Zatvori">×</button></div>
        <div className="modal-body">
          {connection !== 'live' && <p className="muted">Poveži kancelariju sa Claude Code-om (npm start) da bi video svoje zadatke.</p>}
          {connection === 'live' && !missions.length && <p className="muted">Još nema zadataka. Prvi te čeka na dnu ekrana.</p>}
          {missions.map((m) => (
            <div key={m.id} className="hist">
              <div className="hist-id">
                <b>{m.title}</b>
                <span className="small muted">
                  {fmtDate(m.createdAt)} · {fmtDuration(m.workMs)} · {plural(m.stats.agents, 'agent', 'agenata')} · {plural(m.files.length, 'fajl', 'fajlova')}
                  {m.status === 'working' ? ' · u toku' : m.status === 'done' ? '' : m.status === 'stopped' ? ' · zaustavljen' : ' · greška'}
                </span>
              </div>
              <div className="row">
                <button className="btn small" title="Ponovo prikaži zadatak (bez ponovnog pokretanja tima): idealno za snimanje" onClick={() => { sfx('click'); close(); send({ t: 'replay', missionId: m.id }); }}>▶ Ponovi</button>
                <button className="btn small ghost" onClick={() => send({ t: 'open', missionId: m.id })}>Folder</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const CHEF_MODELS: [string, string][] = [['sonnet', 'Sonnet (brz, preporučeno)'], ['opus', 'Opus (najpreciznij)'], ['fable', 'Fable'], ['haiku', 'Haiku (munjevit)'], ['', 'Podrazumevani model Claude Code-a']];
const TEAM_MODELS: [string, string][] = [['sonnet', 'Sonnet (brz, preporučeno)'], ['haiku', 'Haiku (munjevit, štedljiv)'], ['opus', 'Opus (najpreciznij)'], ['fable', 'Fable'], ['inherit', 'Isti kao Max']];

export function SettingsPanel() {
  const open = useOffice((s) => s.settingsOpen);
  const settings = useOffice((s) => s.settings);
  const send = useOffice((s) => s.send);
  const claude = useOffice((s) => s.claude);
  const dir = useOffice((s) => s.dir);
  const voiceOn = useOffice((s) => s.voiceOn);
  const cameraAuto = useOffice((s) => s.cameraAuto);
  if (!open) return null;
  const close = () => useOffice.setState({ settingsOpen: false });
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><b>Podešavanja kancelarije</b><button className="close" onClick={close} aria-label="Zatvori">×</button></div>
        <div className="modal-body">
          <label className="field">
            <span>Mozak Maxa (šefa)</span>
            <select value={settings.chefModel} onChange={(e) => send({ t: 'settings', settings: { chefModel: e.target.value } })}>
              {CHEF_MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Mozak tima</span>
            <select value={settings.teamModel} onChange={(e) => send({ t: 'settings', settings: { teamModel: e.target.value } })}>
              {TEAM_MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <div className="field">
            <span>Dozvole</span>
            <label className="radio"><input type="radio" checked={settings.permission === 'auto'} onChange={() => send({ t: 'settings', settings: { permission: 'auto' } })} /> Tim odlučuje sam, a javlja se za rizične korake</label>
            <label className="radio"><input type="radio" checked={settings.permission === 'ask'} onChange={() => send({ t: 'settings', settings: { permission: 'ask' } })} /> Pita pre svake komande</label>
          </div>
          <div className="field">
            <span>Predstava</span>
            <label className="radio"><input type="checkbox" checked={voiceOn} onChange={(e) => { useOffice.setState({ voiceOn: e.target.checked }); savePref('voice', e.target.checked); applySound(useOffice.getState().sound); }} /> Maxov glas („Kreni!”, „Zadatak je završen!”, obilazak)</label>
            <label className="radio"><input type="checkbox" checked={cameraAuto} onChange={(e) => { useOffice.setState({ cameraAuto: e.target.checked }); savePref('cameraAuto', e.target.checked); }} /> U režimu snimanja kamera sama prati akciju</label>
          </div>
          <p className="small muted">Podešavanja važe za sledeći zadatak. Tim radi samo u folderu zadatka i nikad ne pokreće ništa van kancelarije bez tvog pitanja.</p>
          {claude?.found && <p className="small muted">Claude Code {claude.version} · {tilde(dir)}</p>}
          <div className="keys">
            <b>Prečice</b>
            <span><kbd>V</kbd> vertikalni kadar (rils)</span>
            <span><kbd>F</kbd> režim snimanja</span>
            <span><kbd>C</kbd> auto kamera</span>
            <span><kbd>T</kbd> obilazak</span>
            <span><kbd>J</kbd> džuboks</span>
            <span><kbd>N</kbd> dan, veče, noć</span>
            <span><kbd>M</kbd> zvuk</span>
            <span><kbd>H</kbd> prethodni zadaci</span>
            <span><kbd>Esc</kbd> zatvori, izađi iz snimanja</span>
            <span>🥚 Postoji tajni kod… (seti se starih video igara)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useOffice((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
    </div>
  );
}
