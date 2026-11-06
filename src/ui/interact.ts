// Ce qui se passe quand on clique dans le bureau : chaque objet a une utilité (ou une surprise).
import { jukebox } from '../audio/music.ts';
import { sfx } from '../audio/sfx.ts';
import { say } from '../audio/voice.ts';
import { world } from '../engine/instance.ts';
import type { Hit } from '../engine/hits.ts';
import { savePref, useOffice, type Tod } from '../state/store.ts';

const TOD_NEXT: Record<Tod, Tod> = { auto: 'day', day: 'evening', evening: 'night', night: 'auto' };

const QUOTES = [
  'Cilj kvartala: nula ponavljajućih zadataka.',
  'Pravilo broj 1 u kancelariji: delegira se sve što može da se delegira.',
  'Ovde niko ne broji sate. Niko i ne mora.',
];

let jukeClicks: number[] = [];

/** Le mode soirée : la boule à facettes, la musique, et toute l'équipe qui danse. */
export function party() {
  world.disco(16);
  if (!jukebox.playing) jukebox.play(2);
  void say('afterwork', true);
  sfx('done');
}

export function interact(hit: Hit) {
  const st = useOffice.getState();
  if (hit.kind === 'actor') {
    if (hit.id === 'chef') {
      sfx('click');
      world.chef.happyUntil = world.time + 1.5;
      useOffice.setState({ draft: ' ' });
      return;
    }
    sfx('open');
    useOffice.setState({ modal: { kind: 'agent', id: hit.id } });
    return;
  }
  if (hit.kind === 'cat') {
    world.petCat();
    sfx('meow');
    return;
  }
  const id = hit.id;
  if (id.startsWith('desk-') || id.startsWith('chair-desk-')) {
    // le bureau d'un agent : sa fiche s'il y est assis, sinon le coin et ses outils
    const deskId = id.startsWith('chair-') ? id.slice(6) : id;
    const who = [...world.actors.values()].find((a) => a.seated && a.seat?.deskId === deskId);
    sfx('open');
    useOffice.setState({ modal: who ? { kind: 'agent', id: who.id } : { kind: 'team', role: hit.role } });
    return;
  }
  if (id.startsWith('zone:')) { sfx('open'); useOffice.setState({ modal: { kind: 'team', role: hit.role } }); return; }
  if (id.startsWith('plant-')) {
    const f = id;
    world.wiggle(f, 0, 0);
    sfx('tick');
    return;
  }
  switch (id) {
    case 'board': case 'chefDesk': sfx('open'); useOffice.setState({ modal: { kind: 'board' } }); return;
    case 'chefChair': sfx('click'); useOffice.setState({ draft: ' ' }); return;
    case 'clock': sfx('open'); useOffice.setState({ modal: { kind: 'clock' } }); return;
    case 'rack': sfx('open'); useOffice.setState({ modal: { kind: 'machine' } }); return;
    case 'printer': sfx('open'); useOffice.setState({ modal: { kind: 'files' } }); return;
    case 'shelf':
      sfx('open');
      if (st.mission?.posmatrac) { st.send({ t: 'dnevnik' }); useOffice.setState({ modal: { kind: 'dnevnik' } }); }
      else useOffice.setState({ historyOpen: true });
      return;
    case 'door': sfx('open'); useOffice.setState({ modal: { kind: 'team' } }); return;
    case 'neon': world.neonNext(); sfx('check'); return;
    case 'window': { const n = TOD_NEXT[st.tod]; useOffice.setState({ tod: n }); savePref('tod', n); sfx('click'); return; }
    case 'coffee': world.coffee(); sfx('pour'); return;
    case 'cooler': world.cooler(); sfx('glug'); return;
    case 'lamp': case 'lamp-r': world.toggleLamp(id); sfx('click'); return;
    case 'easel': case 'bin': case 'tableLow': case 'sofa': world.wiggle(id, 0, 0); sfx('tick'); return;
    case 'poster': st.toast('info', QUOTES[Math.floor(Math.random() * QUOTES.length)]); sfx('click'); return;
    case 'jukebox': {
      // cinq clics rapides : c'est la fête
      const now = Date.now();
      jukeClicks = [...jukeClicks.filter((t) => now - t < 2500), now];
      if (jukeClicks.length >= 5) { jukeClicks = []; useOffice.setState({ modal: null }); party(); return; }
      sfx('open');
      useOffice.setState({ modal: { kind: 'jukebox' } });
      return;
    }
  }
}
