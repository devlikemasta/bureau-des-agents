// La barre du haut : le nom du bureau, la mission en cours et son chrono, les compteurs (agents,
// recherches, pages lues, rendus), l'énergie de ton abonnement, et les réglages d'affichage.
import { useEffect, useState } from 'react';
import { sfx } from '../audio/sfx.ts';
import { applySound } from '../audio/sound.ts';
import { replaySpeed, stopReplay } from '../net/link.ts';
import { savePref, useOffice, type Tod } from '../state/store.ts';
import { fmtClock } from './format.ts';
import { startTour } from './tour.ts';

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="logo" style={{ width: size, height: size }} aria-hidden="true">
      <span className="logo-visor"><i /><i /></span>
    </span>
  );
}

function useTick(on: boolean) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setN((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [on]);
}

const TOD_NEXT: Record<Tod, Tod> = { auto: 'day', day: 'evening', evening: 'night', night: 'auto' };
const TOD_ICON: Record<Tod, string> = { auto: '🕒', day: '☀️', evening: '🌇', night: '🌙' };
const TOD_LABEL: Record<Tod, string> = { auto: 'Sat tvog Maca', day: 'Dan', evening: 'Veče', night: 'Noć' };

export function TopBar() {
  const mission = useOffice((s) => s.mission);
  const busySince = useOffice((s) => s.busySince);
  const workMs = useOffice((s) => s.workMs);
  const stats = useOffice((s) => s.stats);
  const files = useOffice((s) => s.files.length);
  const plan = useOffice((s) => s.plan);
  const quota = useOffice((s) => s.quota);
  const replaying = useOffice((s) => s.replaying);
  const connection = useOffice((s) => s.connection);
  const final = useOffice((s) => s.final);
  const vertical = useOffice((s) => s.vertical);
  const filming = useOffice((s) => s.filming);
  const sound = useOffice((s) => s.sound);
  const tod = useOffice((s) => s.tod);
  const musicOn = useOffice((s) => s.music.playing);
  useTick(busySince !== null);
  const elapsed = workMs + (busySince ? Date.now() - busySince : 0);
  const done = plan.filter((p) => p.status === 'completed').length;
  const current = plan.find((p) => p.status === 'in_progress') ?? plan.find((p) => p.status === 'pending');

  const status = !mission ? null : busySince ? 'live' : final?.ok ? 'done' : mission.status === 'error' ? 'error' : 'stopped';
  const toggle = (k: 'vertical' | 'filming' | 'sound') => {
    sfx('click');
    const v = !useOffice.getState()[k];
    useOffice.setState({ [k]: v });
    if (k !== 'filming') savePref(k, v);
    if (k === 'sound') applySound(v);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <Logo />
        <div>
          <b>Kancelarija agenata</b>
          <span>{connection === 'demo' ? 'Demo · VibesMoney' : 'od VibesMoney'}</span>
        </div>
      </div>

      <div className="mission-head">
        {mission ? (
          <>
            <span className={`dot ${status}`} />
            <span className="mission-title" title={mission.prompt}>{mission.title}</span>
            <span className="timer">{fmtClock(elapsed)}</span>
          </>
        ) : <span className="muted">Nema aktivnog zadatka</span>}
        {mission && plan.length > 0 && (
          <span className="plan-step" title={current?.text ?? ''}>📋 {done}/{plan.length}{current && busySince ? ` · ${current.text}` : ''}</span>
        )}
      </div>

      {mission && (
        <div className="stats">
          <span title="Pozvani agenti">🤖 {stats.agents}</span>
          <span title="Pretrage na internetu">🔎 {stats.searches}</span>
          <span title="Pročitane veb stranice">🌐 {stats.pages}</span>
          <span title="Predati fajlovi">📄 {files}</span>
        </div>
      )}

      {replaying && (
        <div className="replay-bar">
          <span>Repriza</span>
          {[1, 2, 4].map((x) => <button key={x} onClick={() => replaySpeed(x)}>×{x}</button>)}
          {connection !== 'demo' && <button onClick={() => { sfx('click'); stopReplay(); }}>Izađi</button>}
        </div>
      )}

      <div className="tools">
        {quota && (
          <span className="energy" title={`Tvoja pretplata na 5 sati: iskorišćeno ${Math.round(quota.fiveHour * 100)} %`}>
            <span className="energy-label">Energija</span>
            <span className="energy-bar"><i style={{ width: `${Math.max(3, 100 - quota.fiveHour * 100)}%` }} /></span>
          </span>
        )}
        <button className="icon-btn" title="Obilazak: Max predstavlja svoju kancelariju (T)" onClick={() => void startTour()}>🎤</button>
        <button className="icon-btn" title="Ceo tim: poslovi, alati, istorija" onClick={() => { sfx('open'); useOffice.setState({ modal: { kind: 'team' } }); }}>👥</button>
        <button className={`icon-btn ${musicOn ? 'on' : ''}`} title="Džuboks (J)" onClick={() => { sfx('open'); useOffice.setState({ modal: { kind: 'jukebox' } }); }}>{musicOn ? '🎶' : '🎵'}</button>
        <button className="icon-btn" title="Prethodni zadaci (H)" onClick={() => { sfx('open'); useOffice.setState({ historyOpen: true }); }}>🗂️</button>
        <button className="icon-btn" title={`Doba dana u kancelariji: ${TOD_LABEL[tod]} (N)`} onClick={() => { sfx('click'); const n = TOD_NEXT[tod]; useOffice.setState({ tod: n }); savePref('tod', n); }}>{TOD_ICON[tod]}</button>
        <button className="icon-btn" title={sound ? 'Isključi zvuk (M)' : 'Uključi zvuk (M)'} onClick={() => toggle('sound')}>{sound ? '🔊' : '🔇'}</button>
        <button className={`icon-btn ${vertical ? 'on' : ''}`} title="Vertikalni kadar 9:16, za snimanje rilsa (V)" onClick={() => toggle('vertical')}>📱</button>
        <button className={`icon-btn ${filming ? 'on' : ''}`} title="Režim snimanja: samo kancelarija i Max (F)" onClick={() => toggle('filming')}>🎬</button>
        <button className="icon-btn" title="Podešavanja" onClick={() => { sfx('open'); useOffice.setState({ settingsOpen: true }); }}>⚙️</button>
      </div>
    </header>
  );
}
