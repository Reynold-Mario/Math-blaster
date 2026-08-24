// Superseded by the layered architecture in lib/math, lib/levels,
// lib/runtime, and lib/skills - this file now holds only the one shared
// type nothing else has claimed a home for yet.

/**
 * `stageClear` and `victory` are gone. A run is one endless wave sequence:
 * nothing interrupts it to announce a stage, and there is no final wave to
 * win at - it ends on the clock, at `gameover`.
 *
 * `runSetup` sits between the shop and the countdown: the one place a run's
 * starting wave is chosen, which is a decision about the run rather than a
 * purchase, so it doesn't belong in the shop.
 */
export type GamePhase = 'boot' | 'skillTree' | 'runSetup' | 'countdown' | 'playing' | 'gameover';
