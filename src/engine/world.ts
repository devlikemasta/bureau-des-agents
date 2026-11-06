// Le monde du bureau : les robots, ce qu'ils font, où ils vont. Chaque événement venu de Claude Code
// devient une petite mise en scène : un membre de l'équipe arrive par la porte, va à son bureau, tape
// ou lit selon ce qu'il fait vraiment, se lève pour rendre son rapport au chef, puis repart.
import type { ActKind, OfficeEvent, PlanItem, Role } from '../../shared/protocol.ts';
import { Cat } from './cat.ts';
import { Fx } from './fx.ts';
import { iconFor } from './icons.ts';
import { CHEF_SEAT, SEATS, SPOTS, T, WINDOWS, tileFeet, walkGrid, type Seat } from './layout.ts';
import { bus } from '../state/bus.ts';
import { findPath, type Tile } from './path.ts';
import type { Dir, Eyes, Pose } from './robots.ts';

type Pt = { x: number; y: number };

type Task =
  | { t: 'walk'; tile: Tile; face?: Dir; then?: Pt }
  | { t: 'slide'; to: Pt; face?: Dir; speed?: number }
  | { t: 'sit'; seat: Seat }
  | { t: 'stand' }
  | { t: 'wait'; ms: number; pose?: Pose; dir?: Dir; eyes?: Eyes }
  | { t: 'call'; fn: () => void }
  | { t: 'fade'; to: number; ms: number };

const WALK_SPEED = 58; // pixels par seconde

export class Actor {
  id: string;
  role: Role;
  name: string;
  x: number;
  y: number;
  dir: Dir = 'down';
  pose: Pose = 'stand';
  frame = 0;
  eyes: Eyes = 'open';
  seat: Seat | null = null;
  seated = false;
  standSpot: Tile | null = null;
  tasks: Task[] = [];
  cur: Task | null = null;
  curT = 0;
  path: Pt[] = [];
  moving = false;
  alpha = 1;
  act: ActKind | null = null;
  actAt = -99;
  thinkAt = -99;
  carrying = false;
  asks = 0;
  cheerUntil = 0;
  happyUntil = 0;
  sadUntil = 0;
  reported = false;
  delivered = false;
  left = false;
  /** režim posmatrača: agent se vratio sa greškom i čeka klik */
  failed = false;
  gone = false;
  animT = 0;
  nextBlink = 1 + Math.random() * 3;
  blinkUntil = 0;
  nextLook = 2 + Math.random() * 3;
  look: Eyes = 'open';
  lookUntil = 0;
  deliverSpot = -1;

  constructor(id: string, role: Role, name: string, x: number, y: number) {
    this.id = id;
    this.role = role;
    this.name = name;
    this.x = x;
    this.y = y;
  }

  get tile(): Tile {
    if (this.seated && this.seat) return this.seat.tile;
    return [Math.max(0, Math.floor(this.x / T)), Math.max(0, Math.min(15, Math.floor((this.y - 2) / T)))];
  }

  /** Le haut de la tête (pour accrocher les bulles). */
  get head(): Pt { return { x: this.x, y: this.y - 22 }; }

  get busy() { return !!this.cur || this.tasks.length > 0; }
}

export class World {
  actors = new Map<string, Actor>();
  fx = new Fx();
  grid = walkGrid();
  private seatOf = new Map<string, string>();
  private deliverTaken = new Set<number>();
  time = 0;
  speed = 1;
  /** les rapports posés sur le bureau du chef */
  inbox = 0;
  printUntil = 0;
  boardUntil = 0;
  missionActive = false;
  plan: PlanItem[] = [];
  /** qui fait quoi : écrit au tableau, coché quand l'agent a rendu son travail */
  assignments: { id: string; role: Role; name: string; task: string; status: 'working' | 'done' | 'failed' }[] = [];
  private planSize = -1;
  // ── la vie du bureau (et ses œufs de Pâques) ──
  cat = new Cat();
  /** la couleur du néon (clique dessus pour en changer) */
  neonIndex = 0;
  /** les meubles qui frémissent (plantes…) : identifiant → jusqu'à quand */
  wiggles = new Map<string, number>();
  /** les lampes éteintes */
  lampsOff = new Set<string>();
  /** le mode soirée (boule à facettes, tout le monde danse) */
  discoUntil = 0;
  /** la musique du jukebox : est-ce qu'elle joue, et l'énergie des basses (0 à 1) */
  musicOn = false;
  musicLevel = 0;
  bobUntil = 0;
  private noteAt = 0;
  private steamAt = 0;
  private waveAt = 6;
  rosterVersion = 0;
  private rosterListeners = new Set<() => void>();

