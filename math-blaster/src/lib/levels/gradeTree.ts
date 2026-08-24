import type { SkillNode } from '../skills/SkillTree';
import type { Curriculum } from './LevelDefinition';
import { l1, l2, l3, l4 } from './gameLevels';

/**
 * K-12, even though only K-3 have topics authored below. Adding a later
 * grade is purely a data addition - GRADE_TOPICS is a Partial record, and
 * nothing else in this file assumes every grade is present.
 */
export type GradeLevel = 'K' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12';

export const GRADE_ORDER: GradeLevel[] = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

/**
 * A topic node's cost is NOT the same currency as the Base tree's arcade
 * points - it's a mastery threshold (correct answers needed in the
 * prerequisite topic before this one unlocks), reflecting "ready to
 * advance" rather than "can afford to buy". The generic SkillTree engine
 * doesn't care what the number means, so this reuses it as-is.
 */
export type GradeSkillEffect =
  | { kind: 'locked' }
  | { kind: 'unlocked'; curriculum: Curriculum; levelIds: string[] };

function topicNode(
  id: string,
  name: string,
  description: string,
  curriculum: Curriculum,
  levelIds: string[],
  masteryCost: number,
  prerequisites: SkillNode<GradeSkillEffect>['prerequisites']
): SkillNode<GradeSkillEffect> {
  return {
    id,
    name,
    description,
    maxLevel: 1,
    costPerLevel: [[masteryCost]],
    prerequisites,
    effectAtLevel: (level) => (level === 0 ? { kind: 'locked' } : { kind: 'unlocked', curriculum, levelIds }),
  };
}

// --- Kindergarten ---
// K.OA.5: fluently add and subtract within 5. No existing arcade level
// yet - this is the tree's true entry point, below l1's range.
const kAddSub5 = topicNode(
  'k-add-sub-5',
  'Add & Subtract within 5',
  'The first building block: adding and subtracting with small numbers.',
  { operations: ['+', '-'], numberRange: [1, 5] },
  [],
  12,
  []
);

// --- Grade 1 ---
// 1.OA.6: add/subtract within 20, with fluency within 10 as the
// foundation - split into two nodes matching the two existing levels.
const g1AddSub10 = topicNode(
  'g1-add-sub-10',
  'Add & Subtract within 10',
  'Fluency with single-digit addition and subtraction.',
  l1.curriculum,
  [l1.id],
  15,
  [{ nodeId: 'k-add-sub-5', requiredLevel: 1 }]
);

const g1AddSub20 = topicNode(
  'g1-add-sub-20',
  'Add & Subtract 10-20 (Regrouping)',
  'Two-digit addition and subtraction that requires carrying or borrowing.',
  l2.curriculum,
  [l2.id],
  18,
  [{ nodeId: 'g1-add-sub-10', requiredLevel: 1 }]
);

// --- Grade 2 ---
// 2.NBT: fluent add/subtract within 100. 2.OA.4: equal groups as the
// conceptual foundation for multiplication. Neither has an arcade level
// yet.
const g2AddSub100 = topicNode(
  'g2-add-sub-100',
  'Add & Subtract within 100',
  'Extends addition and subtraction fluency to two-digit numbers up to 100.',
  { operations: ['+', '-'], numberRange: [1, 100] },
  [],
  18,
  [{ nodeId: 'g1-add-sub-20', requiredLevel: 1 }]
);

const g2MultFoundation = topicNode(
  'g2-mult-foundation',
  'Multiplication Foundations',
  'A first, small-scale introduction to multiplication as equal groups.',
  { operations: ['×'], numberRange: [2, 3] },
  [],
  20,
  [{ nodeId: 'g1-add-sub-20', requiredLevel: 1 }]
);

