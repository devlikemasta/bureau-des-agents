// Le bureau à l'écran : la petite image en pixel art, agrandie sans flou, et par-dessus, en texte net,
// les bulles des robots (ce qu'ils font vraiment, en direct) et leurs demandes de permission.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ROLES } from '../../shared/activity.ts';
import type { ActKind } from '../../shared/protocol.ts';
import { camera, director, renderer, timeOfDay, world } from '../engine/instance.ts';
import { hitAt, type Hit } from '../engine/hits.ts';
import { jukebox } from '../audio/music.ts';
import { interact } from './interact.ts';
import { H, W } from '../engine/layout.ts';
import { sfx } from '../audio/sfx.ts';
import { useOffice, type AskView } from '../state/store.ts';
import { bus } from '../state/bus.ts';

const ICON: Record<ActKind, string> = {
  search: '🔎', web: '🌐', read: '📖', write: '✍️', edit: '✏️', bash: '💻', plan: '📋', skill: '🎓', mcp: '🔌', other: '⚙️',
};

/** Combien coûte le dessin (pour vérifier que le bureau ne fait pas chauffer l'ordinateur). */
export const perf = { frames: 0, ms: 0 };

/** Les bulles accrochées aux robots : on les déplace à chaque image, sans repasser par React. */
const bubbleEls = new Map<string, HTMLElement>();

function placeBubbles(scale: number) {
  const stageW = W * scale;
  for (const [id, el] of bubbleEls) {
    const a = world.actors.get(id);
    if (!a) continue;
    const seated = a.seated && !!a.seat;
    const x = Math.round(a.x * scale);
    const y = Math.round(((seated ? a.seat!.y : a.y) - (seated ? 19 : 22)) * scale);
    // au même rang de bureaux, une bulle sur deux monte un peu plus haut (elles se chevauchent moins)
    const lift = seated && Math.round(a.seat!.x / 32) % 2 === 0 ? 1 : 0;
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    el.style.opacity = a.alpha.toFixed(2);
    el.dataset.lift = String(lift);
    // une bulle au bord du bureau rentre dans le cadre (sa pointe reste sur le robot)
    const b = el.firstElementChild as HTMLElement | null;
    let dx = 0;
    if (b) {
      const half = b.offsetWidth / 2;
      if (x - half < 4) dx = 4 - (x - half);
      else if (x + half > stageW - 4) dx = stageW - 4 - (x + half);
    }
    el.style.setProperty('--dx', `${Math.round(dx)}px`);
  }
}

