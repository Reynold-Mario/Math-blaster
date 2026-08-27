import { gameEvents, EventBus, type GameEvent } from '../events';

/**
 * Turns a run's answers into per-topic tallies.
 *
 * It is a SUBSCRIBER, in the same way `audio.ts` and `GameCanvas` are:
 * `gameFlow` emits what happened and this interprets it, so nothing in
 * the game loop knows that mastery is being recorded. `RuntimeState`
 * gains no field and `gameFlow` gains no call.
 *
 * Locally the deltas go nowhere yet - there is no `skill_mastery` to
 * write them to until the Supabase store lands. The recorder exists now
 * because ATTRIBUTION is the expensive part to retrofit: a run that
 * happened before problems carried a topic can never be recovered.
 */

export interface TopicDelta {
  topicId: string;
  /** Absent for a topic with no Common Core code. Never invented. */
  standardCode?: string;
  /** Every answer aimed at this topic, right or wrong. */
  attempts: number;
  /** Only `exact` and `equivalent`. This is the game's own definition of
   * a right answer - it is what clears a layer and what strips a shield -
   * and using a looser one here would inflate a mastery signal that a
   * teacher might act on. */
  correct: number;
}

/** The verdicts that count as knowing the answer. `close` and `partial`
 * earn a player time; they do not earn a mastery credit. */
const CORRECT: ReadonlySet<GameEvent['type']> = new Set(['hit-exact', 'hit-equivalent']);

const ATTEMPT: ReadonlySet<GameEvent['type']> = new Set([
  'hit-exact',
  'hit-equivalent',
  'hit-close',
  'hit-partial',
  'hit-incorrect',
  'hit-invalid',
]);

export interface MasteryRecorder {
  /** This run's tally so far, ordered by first appearance so a reader
   * sees topics in the order the player met them. */
  tally(): TopicDelta[];
  /** Start a fresh run. */
  reset(): void;
  /** Stop listening. */
  dispose(): void;
}

/**
 * `onRunComplete` fires on `game-over` with the finished run's tally, and
 * the recorder resets itself immediately after - so the next run starts
 * clean whether or not anyone was listening.
 */
export function createMasteryRecorder(
  onRunComplete: (deltas: TopicDelta[]) => void = () => {},
  bus: EventBus = gameEvents
): MasteryRecorder {
  // Insertion-ordered, which is what gives tally() its stable order.
  let counts = new Map<string, TopicDelta>();

  const unsubscribe = bus.on((event: GameEvent) => {
    if (event.type === 'game-over') {
      const finished = snapshot();
      counts = new Map();
      // Even an empty run reports. "The player answered nothing" is a
      // fact about a run, and a caller that only hears from productive
      // runs cannot tell a quiet one from a dropped event.
      onRunComplete(finished);
      return;
    }

    if (!ATTEMPT.has(event.type)) return;
    // Narrowing: only the hit-* variants carry attribution, and ATTEMPT
    // is exactly those.
    const { topicId, standardCode } = event as GameEvent & { topicId?: string; standardCode?: string };
    // No topic, no record. An authored boss finale has none, and a guess
    // filed under an invented topic is worse than one not filed at all.
    if (!topicId) return;

    const entry = counts.get(topicId) ?? { topicId, standardCode, attempts: 0, correct: 0 };
    entry.attempts += 1;
    if (CORRECT.has(event.type)) entry.correct += 1;
    // A code can arrive late if one variant of a topic carries it and
    // another does not; never unset one that is already known.
    if (standardCode && !entry.standardCode) entry.standardCode = standardCode;
    counts.set(topicId, entry);
  });

  function snapshot(): TopicDelta[] {
    return [...counts.values()].map((d) => ({ ...d }));
  }

  return {
    tally: snapshot,
    reset: () => void (counts = new Map()),
    dispose: unsubscribe,
  };
}
