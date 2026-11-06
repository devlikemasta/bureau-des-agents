// Le fil des événements entre la mémoire du bureau (React) et le moteur du jeu (les robots).
import type { OfficeEvent } from '../../shared/protocol.ts';

type Fn = (ev: OfficeEvent, live: boolean) => void;

const listeners = new Set<Fn>();
const resetters = new Set<() => void>();

export const bus = {
  /** režim posmatrača (agenti iz naših sesija): drugačiji odlazak i balončići */
  posmatrac: false,
  on(fn: Fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  emit(ev: OfficeEvent, live: boolean) { for (const fn of listeners) fn(ev, live); },
  /** nouvelle mission, rediffusion : le bureau se vide, Max revient à l'accueil */
  onReset(fn: () => void) { resetters.add(fn); return () => { resetters.delete(fn); }; },
  reset() { for (const fn of resetters) fn(); },
};