  constructor() {
    this.resetAll();
  }

  get chef() { return this.actors.get('chef')!; }

  onRoster(fn: () => void) { this.rosterListeners.add(fn); return () => this.rosterListeners.delete(fn); }
  private rosterChanged() {
    this.rosterVersion++;
    for (const fn of this.rosterListeners) fn();
  }

  /** Le bureau vide, Max à l'accueil (début, nouvelle mission, rediffusion). */
  resetAll() {
    this.actors.clear();
    this.seatOf.clear();
    this.deliverTaken.clear();
    this.fx = new Fx();
    this.inbox = 0;
    this.printUntil = 0;
    this.boardUntil = 0;
    this.missionActive = false;
    this.plan = [];
    this.assignments = [];
    this.planSize = -1;
    const p = SPOTS.receptionPx;
    this.actors.set('chef', new Actor('chef', 'chef', 'Max', p.x, p.y));
    this.rosterChanged();
  }

  // ── Les tâches ──
  private queue(a: Actor, ...tasks: Task[]) { a.tasks.push(...tasks); }

  private startTask(a: Actor, task: Task) {
    a.curT = 0;
    switch (task.t) {
      case 'walk': {
        if (a.seated) { a.seated = false; this.standUp(a); }
        const tiles = findPath(this.grid, a.tile, task.tile);
        a.path = (tiles ?? [task.tile]).map(tileFeet);
        if (task.then) a.path.push(task.then);
        break;
      }
      case 'slide':
        a.path = [task.to];
        break;
      case 'sit':
        a.path = [{ x: task.seat.x, y: task.seat.y }];
        break;
      case 'stand':
        if (a.seated) { a.seated = false; this.standUp(a); }
        break;
    }
  }

  private standUp(a: Actor) {
    if (!a.seat) return;
    const f = tileFeet(a.seat.tile);
    a.x = f.x + (a.seat.x - f.x > 4 ? 6 : 0);
    a.y = f.y;
  }

  /** Avance une tâche. Renvoie vrai quand elle est finie. */
  private runTask(a: Actor, task: Task, dt: number): boolean {
    switch (task.t) {
      case 'walk':
      case 'slide':
      case 'sit': {
        const speed = (task.t === 'slide' && task.speed) || (task.t === 'sit' ? 30 : WALK_SPEED);
        let budget = speed * dt;
        while (budget > 0 && a.path.length) {
          const p = a.path[0];
          const dx = p.x - a.x, dy = p.y - a.y;
          const d = Math.hypot(dx, dy);
          if (d > 0.01 && task.t !== 'sit') a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
          if (d <= budget) { a.x = p.x; a.y = p.y; a.path.shift(); budget -= d; }
          else { a.x += (dx / d) * budget; a.y += (dy / d) * budget; budget = 0; }
        }
        a.moving = a.path.length > 0 && task.t !== 'sit';
        if (a.path.length) return false;
        a.moving = false;
        if (task.t === 'sit') { a.seated = true; a.seat = task.seat; a.dir = 'down'; }
        else if (task.face) a.dir = task.face;
        return true;
      }
      case 'stand':
        return true;
      case 'wait':
        if (task.dir) a.dir = task.dir;
        return a.curT * 1000 >= task.ms;
      case 'call':
        task.fn();
        return true;
      case 'fade': {
        const step = dt / Math.max(0.05, task.ms / 1000);
        a.alpha = task.to > a.alpha ? Math.min(task.to, a.alpha + step) : Math.max(task.to, a.alpha - step);
        return a.alpha === task.to;
      }
    }
  }

