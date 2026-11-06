// Le panneau de droite : le plan de Max, l'équipe au travail (ce que chacun fait, son rapport),
// les rendus (les fichiers produits) et le fil de ce qui se passe. Sans mission : comment ça marche.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ROLES } from '../../shared/activity.ts';
import type { Role } from '../../shared/protocol.ts';
import { sfx } from '../audio/sfx.ts';
import { robotSprite } from '../engine/robots.ts';
import { teamList, useOffice, type AgentView } from '../state/store.ts';
import { EXAMPLES } from './Dialog.tsx';
import { fmtDate, fmtDuration, tilde } from './format.ts';
import { mdToHtml } from './md.ts';
import { FileActions } from './Rooms.tsx';
import { tidy } from './tidy.ts';

export function Avatar({ role, size = 32 }: { role: Role; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = ref.current!.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 20, 24);
    g.drawImage(robotSprite(role, 'stand', 'down', 0, 'open'), 0, 0);
  }, [role]);
  return <canvas ref={ref} width={20} height={24} className="avatar" style={{ width: size * (20 / 24), height: size }} />;
}

const STATUS: Record<AgentView['status'], string> = { working: 'Radi', reporting: 'Predaje izveštaj', done: 'Posao je predat', failed: 'Nije uspelo' };

export function Panel() {
  const mission = useOffice((s) => s.mission);
  return (
    <aside className="panel">
      {mission ? (
        <>
          <PlanSection />
          <TeamSection />
          <FilesSection />
          <FeedSection />
        </>
      ) : <Welcome />}
    </aside>
  );
}

