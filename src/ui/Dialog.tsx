// En bas de l'écran, comme dans un jeu de rôle : Max te parle (son texte s'écrit lettre par lettre),
// et tu lui réponds : au clavier ou à la voix. C'est le seul endroit où taper : une demande, et l'équipe s'y met.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ROLES } from '../../shared/activity.ts';
import { sfx } from '../audio/sfx.ts';
import { world } from '../engine/instance.ts';
import { robotSprite } from '../engine/robots.ts';
import { useOffice } from '../state/store.ts';
import { tidy } from './tidy.ts';
import { dictationHelp, useDictation } from './voice.ts';

export const EXAMPLES: { label: string; prompt: string }[] = [
  {
    label: '🔎 Analiziraj konkurenciju',
    prompt: 'Analiziraj mojih 5 glavnih konkurenata: za svakog ponudu, cene i šta o njemu kažu kupci. Pusti po jednog istraživača na svakog konkurenta, pa mi vrati uporednu tabelu i 3 konkretne ideje kako da se izdvojim.',
  },
  {
    label: '📰 Moj AI pregled',
    prompt: 'Napravi moj AI pregled nedelje: 5 novosti koje su bitne za preduzetnika (alati, najave, primene), uz svaku jednu rečenicu o tome šta mi to menja i link do izvora.',
  },
  {
    label: '🌐 Moja prodajna stranica',
    prompt: 'Napravi prodajnu stranicu za moju ponudu: moderna veb stranica u jednom fajlu, sa jakim naslovom, prednostima, odeljkom za utiske kupaca koji ću dopuniti i dugmetom za poziv na akciju. Neka je pregleda neko iz pisanja.',
  },
  {
    label: '✍️ 3 LinkedIn objave',
    prompt: 'Napiši mi 3 LinkedIn objave o mom poslu, svaku sa drugačijim uvodom, i pripremi HTML vizual sa citatom za najbolju od tri.',
  },
];

const stripMd = (s: string) =>
  tidy(s).replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]+/g, '').replace(/^\s*[-•]\s+/gm, '• ').replace(/\n{2,}/g, '\n').trim();

/** Le texte de Max, qui s'écrit lettre par lettre, avec un petit « bip » (comme dans les vieux jeux). */
function useTypewriter(text: string, cps = 55) {
  const [n, setN] = useState(0);
  const shown = useRef('');
  useEffect(() => {
    // si le nouveau texte prolonge celui qui s'affiche, on continue ; sinon on recommence
    if (!text.startsWith(shown.current)) setN(0);
  }, [text]);
  useEffect(() => {
    if (n >= text.length) return;
    const t = setTimeout(() => {
      const step = text.length - n > 260 ? 8 : 2;
      setN((x) => Math.min(text.length, x + step));
      if (n % 6 === 0) sfx('blip', 0.85 + Math.random() * 0.3);
    }, (1000 / cps) * 2);
    return () => clearTimeout(t);
  }, [n, text, cps]);
  const out = text.slice(0, Math.min(n, text.length));
  shown.current = out;
  return { out, done: n >= text.length };
}

/** Le visage de Max, en grand, qui cligne des yeux (et sourit quand c'est fini). */
function Portrait({ happy }: { happy: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = ref.current!.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    let blink = 0;
    const draw = () => {
      const chef = world.chef;
      const eyes = happy ? 'happy' : blink > 0 ? 'blink' : chef.eyes === 'blink' ? 'open' : chef.eyes === 'happy' ? 'happy' : chef.eyes;
      g.clearRect(0, 0, 64, 64);
      g.drawImage(robotSprite('chef', 'stand', 'down', 0, eyes), 2, 0, 16, 16, 0, 0, 64, 64);
      if (blink > 0) blink--;
      else if (Math.random() < 0.02) blink = 2;
    };
    draw();
    const t = setInterval(draw, 120);
    return () => clearInterval(t);
  }, [happy]);
  return <canvas ref={ref} width={64} height={64} className="portrait" />;
}

export function Dialog() {
  const connection = useOffice((s) => s.connection);
  const claude = useOffice((s) => s.claude);
  const mission = useOffice((s) => s.mission);
  const busy = useOffice((s) => s.busySince !== null);
  const replaying = useOffice((s) => s.replaying);
  const chef = useOffice((s) => s.chef);
  const final = useOffice((s) => s.final);
  const tour = useOffice((s) => s.tour);

  let text: string;
  if (tour) text = tour.text;
  else if (connection === 'offline') text = 'Nisam povezan sa Claude Code-om. Pokreni „npm start” u folderu kancelarije i počinjemo sa radom.';
  else if (claude && !claude.found) text = 'Ne mogu da nađem Claude Code na ovom računaru. Instaliraj ga (claude.com/claude-code), prijavi se, pa ponovo pokreni kancelariju.';
  else if (!mission) text = 'Ćao! Ja sam Max, šef kancelarije. Reci mi šta ti treba: sklopiću tim i radićemo pred tvojim očima.';
  else if (chef.typing) text = stripMd(chef.typing);
  else if (final && !busy) text = stripMd(final.text) || (final.ok ? 'Gotovo je!' : 'Zadatak je zaustavljen.');
  else if (chef.say) text = stripMd(chef.say);
  else text = busy ? 'Čitam tvoj zahtev…' : '';

  const { out } = useTypewriter(text);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [out]);

  return (
    <footer className="dialog">
      <div className="dialog-box">
        <div className="dialog-face"><Portrait happy={!!final?.ok && !busy} /></div>
        <div className="dialog-main">
          <div className="dialog-name">Max <span>šef projekta</span>{replaying && <em className="pill replay">Repriza</em>}</div>
          <div className="dialog-text" ref={box}>{out}<span className="caret" /></div>
        </div>
      </div>
      <Composer />
    </footer>
  );
}