  // ── Les places ──
  private assignSeat(role: Role): Seat | null {
    const free = (r: Role | null) => SEATS.find((s) => (r === null || s.role === r) && !this.seatOf.has(s.id)) ?? null;
    return free(role) ?? (role === 'renfort' ? free(null) : null);
  }

  private overflowSpot(): Tile {
    const used = new Set([...this.actors.values()].map((a) => a.standSpot?.join(',')).filter(Boolean));
    return SPOTS.overflow.find((t) => !used.has(t.join(','))) ?? SPOTS.overflow[0];
  }

  private nearestWindow(a: Actor): Pt {
    const w = a.x < 176 ? WINDOWS[0] : WINDOWS[1];
    return { x: w.x + w.w / 2, y: w.y + w.h - 4 };
  }

  /** Les rapports se posent ici, dans la corbeille du bureau du chef. */
  get inboxPt(): Pt { return { x: 9 * T + 52, y: 7 * T - 2 }; }
  get printerPt(): Pt { return { x: 12 * T + 8, y: 4 * T - 4 }; }

  // ── Les événements ──
  apply(ev: OfficeEvent, live: boolean) {
    const chef = this.chef;
    switch (ev.k) {
      case 'start':
        this.missionActive = true;
        chef.thinkAt = this.time;
        if (live) {
          if (!chef.seated && !chef.busy) this.queue(chef, { t: 'wait', ms: 500, pose: 'wave', dir: 'down' }, { t: 'walk', tile: CHEF_SEAT.tile }, { t: 'sit', seat: CHEF_SEAT });
          else if (!chef.seated) this.queue(chef, { t: 'walk', tile: CHEF_SEAT.tile }, { t: 'sit', seat: CHEF_SEAT });
        } else this.snapSeat(chef, CHEF_SEAT);
        break;
      case 'think': {
        const a = this.actors.get(ev.who);
        if (a) a.thinkAt = this.time;
        break;
      }
      case 'plan': {
        this.plan = ev.items;
        const n = ev.items.length;
        const fresh = n !== this.planSize;
        this.planSize = n;
        if (live && fresh) {
          // Max va écrire le plan au tableau
          chef.tasks = chef.tasks.filter((t) => t.t !== 'sit');
          this.queue(chef,
            { t: 'walk', tile: SPOTS.board, face: 'up', then: SPOTS.boardPx },
            { t: 'call', fn: () => { this.boardUntil = this.time + 1.6; } },
            { t: 'wait', ms: 1600, pose: 'write', dir: 'up' },
            { t: 'call', fn: () => { this.fx.sparkle(SPOTS.boardPx.x, 24, 10, '#ffffff'); } },
            { t: 'walk', tile: CHEF_SEAT.tile },
            { t: 'sit', seat: CHEF_SEAT },
          );
        } else if (live) {
          this.fx.sparkle(SPOTS.boardPx.x + (Math.random() - 0.5) * 60, 22, 5, '#3ddc97');
        }
        break;
      }
      case 'hire': {
        if (this.actors.has(ev.id)) break;
        // novi agent u odeljenju oslobađa onog koji je tu ostao sa greškom
        if (bus.posmatrac) for (const x of this.actors.values()) if (x.failed && x.role === ev.role) this.dismiss(x.id);
        const seat = this.assignSeat(ev.role);
        const a = new Actor(ev.id, ev.role, ev.name, SPOTS.doorOut.x - 8 + Math.random() * 16, SPOTS.doorOut.y);
        if (!this.assignments.some((x) => x.id === ev.id)) this.assignments.push({ id: ev.id, role: ev.role, name: ev.name, task: ev.task, status: 'working' });
        if (seat) { this.seatOf.set(seat.id, a.id); a.seat = seat; }
        else a.standSpot = this.overflowSpot();
        this.actors.set(a.id, a);
        this.rosterChanged();
        if (live) {
          a.alpha = 0;
          a.dir = 'up';
          this.fx.beam(SPOTS.doorOut.x, 15 * T + 10);
          this.queue(a,
            { t: 'fade', to: 1, ms: 250 },
            { t: 'slide', to: tileFeet(SPOTS.door), speed: 40 },
          );
          if (seat) this.queue(a, { t: 'walk', tile: seat.tile }, { t: 'sit', seat });
          else this.queue(a, { t: 'walk', tile: a.standSpot!, face: 'down' });
          // Max se tourne vers celui qu'il appelle
          chef.happyUntil = this.time + 0.8;
        } else if (seat) this.snapSeat(a, seat);
        else { const f = tileFeet(a.standSpot!); a.x = f.x; a.y = f.y; }
        break;
      }
      case 'act': {
        const a = this.actors.get(ev.who);
        if (!a) break;
        a.act = ev.kind;
        a.actAt = this.time;
        if (!live) break;
        this.fx.floatIcon(a.x + (a.seated ? 0 : 1), a.y - 24, iconFor(ev.kind));
        if (ev.kind === 'search' || ev.kind === 'web') this.fx.data(this.nearestWindow(a), { x: a.x, y: a.y - 8 }, ev.kind === 'web' ? '#3ddc97' : '#7fd6ff');
        break;
      }
      case 'report': {
        const a = this.actors.get(ev.who);
        if (!a || a.reported) break;
        a.reported = true;
        if (live) this.deliver(a);
        else this.inbox++;
        break;
      }
      case 'leave': {
        const asg = this.assignments.find((x) => x.id === ev.who);
        if (asg) asg.status = ev.ok ? 'done' : 'failed';
        const a = this.actors.get(ev.who);
        if (!a || a.left) break;
        a.left = true;
        if (!live) { this.remove(a); break; }
        if (bus.posmatrac) {
          // uspeh: „Gotovo” ~5 s za stolom, pa preda rezultat šefu i ode; greška: ostaje dok ga ne pustiš
          if (ev.ok) { this.queue(a, { t: 'wait', ms: 5000 }); a.reported = true; this.deliver(a); this.exit(a); }
          else { a.failed = true; a.sadUntil = this.time + 3600; }
          break;
        }
        if (ev.ok && !a.reported) { a.reported = true; this.deliver(a); }
        if (!ev.ok) a.sadUntil = this.time + 2;
        this.exit(a);
        break;
      }
      case 'file':
        if (live) {
          this.printUntil = this.time + 1.8;
          this.fx.floatIcon(this.printerPt.x, this.printerPt.y - 6, 'paper');
        }
        break;
      case 'ask': {
        const a = this.actors.get(ev.who) ?? chef;
        a.asks++;
        if (live) this.fx.floatIcon(a.x, a.y - 26, 'alert');
        break;
      }
      case 'ask_done':
        for (const a of this.actors.values()) if (a.asks > 0) { a.asks = Math.max(0, a.asks - 1); break; }
        break;
      case 'end':
        this.missionActive = false;
        for (const a of this.actors.values()) if (a !== chef && !a.left) { a.left = true; if (live) this.exit(a); else this.remove(a); }
        if (live) {
          if (ev.ok) { this.fx.rain(22 * T); chef.happyUntil = this.time + 3; }
          chef.tasks = [];
          this.queue(chef,
            { t: 'walk', tile: SPOTS.reception, then: SPOTS.receptionPx },
            { t: 'wait', ms: 100, dir: 'down' },
            { t: 'call', fn: () => {
              if (ev.ok) {
                chef.cheerUntil = this.time + 2.6;
                this.fx.confetti(chef.x, chef.y - 20, 60);
              } else chef.sadUntil = this.time + 2.5;
            } },
          );
        } else {
          chef.tasks = [];
          chef.cur = null;
          chef.seated = false;
          chef.x = SPOTS.receptionPx.x;
          chef.y = SPOTS.receptionPx.y;
          chef.dir = 'down';
        }
        break;
      case 'error':
        chef.sadUntil = this.time + 2;
        break;
    }
  }