function Welcome() {
  const missions = useOffice((s) => s.missions);
  const dir = useOffice((s) => s.dir);
  const send = useOffice((s) => s.send);
  const connection = useOffice((s) => s.connection);
  return (
    <>
      <section className="card">
        <h3>Kako ovo radi</h3>
        <ol className="steps">
          <li><b>Kažeš Maxu šta hoćeš</b>, tastaturom ili glasom.</li>
          <li><b>On pravi plan i zove tim</b>: svako ide na svoje mesto (istraživanje, kod, dizajn, pisanje, analiza).</li>
          <li><b>Gledaš ih kako rade</b>, uživo: svaki oblačić pokazuje šta agent upravo radi.</li>
          <li><b>Predaju ti posao</b>: fajlovi stižu u „Predate fajlove” i u tvoj folder.</li>
        </ol>
        <p className="small muted">Ovo su pravi Claude Code agenti, koji rade preko tvoje pretplate.</p>
      </section>
      <section className="card">
        <h3>Ideje za zadatke</h3>
        <div className="chips col">
          {EXAMPLES.map((e) => <button key={e.label} className="chip" onClick={() => { sfx('click'); useOffice.setState({ draft: e.prompt }); }}>{e.label}</button>)}
        </div>
      </section>
      {connection === 'live' && (
        <section className="card">
          <h3>Tvoja kancelarija</h3>
          <p className="small muted path">{tilde(dir)}</p>
          <div className="row">
            <button className="btn small" onClick={() => send({ t: 'open_root' })}>Otvori folder</button>
            <button className="btn small" onClick={() => send({ t: 'open_root', rules: true })}>Pravila kancelarije</button>
          </div>
          <p className="small muted">Pravila su ono što tim treba da zna o tebi: Max ih čita pre svakog zadatka.</p>
        </section>
      )}
      {missions.length > 0 && (
        <section className="card">
          <h3>Poslednji zadaci</h3>
          {missions.slice(0, 4).map((m) => (
            <div key={m.id} className="mini-mission">
              <div><b>{m.title}</b><span className="small muted">{fmtDate(m.createdAt)} · {fmtDuration(m.workMs)} · {m.files.length} {m.files.length === 1 ? 'fajl' : 'fajlova'}</span></div>
              <div className="row">
                <button className="btn small" onClick={() => { sfx('click'); send({ t: 'replay', missionId: m.id }); }}>Ponovi</button>
                <button className="btn small ghost" onClick={() => send({ t: 'open', missionId: m.id })}>Folder</button>
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function PlanSection() {
  const plan = useOffice((s) => s.plan);
  if (!plan.length) return null;
  const done = plan.filter((p) => p.status === 'completed').length;
  return (
    <section className="card">
      <h3>Plan <span className="count">{done}/{plan.length}</span></h3>
      <ul className="plan">
        {plan.map((p, i) => <li key={i} className={p.status}><i />{p.text}</li>)}
      </ul>
    </section>
  );
}

function TeamSection() {
  const team = useOffice(useShallow(teamList));
  const [open, setOpen] = useState<string | null>(null);
  if (!team.length) {
    return (
      <section className="card">
        <h3>Tim</h3>
        <p className="small muted">Max čita tvoj zahtev i bira koga da pozove…</p>
      </section>
    );
  }
  const active = team.filter((a) => a.status === 'working' || a.status === 'reporting').length;
  return (
    <section className="card">
      <h3>Tim <span className="count">{active ? `${active} radi` : `ukupno ${team.length}`}</span></h3>
      <div className="team">
        {team.map((a) => <AgentCard key={a.id} a={a} open={open === a.id} onToggle={() => { sfx('open'); setOpen(null); useOffice.setState({ modal: { kind: 'agent', id: a.id } }); }} />)}
      </div>
    </section>
  );
}

function AgentCard({ a, open, onToggle }: { a: AgentView; open: boolean; onToggle: () => void }) {
  const role = ROLES[a.role];
  const working = a.status === 'working' || a.status === 'reporting';
  const report = useMemo(() => (open && a.report ? mdToHtml(a.report) : ''), [open, a.report]);
  return (
    <div className={`agent ${a.status} ${open ? 'open' : ''}`} style={{ ['--c' as string]: role.color }}>
      <button className="agent-head" onClick={onToggle}>
        <Avatar role={a.role} size={30} />
        <div className="agent-id">
          <b>{a.name} <span>{role.icon} {role.label}</span></b>
          <span className="agent-task">{a.task}</span>
          <span className="agent-now">{working ? (a.act?.label ?? 'Namešta se za svoj sto…') : `${STATUS[a.status]}${a.leftAt ? ` · ${fmtDuration(a.leftAt - a.hiredAt)}` : ''}`}</span>
        </div>
        <span className={`agent-status ${a.status}`} />
      </button>
      {open && (
        <div className="agent-more">
          <h4>Zadatak (napisao Max)</h4>
          <p className="brief">{a.prompt}</p>
          {a.acts.length > 0 && (
            <>
              <h4>Šta je urađeno</h4>
              <ul className="acts">
                {a.acts.slice(-14).map((x) => <li key={x.id} title={x.detail}>{x.ok === false ? '⚠️ ' : ''}{x.label}</li>)}
              </ul>
            </>
          )}
          {report && (
            <>
              <h4>Izveštaj</h4>
              <div className="md" dangerouslySetInnerHTML={{ __html: report }} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function FileList() {
  const files = useOffice((s) => s.files);
  const mission = useOffice((s) => s.mission);
  const send = useOffice((s) => s.send);
  const replaying = useOffice((s) => s.replaying);
  if (!mission) return null;
  return <FileActions files={files} missionId={mission.id} disabled={replaying} send={send} />;
}

function FilesSection() {
  const files = useOffice((s) => s.files.length);
  const mission = useOffice((s) => s.mission);
  const send = useOffice((s) => s.send);
  const replaying = useOffice((s) => s.replaying);
  return (
    <section className="card">
      <h3>Predati fajlovi <span className="count">{files}</span></h3>
      {files ? <FileList /> : <p className="small muted">Fajlovi tima stizaće ovde (i u folder zadatka).</p>}
      {mission && !replaying && <button className="btn small ghost" onClick={() => send({ t: 'open', missionId: mission.id })}>Otvori folder zadatka</button>}
    </section>
  );
}

function FeedSection() {
  const feed = useOffice((s) => s.feed);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [feed.length]);
  return (
    <section className="card">
      <h3>Uživo</h3>
      <div className="feed" ref={box}>
        {feed.slice(-60).map((l) => (
          <div key={l.id} className={`feed-line ${l.kind}`}>
            <span className="feed-time">{new Date(l.at).toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <b>{l.who}</b> {tidy(l.kind === 'chef' || l.kind === 'user' ? l.text.slice(0, 220) : l.text)}
          </div>
        ))}
      </div>
    </section>
  );
}