// --- Grade 3 ---
// 3.OA.7: fluently multiply and divide within 100 - the existing l3/l4
// pair, requiring both grade-2 strands to be complete first.
const g3Multiplication = topicNode(
  'g3-multiplication',
  'Multiplication Tables 2-5',
  'Times tables from 2 through 5.',
  l3.curriculum,
  [l3.id],
  22,
  [
    { nodeId: 'g2-add-sub-100', requiredLevel: 1 },
    { nodeId: 'g2-mult-foundation', requiredLevel: 1 },
  ]
);

const g3MultDiv = topicNode(
  'g3-mult-div',
  'Multiplication & Division Tables 6-10',
  'Times tables from 6 through 10, and their matching division facts.',
  l4.curriculum,
  [l4.id],
  25,
  [{ nodeId: 'g3-multiplication', requiredLevel: 1 }]
);

export const GRADE_TOPICS: Partial<Record<GradeLevel, SkillNode<GradeSkillEffect>[]>> = {
  K: [kAddSub5],
  '1': [g1AddSub10, g1AddSub20],
  '2': [g2AddSub100, g2MultFoundation],
  '3': [g3Multiplication, g3MultDiv],
};

export const GRADE_TOPIC_NODES: SkillNode<GradeSkillEffect>[] = Object.values(GRADE_TOPICS).flat();

export function topicsForGrade(grade: GradeLevel): SkillNode<GradeSkillEffect>[] {
  return GRADE_TOPICS[grade] ?? [];
}

export function findGradeTopicNode(id: string): SkillNode<GradeSkillEffect> | undefined {
  return GRADE_TOPIC_NODES.find((n) => n.id === id);
}

// --- Curriculum ladders. This file already knew which curricula belong to
// which grade; what it lacked was anyone asking. These two functions are
// that question, and they're what stops a run drifting into maths the
// player was never meant to be practising.
//
// The curriculum is read off `effectAtLevel(1)` - a topic's *unlocked*
// effect - rather than stored twice. `levelIds` is ignored on purpose:
// three topics have none (no arcade level was ever authored for them), and
// a run doesn't need one now that waves are generated. ---

function curriculumOf(topic: SkillNode<GradeSkillEffect>): Curriculum | null {
  const effect = topic.effectAtLevel(1);
  return effect.kind === 'unlocked' ? effect.curriculum : null;
}

function laddersUpTo(grade: GradeLevel): Curriculum[] {
  const limit = GRADE_ORDER.indexOf(grade);
  if (limit < 0) return [];
  return GRADE_ORDER.slice(0, limit + 1)
    .flatMap((g) => topicsForGrade(g))
    .map(curriculumOf)
    .filter((c): c is Curriculum => c !== null);
}

/**
 * The curricula a run at this grade walks up, easiest first - that grade's
 * topics and nothing else.
 *
 * Scoped to the single grade on purpose: a Grade 2 player practising
 * Grade 2 maths should not find themselves being asked Grade 3 questions
 * because their run went well. `curriculumForWave` holds at the last rung,
 * so a long run stays at the hardest thing this grade actually teaches.
 *
 * Falls back to every authored curriculum for a grade with no topics
 * (Grades 4-12 are typed but unauthored), so an unexpected grade degrades
 * to "the whole game" rather than to a run with no problems in it.
 */
export function curriculumLadderForGrade(grade: GradeLevel): Curriculum[] {
  const own = topicsForGrade(grade)
    .map(curriculumOf)
    .filter((c): c is Curriculum => c !== null);
  return own.length > 0 ? own : laddersUpTo(GRADE_ORDER[GRADE_ORDER.length - 1]);
}

/**
 * Everything from Kindergarten up through this grade, easiest first - what
 * a boss draws on, so a fight reviews the ground already covered rather
 * than only the newest material.
 *
 * Wider than the wave ladder by design: waves teach this grade, bosses
 * test everything up to it.
 */
export function cumulativeScopeForGrade(grade: GradeLevel): Curriculum[] {
  const scope = laddersUpTo(grade);
  return scope.length > 0 ? scope : curriculumLadderForGrade(grade);
}