  private snapSeat(a: Actor, seat: Seat) {
    a.tasks = [];
    a.cur = null;
    a.seat = seat;
    a.seated = true;
    a.x = seat.x;
    a.y = seat.y;
    a.dir = 'down';
    a.alpha = 1;
  }

  /** Il se lève, prend son rapport et va le poser sur le bureau du chef. */
  private deliver(a: Actor) {
    let spot = SPOTS.deliver.findIndex((_, i) => !this.deliverTaken.has(i));
    if (spot < 0) spot = Math.floor(Math.random() * SPOTS.deliver.length);
    this.deliverTaken.add(spot);
    a.deliverSpot = spot;
    this.queue(a,
      { t: 'stand' },
      { t: 'call', fn: () => { a.carrying = true; } },
      { t: 'walk', tile: SPOTS.deliver[spot], face: 'up' },
      { t: 'call', fn: () => {
        a.carrying = false;
        this.fx.paper({ x: a.x, y: a.y - 12 }, this.inboxPt, () => { this.inbox++; this.fx.sparkle(this.inboxPt.x, this.inboxPt.y, 6, '#ffd2a8'); });
        a.happyUntil = this.time + 1.2;
        this.chef.happyUntil = this.time + 1.2;
      } },
      { t: 'wait', ms: 700, dir: 'up' },
      { t: 'call', fn: () => { this.deliverTaken.delete(spot); a.delivered = true; } },
    );
  }

