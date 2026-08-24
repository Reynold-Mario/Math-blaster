/**
 * What happened, not how it should look or sound. Combat and game-flow
 * code emit these; audio.ts and any future animation/particle system
 * subscribe and interpret them. Nothing in this file knows about sound
 * effects, colors, or sprites.
 */
/** Identifies what a hit landed on - an enemy's uid, or the boss (which
 * isn't an EnemyInstance and has no uid of its own). Lets a presentation
 * layer flash the exact sprite that was hit rather than guessing from
 * position alone. */
export type HitTargetId = number | 'boss';

export type GameEvent =
  | { type: 'shot-fired'; guessText: string; xPct: number }
  | { type: 'hit-exact'; xPct: number; y: number; damage: number; targetId: HitTargetId }
  | { type: 'hit-equivalent'; xPct: number; y: number; damage: number; targetId: HitTargetId }
  | { type: 'hit-close'; xPct: number; y: number; damage: number; targetId: HitTargetId }
  | {
      type: 'hit-partial';
      xPct: number;
      y: number;
      damage: number;
      targetId: HitTargetId;
      /** Place-value aligned, same shape as MathValue's DigitMatch, so the
       * "distinct visual indication" can highlight exactly which digits
       * of the correct answer the player already had right. */
      answerDigits: string;
      digitMatches: boolean[];
    }
  | { type: 'hit-incorrect'; xPct: number; y: number; targetId: HitTargetId }
  | { type: 'hit-invalid'; xPct: number; y: number; targetId: HitTargetId }
  | { type: 'enemy-defeated'; xPct: number; y: number; kind: string }
  | { type: 'reinforcement-spawned'; xPct: number }
  | { type: 'boss-hit'; damage: number; bossHpPct: number }
  | { type: 'boss-defeated' }
  | { type: 'boss-finale-started' }
  | { type: 'time-lost'; amountMs: number; remainingMs: number }
  | { type: 'impact-avoided' }
  | { type: 'currency-earned'; amount: number; total: number }
  | { type: 'skill-used'; skill: string }
  | { type: 'stage-cleared'; stageId: string }
  | { type: 'level-started'; stageId: string }
  | { type: 'game-over' }
  | { type: 'victory' };

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