export function AskBar() {
  const asks = useOffice(useShallow((s) => Object.values(s.asks)));
  const agents = useOffice((s) => s.agents);
  const send = useOffice((s) => s.send);
  const a = asks[0];
  if (!a) return null;
  const who = a.who === 'chef' ? 'Max' : agents[a.who]?.name ?? 'Jedan agent';
  const role = a.who === 'chef' ? 'chef' : agents[a.who]?.role ?? 'renfort';
  const answer = (allow: boolean) => { sfx(allow ? 'yes' : 'no'); send({ t: 'answer', requestId: a.requestId, allow }); };
  return (
    <div className="askbar">
      <div className="askbar-head">🙋 <b style={{ color: ROLES[role].color }}>{who}</b> traži tvoju dozvolu{asks.length > 1 ? ` (i još ${asks.length - 1})` : ''}</div>
      <div className="askbar-label">{a.label}</div>
      {!a.full && a.detail && <pre className="askbar-detail">{a.detail}</pre>}
      <div className="askbar-actions">
        <button className="btn primary" onClick={() => answer(true)}>Dozvoli</button>
        <button className="btn" onClick={() => answer(false)}>Odbij</button>
      </div>
    </div>
  );
}

function Composer() {
  const mission = useOffice((s) => s.mission);
  const busy = useOffice((s) => s.busySince !== null);
  const replaying = useOffice((s) => s.replaying);
  const send = useOffice((s) => s.send);
  const draft = useOffice((s) => s.draft);
  const demo = useOffice((s) => s.connection === 'demo');
  const [text, setText] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);
  textRef.current = text;

  // un exemple choisi ailleurs (ou « demander une retouche ») remplit la zone de texte
  useEffect(() => {
    if (!draft) return;
    setText(draft === ' ' ? '' : draft);
    useOffice.setState({ draft: '' });
    setTimeout(() => area.current?.focus(), 30);
  }, [draft]);

  const getBase = useCallback(() => textRef.current, []);
  const dict = useDictation(getBase, setText);

  const mode: 'new' | 'steer' | 'retouch' = !mission ? 'new' : busy ? 'steer' : 'retouch';
  const placeholder = mode === 'new'
    ? 'Reci Maxu šta hoćeš… (na primer: analiziraj mojih 5 konkurenata)'
    : mode === 'steer' ? 'Imaš dopunu za Maxa? Pročitaće je između dva koraka.' : 'Traži od Maxa izmenu… ili pokreni novi zadatak.';

  const submit = () => {
    const t = text.trim();
    if (!t || replaying) return;
    if (dict.listening) dict.stop();
    sfx('send');
    if (mode === 'new') send({ t: 'start', prompt: t });
    else send({ t: 'say', text: t });
    setText('');
  };

  // režim posmatrača: šef je naša Claude Code sesija, ovde se ništa ne zadaje
  if (mission?.posmatrac) {
    return <div className="composer" style={{ padding: '10px 14px', opacity: 0.8, fontSize: 13 }}>👀 Šef radi iz Claude Code chata. Kancelarija samo prikazuje agente.</div>;
  }

  return (
    <div className="composer">
      <div className={`composer-row ${dict.listening ? 'listening' : ''}`}>
        <textarea
          ref={area}
          value={text}
          rows={2}
          placeholder={demo ? 'Ovo je demo: prava verzija radi na tvom računaru, uz Claude Code.' : replaying ? 'Repriza u toku…' : placeholder}
          disabled={replaying}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          }}
        />
        <button
          className={`mic ${dict.listening ? 'on' : ''}`}
          title={dict.listening ? 'Zaustavi diktiranje' : 'Diktiraj'}
          aria-label="Diktiraj"
          disabled={replaying}
          onClick={() => (dict.listening ? dict.stop() : dict.start())}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" /></svg>
        </button>
        {busy && !replaying ? (
          <>
            {text.trim() && <button className="btn primary send" onClick={submit}>Pošalji</button>}
            <button className="btn stop" onClick={() => { sfx('click'); send({ t: 'stop' }); }}>■ Zaustavi</button>
          </>
        ) : (
          <button className="btn primary send" disabled={!text.trim() || replaying} onClick={submit}>
            {mode === 'new' ? 'Kreni' : 'Pošalji'} <span aria-hidden="true">➜</span>
          </button>
        )}
        {mode === 'retouch' && !replaying && (
          <button className="btn ghost" title="Odloži ovaj zadatak i kreni ispočetka" onClick={() => { sfx('click'); send({ t: 'new' }); }}>＋ Novi zadatak</button>
        )}
      </div>
      {dict.problem && (
        <div className="hint" onClick={dict.clearProblem}>🎙️ {dictationHelp(dict.problem)}</div>
      )}
    </div>
  );
}