  /** Il repart par la porte (et libère son bureau). */
  /** Agent sa greškom (režim posmatrača) dobija dozvolu da ode. */
  dismiss(id: string) {
    const a = this.actors.get(id);
    if (!a || !a.failed) return;
    a.failed = false;
    a.sadUntil = 0;
    this.exit(a);
  }

  private exit(a: Actor) {
    this.queue(a,
      { t: 'call', fn: () => { if (a.seat) this.seatOf.delete(a.seat.id); } },
      { t: 'walk', tile: SPOTS.door },
      { t: 'call', fn: () => this.fx.beam(SPOTS.doorOut.x, 15 * T + 10) },
      { t: 'slide', to: { x: a.x, y: SPOTS.doorOut.y }, speed: 40 },
      { t: 'fade', to: 0, ms: 200 },
      { t: 'call', fn: () => this.remove(a) },
    );
  }

  private remove(a: Actor) {
    if (a.seat && this.seatOf.get(a.seat.id) === a.id) this.seatOf.delete(a.seat.id);
    if (a.deliverSpot >= 0) this.deliverTaken.delete(a.deliverSpot);
    a.gone = true;
    this.actors.delete(a.id);
    this.rosterChanged();
  }

  // ── Une image ──
  /** Fait avancer le monde. Renvoie vrai si quelque chose bouge (pour savoir à quel rythme redessiner). */
  update(dtReal: number): boolean {
    const dt = Math.min(0.1, dtReal) * this.speed;
    this.time += dt;
    this.fx.update(dt);
    let moving = this.fx.busy || this.time < this.printUntil || this.time < this.boardUntil;
    const chef = this.chef;
    // la vapeur du café
    if (this.time > this.steamAt) { this.steamAt = this.time + 0.35; this.fx.steam(16 * T + 11, 13 * T + 4); }
    // le chat
    if (this.cat.update(dt, this.time, this.grid, (x, y) => this.fx.floatIcon(x, y, 'zzz'))) moving = true;
    // le jukebox : des notes qui s'envolent quand il joue
    if (this.musicOn && this.time > this.noteAt) {
      this.noteAt = this.time + 0.7 + Math.random() * 0.5;
      this.fx.floatIcon(14 * T + 10 + Math.random() * 12, 13 * T + 2, Math.random() < 0.5 ? 'note' : 'note2');
    }
    if (this.musicOn) moving = true;
    // le mode soirée : des étincelles, et tout le monde danse
    if (this.time < this.discoUntil) {
      moving = true;
      if (Math.random() < 0.25) this.fx.sparkle(32 + Math.random() * 288, 60 + Math.random() * 160, 2, ['#ff6fa8', '#4fb3ff', '#ffd166', '#3ddc97', '#ff8a3d'][Math.floor(Math.random() * 5)]);
    }
    for (const until of this.wiggles.values()) if (until > this.time) moving = true;
    for (const a of this.actors.values()) {
      if (a.id.startsWith('demo-') && this.time - a.actAt > 2 + Math.random() * 3) {
        const kinds: ActKind[] = a.role === 'recherche' ? ['search', 'web'] : a.role === 'code' ? ['write', 'bash'] : a.role === 'analyse' ? ['read', 'write'] : ['write', 'edit'];
        a.act = kinds[Math.floor(Math.random() * kinds.length)];
        a.actAt = this.time;
        this.fx.floatIcon(a.x, a.y - 24, iconFor(a.act));
      }
    }
    // Max salue de temps en temps quand il attend à l'accueil
    if (!this.missionActive && !chef.busy && !chef.seated && this.time > this.waveAt) {
      this.waveAt = this.time + 9 + Math.random() * 6;
      this.queue(chef, { t: 'wait', ms: 1200, pose: 'wave', dir: 'down' });
    }
    for (const a of [...this.actors.values()]) {
      if (!a.cur && a.tasks.length) { a.cur = a.tasks.shift()!; this.startTask(a, a.cur); }
      if (a.cur) {
        const task = a.cur;
        a.curT += dt;
        if (this.runTask(a, task, dt) && a.cur === task) a.cur = null;
      }
      this.animate(a, dt);
      if (a.moving || a.cur || a.seated || a.cheerUntil > this.time) moving = true;
    }
    return moving;
  }

