/**
 * What happened, not how it should look or sound. Combat and game-flow
 * code emit these; audio.ts and any future animation/particle system
 * subscribe and interpret them. Nothing in this file knows about sound
 * effects, colors, or sprites.
 */
import type { BossDefeatCause } from './runtime/RuntimeState';

/** Identifies what a hit landed on - an enemy's uid, or the boss (which
 * isn't an EnemyInstance and has no uid of its own). Lets a presentation
 * layer flash the exact sprite that was hit rather than guessing from
 * position alone. */
export type HitTargetId = number | 'boss';

export type GameEvent =
  | { type: 'shot-fired'; guessText: string; xPct: number }
  | { type: 'hit-exact'; xPct: number; y: number; targetId: HitTargetId }
  | { type: 'hit-equivalent'; xPct: number; y: number; targetId: HitTargetId }
  | { type: 'hit-close'; xPct: number; y: number; targetId: HitTargetId }
  | {
      type: 'hit-partial';
      xPct: number;
      y: number;
      targetId: HitTargetId;
      /** Place-value aligned, same shape as MathValue's DigitMatch, so the
       * "distinct visual indication" can highlight exactly which digits
       * of the correct answer the player already had right. */
      answerDigits: string;
      digitMatches: boolean[];
    }
  | { type: 'hit-incorrect'; xPct: number; y: number; targetId: HitTargetId }
  | { type: 'hit-invalid'; xPct: number; y: number; targetId: HitTargetId }
  /** A shot that never landed: it bounced off an intact shield, whether
   * a sentinel's or a boss's. Distinct from a miss - the answer may well
   * have been right, it just wasn't right *enough*. */
  | { type: 'shield-blocked'; xPct: number; y: number; targetId: HitTargetId }
  | { type: 'shield-broken'; xPct: number; y: number; targetId: HitTargetId }
  /** One layer of a multi-layer enemy answered, revealing a fresh problem.
   * The enemy is still alive - see `enemy-defeated` for the last layer. */
  | { type: 'enemy-layer-broken'; xPct: number; y: number; layersRemaining: number }
  /** A close or partial answer shoved a grunt back up the screen. Enemies
   * have no health, so this - buying time - is what a not-quite-right
   * answer earns, and `amountPct` is how much of it was earned. */
  | { type: 'enemy-knockback'; xPct: number; y: number; amountPct: number }
  | { type: 'enemy-defeated'; xPct: number; y: number; kind: string }
  | { type: 'enemy-split'; xPct: number; y: number; count: number }
  | { type: 'reinforcement-spawned'; xPct: number }
  /** A wave has been called and is on its way in. Fires at the start of
   * the breather, before anything is on screen. */
  | { type: 'wave-announced'; waveNumber: number; isBoss: boolean }
  /** The wave's formation has just been released. */
  | { type: 'wave-incoming'; waveNumber: number; count: number }
  /** The board emptied, which is what ends a wave. `defeated` counts the
   * qualifying kills; anything in `released` that isn't in `defeated` got
   * through and cost the player clock instead. `bonusMs` is what the clear
   * actually paid, already clamped to the clock's ceiling. */
  | { type: 'wave-cleared'; waveNumber: number; defeated: number; released: number; bonusMs: number }
  /** A good answer shortened the fight. The boss analogue of a damage
   * number, in the units a boss actually runs on. */
  | { type: 'boss-timer-cut'; amountMs: number; remainingMs: number }
  | { type: 'boss-phase-changed'; phaseIndex: number; name: string }
  | { type: 'boss-shield-raised'; weakPointXPct: number }
  | { type: 'boss-shield-dropped' }
  | { type: 'boss-combo'; combo: number; required: number }
  | { type: 'boss-combo-broken'; lostCombo: number }
  /** `bountyEarned` and `timeBonusMs` are what the player ACTUALLY got, not
   * what the fight nominally pays - the clock has a ceiling, and a survival
   * finish earns neither. Both are 0 on the survival route. */
  | {
      type: 'boss-defeated';
      by: BossDefeatCause;
      bestCombo: number;
      waveNumber: number;
      bountyEarned: number;
      timeBonusMs: number;
    }
  | { type: 'boss-finale-started' }
  | { type: 'time-lost'; amountMs: number; remainingMs: number }
  /** Time added back to the run clock - the counterpart to `time-lost`, and
   * the thing that makes a long run possible at all. `amountMs` is what was
   * granted after the cap, not what was offered. */
  | { type: 'time-gained'; amountMs: number; remainingMs: number }
  | { type: 'impact-avoided' }
  | { type: 'currency-earned'; amount: number; total: number }
  /** A new furthest-wave record. Persisted, because it's the ceiling on
   * where a future run may start. */
  | { type: 'wave-record'; waveNumber: number }
  | { type: 'skill-used'; skill: string }
  /** The run's only ending. There is no victory event: the wave sequence
   * is endless, so a run finishes when the clock does and nowhere else. */
  | { type: 'game-over' };

export type GameEventListener = (event: GameEvent) => void;

/** A minimal pub/sub bus - same shape as InputManager's listener set, kept
 * separate because inputs flow into the game and events flow out of it. */
export class EventBus {
  private listeners = new Set<GameEventListener>();

  on(listener: GameEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: GameEvent) {
    for (const listener of this.listeners) listener(event);
  }
}

/** A shared default bus. Presentation modules (audio, future animation)
 * have no natural single owner to receive an instance through props, so a
 * ready-to-use singleton is more practical here than it would be for
 * InputManager, which is always constructed by whichever component owns
 * the DOM lifecycle. */
export const gameEvents = new EventBus();
