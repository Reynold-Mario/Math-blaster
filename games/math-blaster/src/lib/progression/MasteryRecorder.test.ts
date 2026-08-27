import { createMasteryRecorder, type TopicDelta } from './MasteryRecorder';
import { EventBus, type GameEvent } from '../events';

/**
 * Driven by synthetic event streams rather than by a real run: the
 * recorder's whole contract is "interpret the bus correctly", so the bus
 * is the right place to test it from. It also means these assertions stay
 * true whatever gameFlow does next.
 */

function hit(type: GameEvent['type'], topicId?: string, standardCode?: string): GameEvent {
  return { type, xPct: 50, y: 10, targetId: 1, topicId, standardCode, answerDigits: '', digitMatches: [] } as GameEvent;
}

function run(events: GameEvent[]): { finished: TopicDelta[][]; live: TopicDelta[] } {
  const bus = new EventBus();
  const finished: TopicDelta[][] = [];
  const rec = createMasteryRecorder((d) => finished.push(d), bus);
  for (const e of events) bus.emit(e);
  const live = rec.tally();
  rec.dispose();
  return { finished, live };
}

describe('tallying a run', () => {
  it('counts every answer as an attempt and only exact/equivalent as correct', () => {
    const { live } = run([
      hit('hit-exact', 'g1-add-sub-10'),
      hit('hit-equivalent', 'g1-add-sub-10'),
      hit('hit-close', 'g1-add-sub-10'),
      hit('hit-partial', 'g1-add-sub-10'),
      hit('hit-incorrect', 'g1-add-sub-10'),
      hit('hit-invalid', 'g1-add-sub-10'),
    ]);
    expect(live).toEqual([{ topicId: 'g1-add-sub-10', standardCode: undefined, attempts: 6, correct: 2 }]);
  });

  it('does not credit close or partial answers', () => {
    // They buy the player time, which is the game's reward for reasoning
    // toward an answer. They are not evidence of knowing it, and a
    // mastery signal a teacher might act on must not say they are.
    const { live } = run([hit('hit-close', 't'), hit('hit-partial', 't'), hit('hit-close', 't')]);
    expect(live[0]).toMatchObject({ attempts: 3, correct: 0 });
  });

  it('keeps topics apart', () => {
    const { live } = run([
      hit('hit-exact', 'k-add-sub-5'),
      hit('hit-incorrect', 'g3-multiplication'),
      hit('hit-exact', 'k-add-sub-5'),
    ]);
    expect(live).toEqual([
      { topicId: 'k-add-sub-5', standardCode: undefined, attempts: 2, correct: 2 },
      { topicId: 'g3-multiplication', standardCode: undefined, attempts: 1, correct: 0 },
    ]);
  });

  it('never lets correct exceed attempts', () => {
    // Mirrors the database CHECK. If this can drift, the write fails at
    // the far end of a sync rather than here.
    const { live } = run(Array.from({ length: 25 }, () => hit('hit-exact', 't')));
    for (const d of live) expect(d.correct).toBeLessThanOrEqual(d.attempts);
  });
});

describe('attribution', () => {
  it('records a topicId with no standard code', () => {
    // The CCSS mapping is optional and always will be - a topic without
    // one is still a topic, and must still be recorded.
    const { live } = run([hit('hit-exact', 'g2-mult-foundation')]);
    expect(live[0].topicId).toBe('g2-mult-foundation');
    expect(live[0].standardCode).toBeUndefined();
  });

  it('carries a standard code when the topic has one', () => {
    const { live } = run([hit('hit-exact', 'g1-add-sub-10', '1.OA.6')]);
    expect(live[0]).toMatchObject({ topicId: 'g1-add-sub-10', standardCode: '1.OA.6' });
  });

  it('skips an answer it cannot attribute', () => {
    // An authored boss finale has no topic. Filing it under a plausible
    // guess would put a fiction into the mastery record.
    const { live } = run([hit('hit-exact'), hit('hit-incorrect'), hit('hit-exact', 't')]);
    expect(live).toEqual([{ topicId: 't', standardCode: undefined, attempts: 1, correct: 1 }]);
  });

  it('does not unset a code it already learned', () => {
    const { live } = run([hit('hit-exact', 't', '1.OA.6'), hit('hit-close', 't', undefined)]);
    expect(live[0].standardCode).toBe('1.OA.6');
  });

  it('ignores events that are not answers', () => {
    const bus = new EventBus();
    const rec = createMasteryRecorder(() => {}, bus);
    bus.emit({ type: 'shield-blocked', xPct: 1, y: 1, targetId: 1 });
    bus.emit({ type: 'enemy-defeated', xPct: 1, y: 1, kind: 'drone' });
    bus.emit({ type: 'wave-cleared', waveNumber: 2, defeated: 1, released: 1, bonusMs: 0 });
    expect(rec.tally()).toEqual([]);
    rec.dispose();
  });
});

describe('run boundaries', () => {
  it('hands the tally over on game-over and starts clean', () => {
    const bus = new EventBus();
    const finished: TopicDelta[][] = [];
    const rec = createMasteryRecorder((d) => finished.push(d), bus);

    bus.emit(hit('hit-exact', 'a'));
    bus.emit({ type: 'game-over' });
    expect(finished).toEqual([[{ topicId: 'a', standardCode: undefined, attempts: 1, correct: 1 }]]);
    // The next run must not inherit the last one's answers.
    expect(rec.tally()).toEqual([]);

    bus.emit(hit('hit-incorrect', 'b'));
    bus.emit({ type: 'game-over' });
    expect(finished[1]).toEqual([{ topicId: 'b', standardCode: undefined, attempts: 1, correct: 0 }]);
    rec.dispose();
  });

  it('reports an empty run rather than staying silent', () => {
    // "The player answered nothing" is a fact about a run. A caller that
    // only hears from productive runs cannot tell a quiet one from a
    // dropped event.
    const { finished } = run([{ type: 'game-over' }]);
    expect(finished).toEqual([[]]);
  });

  it('hands out copies, so a caller cannot mutate the live tally', () => {
    const bus = new EventBus();
    const rec = createMasteryRecorder(() => {}, bus);
    bus.emit(hit('hit-exact', 'a'));
    const first = rec.tally();
    first[0].attempts = 9999;
    expect(rec.tally()[0].attempts).toBe(1);
    rec.dispose();
  });

  it('stops listening once disposed', () => {
    const bus = new EventBus();
    const rec = createMasteryRecorder(() => {}, bus);
    rec.dispose();
    bus.emit(hit('hit-exact', 'a'));
    expect(rec.tally()).toEqual([]);
  });
});