  // ── Les petits gestes du bureau (quand on clique sur les objets) ──
  neonNext() {
    this.neonIndex = (this.neonIndex + 1) % 5;
    this.fx.sparkle(97 + 12, 11 + 11, 10, '#ffffff');
  }

  wiggle(id: string, x: number, y: number) {
    this.wiggles.set(id, this.time + 1.1);
    this.fx.sparkle(x, y, 6, '#86cf7c');
  }

  coffee() {
    for (let i = 0; i < 12; i++) this.fx.steam(16 * T + 9 + Math.random() * 6, 13 * T + 4 - Math.random() * 4);
    this.fx.floatIcon(16 * T + 12, 13 * T - 2, 'coffee');
  }

  cooler() {
    for (let i = 0; i < 6; i++) this.fx.sparkle(9 * T + 8, 3 * T + 4 - i, 1, '#bfe3ff');
    this.fx.floatIcon(9 * T + 8, 3 * T - 4, 'drop');
  }

  toggleLamp(id: string) {
    if (this.lampsOff.has(id)) this.lampsOff.delete(id); else this.lampsOff.add(id);
  }

  /** Le mode soirée : la boule à facettes descend, et toute l'équipe danse. */
  disco(seconds = 16) {
    this.discoUntil = this.time + seconds;
    for (const a of this.actors.values()) a.cheerUntil = this.discoUntil;
    this.fx.rain(22 * T, 70);
  }

