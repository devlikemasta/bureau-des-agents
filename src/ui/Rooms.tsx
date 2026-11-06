// Les fenêtres qu'on ouvre en cliquant dans le bureau. Tout y vient de Claude Code, pour de vrai :
// la fiche d'un agent (sa mission, chacune de ses actions, son rapport), le plan de Max et son
// historique, l'équipe et ses outils, la machine, les rendus et l'aperçu des sites créés.
import { useEffect, useMemo, useState } from 'react';
import { ROLE_TOOLS, ROLES, TOOL_INFO } from '../../shared/activity.ts';
import type { PlanItem, Role } from '../../shared/protocol.ts';
import { jukebox, TRACKS } from '../audio/music.ts';
import { sfx } from '../audio/sfx.ts';
import { world } from '../engine/instance.ts';
import { savePref, teamList, useOffice, type ActView, type Tod } from '../state/store.ts';
import { useShallow } from 'zustand/react/shallow';
import { fileIcon, fmtClock, fmtDate, fmtDuration, fmtSize, plural, readable, tilde } from './format.ts';
import { party } from './interact.ts';
import { mdToHtml } from './md.ts';
import { Avatar } from './Panel.tsx';
import { tidy } from './tidy.ts';

const ICON: Record<string, string> = {
  search: '🔎', web: '🌐', read: '📖', write: '✍️', edit: '✏️', bash: '💻', plan: '📋', skill: '🎓', mcp: '🔌', other: '⚙️',
};

