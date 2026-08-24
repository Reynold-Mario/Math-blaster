// Superseded by the layered architecture in lib/math, lib/levels,
// lib/runtime, and lib/skills - this file now holds only the one shared
// type nothing else has claimed a home for yet.

/**
 * `stageClear` and `victory` are gone. A run is one endless wave sequence:
 * nothing interrupts it to announce a stage, and there is no final wave to
 * win at - it ends on the clock, at `gameover`.
 */
export type GamePhase = 'boot' | 'skillTree' | 'countdown' | 'playing' | 'gameover';