  /** Pour la visite guidée sans mission : un agent par coin, assis à son bureau, qui travaille. */
  demoTeam(on: boolean) {
    const demo: [string, Role, string][] = [['demo-1', 'recherche', 'Iris'], ['demo-2', 'recherche', 'Hugo'], ['demo-3', 'code', 'Ada'], ['demo-4', 'design', 'Frida'], ['demo-5', 'redaction', 'Colette'], ['demo-6', 'analyse', 'Marie']];
    if (on) {
      for (const [id, role, name] of demo) {
        if (this.actors.has(id)) continue;
        const seat = this.assignSeat(role);
        if (!seat) continue;
        const a = new Actor(id, role, name, seat.x, seat.y);
        this.seatOf.set(seat.id, id);
        this.snapSeat(a, seat);
        a.act = Math.random() < 0.5 ? 'search' : 'write';
        a.actAt = this.time;
        this.actors.set(id, a);
      }
    } else {
      for (const [id] of demo) { const a = this.actors.get(id); if (a) this.remove(a); }
    }
    this.rosterChanged();
  }

  petCat() {
    this.cat.pet(this.time);
    this.fx.floatIcon(this.cat.x, this.cat.y - 12, 'heart');
  }

  /** La musique : appelé à chaque image avec l'énergie des basses. */
  setMusic(on: boolean, level: number, beat: boolean) {
    this.musicOn = on;
    this.musicLevel = level;
    if (beat) this.bobUntil = this.time + 0.12;
  }

  private animate(a: Actor, dt: number) {
    a.animT += dt;
    const t = this.time;
    const recent = t - a.actAt < 9;
    let pose: Pose;
    if (a.cur?.t === 'wait' && a.cur.pose) pose = a.cur.pose;
    else if (a.moving) pose = a.carrying ? 'carry' : 'walk';
    else if (a.asks > 0) pose = 'raise';
    else if (a.cheerUntil > t) pose = 'cheer';
    else if (a.carrying) pose = 'carry';
    else if (a.seated) {
      if (recent && a.act && ['write', 'edit', 'bash', 'plan'].includes(a.act)) pose = 'type';
      else if (recent) pose = 'read';
      else pose = 'sit';
    } else pose = 'stand';
    if (pose !== a.pose) { a.pose = pose; a.animT = 0; }
    const ft = a.animT;
    switch (pose) {
      case 'walk': a.frame = Math.floor(ft * 8) % 4; break;
      case 'carry': a.frame = a.moving ? Math.floor(ft * 8) % 4 : 0; break;
      case 'type': a.frame = Math.floor(ft * 7) % 2; break;
      case 'cheer': case 'wave': a.frame = Math.floor(ft * 6) % 2; break;
      case 'raise': a.frame = Math.floor(ft * 3) % 2; break;
      case 'write': a.frame = Math.floor(ft * 5) % 2; break;
      default: a.frame = 0;
    }
    if (pose === 'carry' && a.moving) {
      // en marchant avec sa feuille : on garde la pose « porter », jambes en mouvement
      a.frame = Math.floor(ft * 8) % 4;
    }
    // le regard
    if (t > a.nextBlink) { a.blinkUntil = t + 0.12; a.nextBlink = t + 2.2 + Math.random() * 3.5; }
    if (t > a.nextLook) {
      const opts: Eyes[] = ['left', 'right', 'open', 'open', 'up'];
      a.look = opts[Math.floor(Math.random() * opts.length)];
      a.lookUntil = t + 0.8 + Math.random() * 0.8;
      a.nextLook = t + 2.5 + Math.random() * 3;
    }
    let eyes: Eyes = 'open';
    if (a.happyUntil > t || pose === 'cheer') eyes = 'happy';
    else if (a.sadUntil > t) eyes = 'down';
    else if (pose === 'type') eyes = 'down';
    else if (pose === 'read') eyes = Math.floor(ft * 2.2) % 2 ? 'left' : 'right';
    else if (pose === 'write') eyes = 'up';
    else if (t - a.thinkAt < 2.5 && !a.moving) eyes = 'up';
    else if (a.lookUntil > t && !a.moving) eyes = a.look;
    if (a.blinkUntil > t && eyes !== 'happy') eyes = 'blink';
    a.eyes = eyes;
  }
}