function Shell({ title, sub, wide, children, onClose }: { title: React.ReactNode; sub?: React.ReactNode; wide?: boolean; children: React.ReactNode; onClose?: () => void }) {
  const close = onClose ?? (() => useOffice.setState({ modal: null }));
  return (
    <div className="modal-back" onClick={close}>
      <div className={`modal room ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="room-title"><b>{title}</b>{sub && <span>{sub}</span>}</div>
          <button className="close" onClick={close} aria-label="Zatvori">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Les fenêtres du bureau (une seule ouverte à la fois). */
export function Rooms() {
  const modal = useOffice((s) => s.modal);
  if (!modal) return null;
  switch (modal.kind) {
    case 'agent': return <AgentRoom id={modal.id} />;
    case 'board': return <BoardRoom />;
    case 'clock': return <ClockRoom />;
    case 'machine': return <MachineRoom />;
    case 'jukebox': return <JukeboxRoom />;
    case 'team': return <TeamRoom role={modal.role} />;
    case 'files': return <FilesRoom />;
    case 'dnevnik': return <DnevnikRoom />;
    case 'napredak': return <NapredakRoom />;
    case 'preview': return <PreviewRoom missionId={modal.missionId} file={modal.file} />;
  }
}

// ── La fiche d'un agent ──
function AgentRoom({ id }: { id: string }) {
  const a = useOffice((s) => s.agents[id]);
  const live = world.actors.get(id);
  const html = useMemo(() => (a?.report ? mdToHtml(tidy(a.report)) : ''), [a?.report]);
  if (!a) return <Shell title="Ovaj agent više nije tu">Napustio je kancelariju.</Shell>;
  const role = ROLES[a.role];
  const working = a.status === 'working' || a.status === 'reporting';
  return (
    <Shell title={<>{a.name}</>} sub={`${role.icon} ${role.label} · ${a.task}`}>
      <div className="agent-hero" style={{ ['--c' as string]: role.color }}>
        <Avatar role={a.role} size={72} />
        <div>
          <span className={`pill-status ${a.status}`}>{working ? (live?.seated ? 'Radi' : 'Na putu') : a.status === 'done' ? 'Posao je predat' : 'Nije uspelo'}</span>
          <p className="now">{working && a.act ? <><i>{ICON[a.act.kind]}</i>{a.act.label}</> : a.status === 'done' ? 'Izveštaj je na Maxovom stolu.' : working ? 'Namešta se na svoje mesto…' : ''}</p>
          {a.model || a.tokens ? (
            <p className="small muted">Model: <b>{modelName(a.model)}</b>{a.tokens ? <> · tokeni: <b>{a.tokens.toLocaleString('sr-RS')}</b></> : null}{a.tools ? ` · alata: ${a.tools}` : ''}{a.leftAt ? ` · trajanje: ${fmtDuration(a.leftAt - a.hiredAt)}` : ''}</p>
          ) : null}
          {live?.failed && <button className="btn" onClick={() => { sfx('click'); world.dismiss(id); }}>Pusti ga da ode</button>}
          <p className="small muted">Pravi Claude Code pod-agent („{role.type || 'renfort'}”), sa sopstvenim alatima: {ROLE_TOOLS[a.role].join(', ') || 'Maxovi alati'}.</p>
        </div>
      </div>
      <section className="room-sec">
        <h4>Zadatak, koji je napisao Max</h4>
        <p className="brief">{tidy(a.prompt)}</p>
      </section>
      {a.acts.length > 0 && (
        <section className="room-sec">
          <h4>Šta je urađeno <span className="count">{plural(a.acts.length, 'radnja', 'radnji')}</span></h4>
          <ActList acts={a.acts} />
        </section>
      )}
      {html && (
        <section className="room-sec">
          <h4>Izveštaj</h4>
          <div className="md report" dangerouslySetInnerHTML={{ __html: html }} />
        </section>
      )}
      {a.leftAt && (
        <p className="small muted">{fmtDuration(a.leftAt - a.hiredAt)} rada{a.tools ? ` · ${plural(a.tools, 'korišćen alat', 'korišćenih alata')}` : ''}{a.tokens ? ` · ${a.tokens.toLocaleString('sr-RS')} tokena` : ''}</p>
      )}
    </Shell>
  );
}

/** claude-haiku-5-5 → Haiku 5.5 */
function modelName(m?: string) {
  if (!m) return '?';
  const x = m.match(/(haiku|sonnet|opus|fable)-(\d+)-(\d+)/i);
  return x ? `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}.${x[3]}` : m;
}

function ActList({ acts }: { acts: ActView[] }) {
  return (
    <ul className="act-list">
      {acts.slice(-40).map((x) => (
        <li key={x.id} className={x.ok === false ? 'fail' : ''}>
          <i>{ICON[x.kind]}</i>
          <div>
            <span>{x.label}</span>
            {x.detail && x.detail !== x.label && <code>{(() => { const d = tidy(x.detail); return d.length > 160 ? d.slice(0, 159) + '…' : d; })()}</code>}
          </div>
          <time>{new Date(x.at).toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
        </li>
      ))}
    </ul>
  );
}

// ── Le tableau : le plan, qui fait quoi, et l'historique du plan ──
function planChanges(prev: PlanItem[] | null, next: PlanItem[]): string[] {
  if (!prev) return [`Max piše plan: ${plural(next.length, 'korak', 'koraka')}`];
  const out: string[] = [];
  for (const it of next) {
    const before = prev.find((p) => p.text === it.text);
    if (!before) out.push(`+ ${it.text}`);
    else if (before.status !== it.status && it.status === 'completed') out.push(`✓ ${it.text}`);
    else if (before.status !== it.status && it.status === 'in_progress') out.push(`▶ ${it.text}`);
  }
  return out;
}

function BoardRoom() {
  const plan = useOffice((s) => s.plan);
  const history = useOffice((s) => s.planHistory);
  const team = useOffice(useShallow(teamList));
  const done = plan.filter((p) => p.status === 'completed').length;
  const steps = useMemo(() => history.map((h, i) => ({ at: h.at, lines: planChanges(i ? history[i - 1].items : null, h.items) })).filter((x) => x.lines.length), [history]);
  const posmatrac = useOffice((s) => !!s.mission?.posmatrac);
  if (posmatrac) return <Tabla plan={plan} done={done} team={team} />;
  return (
    <Shell title="Maxova tabla" sub={plan.length ? `${done} od ${plan.length} koraka urađeno` : 'Plan zadatka i ko šta radi'}>
      {plan.length > 0 ? (
        <>
          <div className="progress"><i style={{ width: `${(done / plan.length) * 100}%` }} /></div>
          <ul className="plan big">{plan.map((p, i) => <li key={i} className={p.status}><i />{p.text}</li>)}</ul>
        </>
      ) : <p className="muted">Još nema plana: Max ga piše čim zadatak ima više koraka.</p>}
      <section className="room-sec">
        <h4>Ko šta radi <span className="count">{plural(team.length, 'agent', 'agenata')}</span></h4>
        {team.length ? (
          <div className="who">
            {team.map((a) => (
              <button key={a.id} className={`who-row ${a.status}`} style={{ ['--c' as string]: ROLES[a.role].color }} onClick={() => { sfx('open'); useOffice.setState({ modal: { kind: 'agent', id: a.id } }); }}>
                <Avatar role={a.role} size={26} />
                <b>{a.name}</b>
                <span className="who-task">{a.task}</span>
                <span className="who-state">{a.status === 'done' ? '✓ izveštaj predat' : a.status === 'failed' ? '✕ nije završeno' : a.status === 'reporting' ? '📄 predaje izveštaj' : '… radi'}</span>
              </button>
            ))}
          </div>
        ) : <p className="muted small">Zasad niko.</p>}
      </section>
      {steps.length > 0 && (
        <section className="room-sec">
          <h4>Istorija plana</h4>
          <ol className="timeline">
            {steps.map((s, i) => (
              <li key={i}>
                <time>{new Date(s.at).toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                <div>{s.lines.map((l, j) => <span key={j}>{l}</span>)}</div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </Shell>
  );
}

// ── Tabla iza šefa (režim posmatrača): pišu i Claude i Stefan ──
function Tabla({ plan, done, team }: { plan: PlanItem[]; done: number; team: ReturnType<typeof teamList> }) {
  const send = useOffice((s) => s.send);
  const [tekst, setTekst] = useState('');
  const dodaj = () => {
    const t = tekst.trim();
    if (!t) return;
    sfx('send');
    send({ t: 'tabla_dodaj', tekst: t });
    setTekst('');
  };
  return (
    <Shell title="Tabla" sub={plan.length ? `${done} od ${plan.length} precrtano` : 'Plan posla: pišemo i ja i ti'}>
      {plan.length > 0 && <div className="progress"><i style={{ width: `${(done / plan.length) * 100}%` }} /></div>}
      <ul className="plan big tabla">
        {plan.map((p, i) => (
          <li key={p.id ?? i} className={p.status} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="tabla-kvacica" title={p.status === 'completed' ? 'Vrati' : 'Precrtaj'} aria-label={p.status === 'completed' ? 'Vrati stavku' : 'Precrtaj stavku'}
              onClick={() => { if (!p.id) return; sfx('check'); send({ t: 'tabla_precrtaj', id: p.id }); }}
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', display: 'flex' }}><i /></button>
            <span style={{ flex: 1, textDecoration: p.status === 'completed' ? 'line-through' : 'none' }}>{p.text}</span>
            <small className="muted" title={p.ko === 'stefan' ? 'Napisao Stefan' : 'Napisao Claude'}>{p.ko === 'stefan' ? 'ti' : 'Claude'}</small>
            {p.id && <button title="Obriši" aria-label="Obriši stavku" onClick={() => { sfx('click'); send({ t: 'tabla_obrisi', id: p.id! }); }}
              style={{ background: 'none', border: 0, cursor: 'pointer', color: 'inherit', opacity: 0.6, fontSize: 16 }}>×</button>}
          </li>
        ))}
      </ul>
      {!plan.length && <p className="muted">Tabla je prazna. Dodaj stavku, ili sačekaj da Claude upiše plan.</p>}
      <form onSubmit={(e) => { e.preventDefault(); dodaj(); }} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input value={tekst} onChange={(e) => setTekst(e.target.value)} maxLength={120} placeholder="Nova stavka za Claude-a…" aria-label="Nova stavka"
          style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(0,0,0,.25)', color: 'inherit', font: 'inherit' }} />
        <button className="btn" type="submit" disabled={!tekst.trim()}>Dodaj</button>
      </form>
      <p className="muted small" style={{ marginTop: 6 }}>Claude vidi tvoje izmene na tabli kad mu pošalješ sledeću poruku.</p>
      <section className="room-sec">
        <h4>Ko šta radi <span className="count">{team.length}</span></h4>
        {team.length ? (
          <div className="who">
            {team.map((a) => (
              <button key={a.id} className={`who-row ${a.status}`} style={{ ['--c' as string]: ROLES[a.role].color }} onClick={() => { sfx('open'); useOffice.setState({ modal: { kind: 'agent', id: a.id } }); }}>
                <Avatar role={a.role} size={26} />
                <b>{a.name}</b>
                <span className="who-task">{a.task}</span>
                <span className="who-state">{a.status === 'done' ? '✓ gotovo' : a.status === 'failed' ? '✕ nije završio' : a.status === 'reporting' ? '📄 predaje rezultat' : '… radi'}</span>
              </button>
            ))}
          </div>
        ) : <p className="muted small">Danas još niko.</p>}
      </section>
    </Shell>
  );
}

// ── Šefov sto: duge radnje (transkripcija, render…) i dokle su stigle; osvežava se na 2 s ──
function NapredakRoom() {
  const radnje = useOffice((s) => s.radnje);
  const send = useOffice((s) => s.send);
  useEffect(() => {
    send({ t: 'napredak' });
    const t = setInterval(() => send({ t: 'napredak' }), 2000);
    return () => clearInterval(t);
  }, [send]);
  const lista = radnje ?? [];
  const rade = lista.filter((r) => r.stanje === 'radi').length;
  return (
    <Shell title="Maxov sto" sub={radnje ? (rade ? `${rade} ${rade === 1 ? 'radnja traje' : 'radnje traju'}` : 'Nijedna duga radnja ne traje') : 'Učitavam…'}>
      {lista.length ? lista.map((r) => (
        <div key={r.id} className="room-sec" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <b>{r.stanje === 'gotovo' ? '✓ ' : r.stanje === 'greska' ? '✕ ' : '⏳ '}{r.naziv}</b>
            <span className="muted small">{r.ko} · {fmtDuration((r.stanje === 'radi' ? Date.now() : r.azurirano) - r.start)}</span>
          </div>
          {r.procenat !== undefined || r.stanje === 'radi' ? (
            <div className="progress" style={{ marginTop: 6 }}><i style={{ width: `${r.procenat ?? 4}%`, opacity: r.procenat === undefined ? 0.4 : 1, background: r.stanje === 'greska' ? '#e5484d' : undefined }} /></div>
          ) : null}
          <p className="small muted" style={{ marginTop: 4 }}>
            {r.procenat !== undefined ? <b>{r.procenat}% · </b> : null}
            {r.poruka || (r.stanje === 'radi' ? 'Čekam prvi ispis…' : '')}
            {r.tiho ? ' · (dugo bez novog ispisa)' : ''}
          </p>
        </div>
      )) : <p className="muted">Ovde se vide duge radnje: transkripcija, render, preuzimanje. Svaka pozadinska komanda se pojavi sama, a Max javlja napredak kad ga proveri.</p>}
    </Shell>
  );
}

// ── Dnevni log (polica): ko je danas radio, koliko dugo i koliko tokena ──
function DnevnikRoom() {
  const d = useOffice((s) => s.dnevnik);
  const redovi = d?.redovi ?? [];
  const ukupno = redovi.reduce((n, r) => n + r.tokeni, 0);
  const ms = redovi.reduce((n, r) => n + r.ms, 0);
  return (
    <Shell title="Danas u kancelariji" sub={d ? `${d.projekat} · ${redovi.length} agenata · ${ukupno.toLocaleString('sr-RS')} tokena · ${fmtDuration(ms)} rada` : 'Učitavam…'}>
      {redovi.length ? (
        <ul className="act-list">
          {[...redovi].reverse().map((r, i) => (
            <li key={i} className={r.ok ? '' : 'fail'}>
              <i>{r.ok ? '✓' : '✕'}</i>
              <div>
                <span><b>{r.ime}</b>{r.odeljenje ? ` · ${r.odeljenje}` : ''} · {r.zadatak}</span>
                <code>{modelName(r.model)} · {r.tokeni.toLocaleString('sr-RS')} tokena · {r.alati} alata · {fmtDuration(r.ms)}</code>
              </div>
              <time>{new Date(r.at).toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' })}</time>
            </li>
          ))}
        </ul>
      ) : <p className="muted">{d ? 'Danas još niko nije radio u ovoj kancelariji.' : '…'}</p>}
    </Shell>
  );
}

// ── L'horloge ──
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return now;
}

const TODS: [Tod, string][] = [['auto', 'Kao tvoj Mac'], ['day', '☀️ Dan'], ['evening', '🌇 Veče'], ['night', '🌙 Noć']];

function ClockRoom() {
  const now = useClock();
  const tod = useOffice((s) => s.tod);
  const busySince = useOffice((s) => s.busySince);
  const workMs = useOffice((s) => s.workMs);
  const mission = useOffice((s) => s.mission);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return (
    <Shell title="Sat u kancelariji" sub={now.toLocaleDateString('sr-RS', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}>
      <div className="big-clock"><span>{hh}</span><i>:</i><span>{mm}</span><small>{ss}</small></div>
      {mission && (busySince
        ? <p className="center">Zadatak traje već <b>{fmtClock(workMs + (now.getTime() - busySince))}</b> · {mission.title}</p>
        : <p className="center">Poslednji zadatak: <b>{fmtClock(workMs)}</b> rada · {mission.title}</p>)}
      <p className="center muted small">Tvoj tim nikad ne spava: radi u 3 ujutru kao i u podne.</p>
      <div className="seg">
        {TODS.map(([v, l]) => (
          <button key={v} className={tod === v ? 'on' : ''} onClick={() => { sfx('click'); useOffice.setState({ tod: v }); savePref('tod', v); }}>{l}</button>
        ))}
      </div>
    </Shell>
  );
}

// ── La machine (le serveur) : Claude Code, le modèle, l'abonnement ──
function MachineRoom() {
  const claude = useOffice((s) => s.claude);
  const settings = useOffice((s) => s.settings);
  const mission = useOffice((s) => s.mission);
  const quota = useOffice((s) => s.quota);
  const dir = useOffice((s) => s.dir);
  const connection = useOffice((s) => s.connection);
  const rows: [string, React.ReactNode][] = [
    ['Claude Code', claude?.found ? `${claude.version} · ${claude.path}` : connection === 'demo' ? 'Demo (repriza pravog zadatka)' : 'nije pronađen'],
    ['Veza', 'tvoja Claude pretplata (bez API ključa, bez naplate po potrošnji)'],
    ['Mozak Maxa', mission?.model ? `${mission.model} (podešavanje: ${settings.chefModel || 'podrazumevano'})` : settings.chefModel || 'podrazumevano'],
    ['Mozak tima', settings.teamModel === 'inherit' ? 'isti kao Max' : settings.teamModel],
    ['Dozvole', settings.permission === 'auto' ? 'automatske: agent se javlja za rizične korake' : 'traže se pre svake komande'],
    ['Energija (5 h)', quota ? `iskorišćeno ${Math.round(quota.fiveHour * 100)} %${quota.resetsAt ? `, puni se u ${new Date(quota.resetsAt * 1000).toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' })}` : ''}` : 'još nije izmerena'],
    ['Folder kancelarije', dir ? tilde(dir) : '-'],
    ['Aktivni zadatak', mission ? tilde(mission.folder) : 'nema'],
  ];
  return (
    <Shell title="Mašina" sub="Šta radi iza kancelarije">
      <dl className="kv">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <section className="room-sec">
        <h4>Kako ovo radi</h4>
        <p className="small">Max je prava Claude Code sesija, pokrenuta bez prozora u folderu zadatka. Njegov tim su pravi Claude Code pod-agenti, svaki sa svojim uputstvima i samo alatima svog posla. Svaki put kad agent upotrebi alat (pretragu, pročitanu stranicu, napisan fajl), Claude Code to javi kancelariji, koja to odmah prikaže: robot koji kuca, oblačić, izveštaj na šefovom stolu.</p>
        <p className="small muted">Ograničen režim: tim nikad ne izlazi iz foldera zadatka, a ni tvoja podešavanja ni tvoji drugi agenti ne ulaze u kancelariju.</p>
      </section>
    </Shell>
  );
}

// ── Le jukebox ──
function JukeboxRoom() {
  const music = useOffice((s) => s.music);
  const tr = TRACKS[music.index];
  return (
    <Shell title="Džuboks" sub="Haus muzika za rad (ili za žurku posle posla)">
      <div className="now-playing">
        <div className={`vinyl ${music.playing ? 'spin' : ''}`}><i /></div>
        <div>
          <b>{tr.title}</b>
          <span>{tr.mood}</span>
          <div className="row">
            <button className="btn small" onClick={() => jukebox.prev()} aria-label="Prethodna pesma">⏮</button>
            <button className="btn primary small" onClick={() => jukebox.toggle()}>{music.playing ? '⏸ Pauza' : '▶ Pusti'}</button>
            <button className="btn small" onClick={() => jukebox.next()} aria-label="Sledeća pesma">⏭</button>
          </div>
        </div>
      </div>
      <label className="field volume">
        <span>Jačina zvuka</span>
        <input type="range" min={0} max={1} step={0.01} value={music.volume} onChange={(e) => jukebox.setVolume(Number(e.target.value))} />
      </label>
      <ul className="tracks">
        {TRACKS.map((t, i) => (
          <li key={t.id}>
            <button className={i === music.index ? 'on' : ''} onClick={() => jukebox.play(i)}>
              <span>{i === music.index && music.playing ? '♪' : i + 1}</span>
              <b>{t.title}</b>
              <em>{t.mood}</em>
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <button className="btn" onClick={() => { useOffice.setState({ modal: null }); party(); }}>🪩 Žurka</button>
        <span className="small muted">Originalne pesme, napravljene za kancelariju uz ElevenLabs Music i Google Lyria.</span>
      </div>
    </Shell>
  );
}

// ── Toute l'équipe : les métiers et leurs outils, la mission en cours, l'historique ──
function TeamRoom({ role }: { role?: Role }) {
  const [tab, setTab] = useState<'roles' | 'now' | 'history'>(role ? 'roles' : 'now');
  const team = useOffice(useShallow(teamList));
  const settings = useOffice((s) => s.settings);
  const history = useOffice((s) => s.teamHistory);
  const send = useOffice((s) => s.send);
  const connection = useOffice((s) => s.connection);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (tab === 'history' && connection === 'live') send({ t: 'team_history' }); }, [tab, connection, send]);
  const working = (r: Role) => [...world.actors.values()].filter((a) => a.role === r && a.seated).length;
  const roles: Role[] = ['chef', 'recherche', 'code', 'design', 'redaction', 'analyse'];
  const missions = useMemo(() => {
    const m = new Map<string, { title: string; at: number; entries: NonNullable<typeof history> }>();
    for (const e of history ?? []) {
      if (!m.has(e.missionId)) m.set(e.missionId, { title: e.missionTitle, at: e.at, entries: [] });
      m.get(e.missionId)!.entries.push(e);
    }
    return [...m.entries()];
  }, [history]);
  return (
    <Shell title="Ceo tim" sub="Pravi Claude Code agenti, svaki sa svojim poslom i alatima" wide>
      <div className="seg tabs">
        <button className={tab === 'now' ? 'on' : ''} onClick={() => setTab('now')}>Ovaj zadatak</button>
        <button className={tab === 'roles' ? 'on' : ''} onClick={() => setTab('roles')}>Poslovi</button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>Istorija</button>
      </div>
      {tab === 'now' && (team.length ? (
        <div className="who">
          {team.map((a) => (
            <button key={a.id} className={`who-row ${a.status}`} style={{ ['--c' as string]: ROLES[a.role].color }} onClick={() => { sfx('open'); useOffice.setState({ modal: { kind: 'agent', id: a.id } }); }}>
              <Avatar role={a.role} size={26} />
              <b>{a.name}</b>
              <span className="who-task">{ROLES[a.role].icon} {a.task}</span>
              <span className="who-state">{a.status === 'done' ? '✓ izveštaj predat' : a.status === 'failed' ? '✕ nije završeno' : a.act ? a.act.label : '… radi'}</span>
            </button>
          ))}
        </div>
      ) : <p className="muted">Trenutno niko nije u kancelariji. Kad se zada zadatak, Max će pozvati prave agente.</p>)}
      {tab === 'roles' && (
        <div className="roles">
          {roles.map((r) => (
            <div key={r} className={`role-card ${role === r ? 'focus' : ''}`} style={{ ['--c' as string]: ROLES[r].color }}>
              <div className="role-head"><Avatar role={r} size={34} /><div><b>{ROLES[r].icon} {ROLES[r].label}</b><span>{r === 'chef' ? 'Max' : `agent „${ROLES[r].type}”`} · mozak: {r === 'chef' ? settings.chefModel || 'podrazumevano' : settings.teamModel === 'inherit' ? 'kao Max' : settings.teamModel}</span></div>{working(r) > 0 && <em>{working(r)} radi</em>}</div>
              <p>{ROLES[r].what}</p>
              <div className="tools">{ROLE_TOOLS[r].map((t) => <span key={t} title={TOOL_INFO[t] ?? t}>{t}<small>{TOOL_INFO[t] ?? ''}</small></span>)}</div>
            </div>
          ))}
        </div>
      )}
      {tab === 'history' && (
        connection !== 'live' ? <p className="muted">Istorija živi na tvom računaru: pokreni kancelariju uz Claude Code da je vidiš.</p>
          : !history ? <p className="muted">Učitavam…</p>
            : !missions.length ? <p className="muted">Još nema istorije.</p>
              : (
                <div className="hist-team">
                  {missions.map(([id, m]) => (
                    <section key={id}>
                      <h4>{m.title} <span className="count">{fmtDate(m.at)}</span></h4>
                      {m.entries.map((e) => (
                        <div key={e.id} className={`hist-row ${e.status}`} style={{ ['--c' as string]: ROLES[e.role].color }}>
                          <button onClick={() => setOpen(open === e.id ? null : e.id)}>
                            <Avatar role={e.role} size={22} />
                            <b>{e.name}</b>
                            <span>{ROLES[e.role].label} · {e.task}</span>
                            <em>{e.status === 'done' ? '✓' : e.status === 'failed' ? '✕' : '…'} {e.ms ? fmtDuration(e.ms) : ''}</em>
                          </button>
                          {open === e.id && e.report && <div className="md small" dangerouslySetInnerHTML={{ __html: mdToHtml(tidy(e.report)) }} />}
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              )
      )}
    </Shell>
  );
}

// ── L'imprimante : les rendus de la mission ──
function FilesRoom() {
  const files = useOffice((s) => s.files);
  const mission = useOffice((s) => s.mission);
  const send = useOffice((s) => s.send);
  const replaying = useOffice((s) => s.replaying);
  if (!mission || !files.length) {
    return <Shell title="Predati fajlovi" sub="Štampač kancelarije"><p className="muted">Još ništa nije odštampano: fajlovi tima stizaće ovde.</p></Shell>;
  }
  return (
    <Shell title="Predati fajlovi" sub={`${plural(files.length, 'fajl', 'fajlova')} · ${mission.title}`}>
      <FileActions files={files} missionId={mission.id} disabled={replaying} send={send} />
    </Shell>
  );
}

export function FileActions({ files, missionId, disabled, send }: { files: ReturnType<typeof useOffice.getState>['files']; missionId: string; disabled: boolean; send: ReturnType<typeof useOffice.getState>['send'] }) {
  const agents = useOffice((s) => s.agents);
  return (
    <div className="files">
      {files.map((f) => (
        <div key={f.path} className="file">
          <span className="file-icon">{fileIcon(f.ext)}</span>
          <div className="file-id">
            <b title={f.path}>{f.name}</b>
            <span className="small muted">{fmtSize(f.size)} · od {f.by === 'chef' ? 'Max' : agents[f.by]?.name ?? 'tim'}</span>
          </div>
          {!disabled && (f.ext === 'html' || f.ext === 'htm') && (
            <button className="btn small primary" onClick={() => { sfx('open'); useOffice.setState({ modal: { kind: 'preview', missionId, file: f.path } }); }}>Pogledaj sajt</button>
          )}
          {!disabled && readable(f.ext) && (
            <button className="btn small" onClick={() => { sfx('open'); useOffice.setState({ modal: null, viewer: { missionId, file: f.path } }); send({ t: 'read', missionId, file: f.path }); send({ t: 'versions', missionId, file: f.path }); }}>Čitaj</button>
          )}
          {!disabled && <button className="btn small ghost" onClick={() => send({ t: 'open', missionId, file: f.path })}>Otvori</button>}
        </div>
      ))}
    </div>
  );
}

// ── L'aperçu d'un site fait par l'équipe, dans un écran (bac à sable : il ne peut rien toucher) ──
function PreviewRoom({ missionId, file }: { missionId: string; file: string }) {
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');
  const [nonce, setNonce] = useState(0);
  const send = useOffice((s) => s.send);
  const src = `/apercu/${encodeURIComponent(missionId)}/${file.split('/').map(encodeURIComponent).join('/')}`;
  const close = () => useOffice.setState({ modal: null });
  return (
    <div className="modal-back" onClick={close}>
      <div className="monitor" onClick={(e) => e.stopPropagation()}>
        <div className="monitor-bar">
          <span className="dots"><i /><i /><i /></span>
          <span className="addr">🔒 {file}</span>
          <div className="seg small">
            <button className={device === 'desktop' ? 'on' : ''} onClick={() => setDevice('desktop')}>💻 Računar</button>
            <button className={device === 'phone' ? 'on' : ''} onClick={() => setDevice('phone')}>📱 Telefon</button>
          </div>
          <button className="btn small" onClick={() => setNonce((n) => n + 1)} title="Osveži">↻</button>
          <button className="btn small" title="Kod stranice i njene uzastopne verzije" onClick={() => { useOffice.setState({ modal: null, viewer: { missionId, file } }); send({ t: 'read', missionId, file }); send({ t: 'versions', missionId, file }); }}>&lt;/&gt; Kod i verzije</button>
          <button className="btn small" onClick={() => send({ t: 'open', missionId, file })}>Otvori u pregledaču</button>
          <button className="close" onClick={close} aria-label="Zatvori">×</button>
        </div>
        <div className={`monitor-screen ${device}`}>
          <iframe key={nonce} title={file} src={src} sandbox="allow-scripts allow-forms allow-popups allow-modals" referrerPolicy="no-referrer" />
        </div>
      </div>
    </div>
  );
}