export function Office() {
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(2);
  const tod = useOffice((s) => s.tod);
  const vertical = useOffice((s) => s.vertical || s.portrait);
  const todRef = useRef(tod);
  todRef.current = tod;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  // La taille : la plus grande qui tient (en vertical, toute la largeur du cadre).
  useLayoutEffect(() => {
    const el = wrap.current!;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const w = r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const f = vertical ? w / W : Math.min(w / W, h / H);
      setScale(Math.max(0.5, Math.floor(f * 16) / 16));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [vertical]);

  // La boucle d'animation : 24 images par seconde quand ça bouge, 8 au repos, rien quand l'onglet est caché.
  // Le bureau est dessiné en tout petit (352 × 256) : des pixels nets à n'importe quelle taille.
  useEffect(() => {
    const vis = canvas.current!;
    const vg = vis.getContext('2d')!;
    const low = document.createElement('canvas');
    low.width = W;
    low.height = H;
    const lg = low.getContext('2d')!;
    lg.imageSmoothingEnabled = false;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let active = true;
    let lastCss = '';
    // Le dessin est agrandi d'un nombre entier de fois (pixels nets), puis le navigateur l'ajuste à la
    // taille exacte en le lissant très légèrement : une seule opération par image.
    const present = () => {
      const dpr = window.devicePixelRatio || 1;
      const k = Math.max(1, Math.ceil(scaleRef.current * dpr - 0.001));
      if (vis.width !== W * k || vis.height !== H * k) { vis.width = W * k; vis.height = H * k; }
      vg.imageSmoothingEnabled = false;
      vg.drawImage(low, 0, 0, W * k, H * k);
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = (now - last) / 1000;
      last = now;
      if (document.hidden) return;
      acc += dt;
      const st = useOffice.getState();
      // la caméra : le réalisateur filme tout seul en mode tournage (sauf pendant la visite guidée)
      director.enabled = st.filming && st.cameraAuto && !st.tour;
      director.tick();
      const camMoving = camera.update(dt);
      // pour filmer le bureau image par image (scripts de capture) : chaque image est dessinée, et le rythme
      // de la musique vient du film, pas du jukebox
      const cap = (window as unknown as { __CAPTURE?: { music?: () => { on: boolean; level: number; beat: boolean } } }).__CAPTURE;
      const m = cap?.music?.();
      const level = m ? m.level : jukebox.sample();
      world.setMusic(m ? m.on : jukebox.playing, level, m ? m.beat : jukebox.beat);
      if (!cap && acc < (active || camMoving ? 1 / 24 : 1 / 8)) return;
      const t0 = performance.now();
      active = world.update(acc);
      acc = 0;
      renderer.draw(lg, world, timeOfDay(todRef.current), new Date());
      present();
      const { transform, zoomed } = camera.css(scaleRef.current);
      if (stage.current && transform !== lastCss) {
        stage.current.style.transform = transform;
        vis.style.imageRendering = zoomed ? 'pixelated' : 'auto';
        // en gros plan, le cadre coupe ce qui dépasse ; en plan large, les bulles peuvent déborder
        const frame = stage.current.parentElement;
        if (frame) frame.dataset.zoomed = zoomed ? '1' : '0';
        lastCss = transform;
      }
      placeBubbles(scaleRef.current);
      perf.frames++;
      perf.ms += performance.now() - t0;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // La souris : ce qu'il y a dessous (infobulle), un clic pour interagir, la molette pour zoomer.
  const toWorld = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const hover = useRef<Hit | null>(null);
  const onMove = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.bubble.ask')) return;
    const p = toWorld(e);
    const h = hitAt(world, p.x, p.y);
    hover.current = h;
    const el = tip.current;
    if (!el || !wrap.current) return;
    if (!h || useOffice.getState().filming) { el.style.opacity = '0'; wrap.current.style.cursor = ''; return; }
    const r = wrap.current.getBoundingClientRect();
    el.textContent = h.label;
    el.style.opacity = '1';
    el.style.transform = `translate(${Math.round(e.clientX - r.left + 14)}px, ${Math.round(e.clientY - r.top + 16)}px)`;
    wrap.current.style.cursor = 'pointer';
  };
  const onLeave = () => { if (tip.current) tip.current.style.opacity = '0'; hover.current = null; };
  const onClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.bubble.ask')) return;
    const p = toWorld(e);
    const h = hitAt(world, p.x, p.y);
    if (h) interact(h);
  };
  const onWheel = (e: React.WheelEvent) => {
    const p = toWorld(e);
    const z = Math.max(1, Math.min(2.6, camera.tzoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    if (z <= 1.01) camera.wide(6);
    else camera.shot(p.x, p.y, z, 8);
  };

  return (
    <div className="office" ref={wrap} onPointerMove={onMove} onPointerLeave={onLeave} onClick={onClick} onWheel={onWheel} onDoubleClick={() => camera.wide(4)}>
      <div className="office-frame" style={{ width: W * scale, height: H * scale }}>
        <div className="office-stage" ref={stage} style={{ width: W * scale, height: H * scale, ['--s' as string]: scale }}>
          <canvas ref={canvas} className="office-canvas" style={{ width: W * scale, height: H * scale }} />
          <Bubbles />
        </div>
        <LiveBadge />
      </div>
      <div className="office-tip" ref={tip} />
    </div>
  );
}

/** En mode tournage : « EN DIRECT » et le chrono, comme à la télé. */
function LiveBadge() {
  const filming = useOffice((s) => s.filming);
  const busy = useOffice((s) => s.busySince !== null);
  const replaying = useOffice((s) => s.replaying);
  if (!filming || !busy) return null;
  return <div className="live-badge"><i />{replaying ? 'REPRIZA' : 'UŽIVO'}</div>;
}

function subscribeRoster(cb: () => void) {
  const off = world.onRoster(cb);
  return () => { off(); };
}

interface View {
  mode: 'ask' | 'full' | 'icon' | 'tag' | 'none';
  name: string;
  color: string;
  text?: string;
  icon?: string;
  ask?: AskView;
}

/** Une bulle plus courte : sans guillemets, le sujet après deux-points. */
const short = (label: string) => label.replace(/\s„\s?(.+?)\s?”/, ' : $1');

function Bubbles() {
  const version = useSyncExternalStore(subscribeRoster, () => world.rosterVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ids = useMemo(() => [...world.actors.keys()], [version]);
  const now = useNow(400);
  const agents = useOffice((s) => s.agents);
  const chef = useOffice((s) => s.chef);
  const asks = useOffice((s) => s.asks);
  const busy = useOffice((s) => s.busySince !== null);
  const order = useOffice((s) => s.order);
  const filming = useOffice((s) => s.filming);
  const vertical = useOffice((s) => s.vertical || s.portrait);

  // Seules les actions les plus fraîches ont une bulle complète (les autres, une simple icône),
  // et jamais deux bulles qui se chevauchent : on les choisit de la plus récente à la plus ancienne.
  const fresh = new Set<string>();
  {
    const boxes: { x: number; y: number; w: number }[] = [];
    const chefActor = world.actors.get('chef');
    if (chefActor) boxes.push({ x: chefActor.x, y: (chefActor.seated && chefActor.seat ? chefActor.seat.y : chefActor.y) - 20, w: 86 });
    const cands = ids.filter((id) => id !== 'chef' && world.actors.get(id)?.seated)
      .map((id) => ({ id, at: agents[id]?.act?.at ?? 0, label: agents[id]?.act?.label ?? '' }))
      .filter((x) => now - x.at < 2800)
      .sort((a, b) => b.at - a.at);
    for (const c of cands) {
      if (fresh.size >= (vertical ? 2 : 3)) break;
      const a = world.actors.get(c.id)!;
      const lift = Math.round(a.seat!.x / 32) % 2 === 0 ? 12 : 0;
      const box = { x: a.seat!.x, y: a.seat!.y - 20 - lift, w: Math.min(80, short(c.label).length * 3.1 + 14) };
      if (boxes.some((b) => Math.abs(b.x - box.x) < (b.w + box.w) / 2 + 2 && Math.abs(b.y - box.y) < 24)) continue;
      boxes.push(box);
      fresh.add(c.id);
    }
  }
  const askOf = (id: string) => Object.values(asks).find((a) => a.who === id);

  const view = (id: string): View => {
    const actor = world.actors.get(id);
    const isChef = id === 'chef';
    const a = isChef ? null : agents[id];
    const role = isChef ? 'chef' : a?.role ?? actor?.role ?? 'renfort';
    const base = { name: isChef ? 'Max' : a?.name ?? actor?.name ?? '', color: ROLES[role].color };
    // l'équipe de démonstration de la visite guidée : juste les prénoms
    if (!isChef && !a && actor) return { ...base, mode: filming ? 'none' : 'tag' };
    const ask = askOf(id);
    if (ask) return { ...base, mode: 'ask', ask };
    if (isChef) {
      const working = order.filter((k) => agents[k]?.status === 'working' || agents[k]?.status === 'reporting').length;
      if (chef.typing) return { ...base, mode: 'full', text: lastSentence(chef.typing, 70) };
      if (chef.say && now - chef.sayAt < 6000) return { ...base, mode: 'full', text: firstSentence(chef.say, 70) };
      if (chef.act && now - chef.act.at < 5000) return { ...base, mode: 'full', text: short(chef.act.label), icon: ICON[chef.act.kind] };
      if (busy && working > 0) return { ...base, mode: 'full', text: `Čekam tim: ${order.length - working} od ${order.length} izveštaja`, icon: '⏳' };
      if (busy) return { ...base, mode: 'full', text: '…' };
      return { ...base, mode: filming ? 'none' : 'tag' };
    }
    if (!a || !actor) return { ...base, mode: 'none' };
    // režim posmatrača: za stolom uvek piše zadatak; po završetku „Gotovo”, a greška ostaje crvena
    if (bus.posmatrac && actor.seated && !actor.moving) {
      if (actor.failed) return { ...base, color: '#e5484d', mode: 'full', text: 'Greška · klikni me', icon: '✕' };
      if (a.status === 'done') return { ...base, color: '#2fbf71', mode: 'full', text: 'Gotovo', icon: '✓' };
      const act = a.act && now - a.act.at < 7000 ? a.act : null;
      return { ...base, mode: 'full', text: short(a.task), icon: act ? ICON[act.kind] : '💼' };
    }
    // en marche : juste son nom (avec sa feuille s'il apporte son rapport)
    if (actor.moving || !actor.seated) return { ...base, mode: 'tag', icon: actor.carrying ? '📄' : undefined };
    if (a.act && now - a.act.at < 7000) {
      return fresh.has(id) ? { ...base, mode: 'full', text: short(a.act.label), icon: ICON[a.act.kind] } : { ...base, mode: 'icon', icon: ICON[a.act.kind] };
    }
    return { ...base, mode: filming ? 'none' : 'tag' };
  };

  return <>{ids.map((id) => <Bubble key={id} id={id} v={view(id)} />)}</>;
}

function useNow(every: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

const lastSentence = (s: string, n = 96) => {
  const t = s.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(-n);
  const i = cut.search(/[.!?…]\s/);
  return '…' + (i >= 0 && i < n - 20 ? cut.slice(i + 2) : cut.slice(cut.indexOf(' ') + 1));
};
const firstSentence = (s: string, n = 96) => {
  const t = s.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.{12,}?[.!?…])(\s|$)/);
  const one = m ? m[1] : t;
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
};

function Bubble({ id, v }: { id: string; v: View }) {
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (el) bubbleEls.set(id, el);
    else bubbleEls.delete(id);
  }, [id]);
  return (
    <div className={`bubble-anchor ${id === 'chef' ? 'is-chef' : ''}`} ref={ref} style={{ ['--c' as string]: v.color }}>
      {v.mode === 'ask' && v.ask ? <AskBubble ask={v.ask} name={v.name} />
        : v.mode === 'full' ? (
          <div className="bubble">
            <span className="bubble-name">{v.name}</span>
            <span className="bubble-text">{v.icon && <i>{v.icon}</i>}{v.text}</span>
          </div>
        ) : v.mode === 'icon' ? <div className="bubble-icon" title={v.name}>{v.icon}</div>
          : v.mode === 'tag' ? <div className="tag">{v.icon ? `${v.icon} ` : ''}{v.name}</div> : null}
    </div>
  );
}

function AskBubble({ ask, name }: { ask: AskView; name: string }) {
  const send = useOffice((s) => s.send);
  const answer = (allow: boolean) => {
    sfx(allow ? 'yes' : 'no');
    send({ t: 'answer', requestId: ask.requestId, allow });
  };
  return (
    <div className="bubble ask">
      <span className="bubble-name">🙋 {name}</span>
      <span className="bubble-text">{short(ask.label)}</span>
      {ask.full ? (
        <span className="ask-actions">
          <button className="yes" onClick={() => answer(true)}>Da</button>
          <button className="no" onClick={() => answer(false)}>Ne</button>
        </span>
      ) : <span className="ask-more">Detalji na dnu ekrana ↓</span>}
    </div>
  );
}
