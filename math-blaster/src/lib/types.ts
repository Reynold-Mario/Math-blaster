// Superseded by the layered architecture in lib/math, lib/levels,
// lib/runtime, and lib/skills - this file now holds only the one shared
// type nothing else has claimed a home for yet.

export type GamePhase = 'boot' | 'skillTree' | 'countdown' | 'playing' | 'stageClear' | 'victory' | 'gameover';
