import type { SkillNode } from './SkillTree';

/**
 * What a Base-tree node actually grants at a given level. Each node
 * returns exactly one member of this union; costs/balance below are
 * initial values, not final tuning.
 */
export type BaseSkillEffect =
  | { kind: 'root' }
  | { kind: 'playerSpeed'; multiplier: number }
  | { kind: 'enemySpeed'; multiplier: number }
  | { kind: 'health'; bonusTimeMs: number; enemyHpMultiplier: number }
  | { kind: 'dodge'; chance: number }
  | { kind: 'armor'; damageReduction: number }
  | { kind: 'pierce'; chance: number }
  | { kind: 'burn'; chance: number; slowMultiplier: number; durationSec: number }
  | { kind: 'fireRate'; cooldownSec: number }
  | { kind: 'bomb'; cooldownSec: number; damage: number }
  | { kind: 'freeze'; cooldownSec: number; durationSec: number }
  | { kind: 'bounty'; bonusPerKill: number }
  | { kind: 'moreTime'; bonusMs: number };

export type BaseSkillCategory = 'economy' | 'movement' | 'defense' | 'firing' | 'active';

/** id of the single free root node every other node ultimately branches
 * from - see skillsRoot below. */
export const BASE_SKILL_ROOT_ID = 'skills-root';

/** Splits a level's total cost into `parts` near-equal installments that
 * a player buys out one at a time to complete that level - the level's
 * total price is unchanged, only how many purchases it takes to pay it. */
function splitCost(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Converts a node's flat per-level totals into installment chains - 3
 * buys per level by default, so each level of the tree becomes 3 beads to
 * purchase before the next level unlocks. */
function withInstallments(totalCostPerLevel: number[], installmentsPerLevel = 3): number[][] {
  return totalCostPerLevel.map((total) => splitCost(total, installmentsPerLevel));
}

// --- Root ---
// Free, single-installment, no prerequisites - the trunk every other node
// branches from. Buying it is the player's very first click in the tree.

const skillsRoot: SkillNode<BaseSkillEffect> = {
  id: BASE_SKILL_ROOT_ID,
  name: 'Skills',
  description: 'The root of your training - free, and always the first thing to unlock.',
  maxLevel: 1,
  costPerLevel: [[0]],
  prerequisites: [],
  effectAtLevel: () => ({ kind: 'root' }),
};

// --- Economy ---
// Foundational, prerequisite-free (beyond the root) by design: these fund
// everything else, so they're always the first things worth investing in.

const bounty: SkillNode<BaseSkillEffect> = {
  id: 'bounty',
  name: 'Bounty',
  description: 'Increases the currency each defeated enemy drops, by a flat amount per level.',
  maxLevel: 5,
  costPerLevel: withInstallments([40, 60, 90, 130, 180]),
  prerequisites: [{ nodeId: BASE_SKILL_ROOT_ID, requiredLevel: 1 }],
  effectAtLevel: (level) => ({ kind: 'bounty', bonusPerKill: level * 5 }),
};

const moreTime: SkillNode<BaseSkillEffect> = {
  id: 'more-time',
  name: 'More Time',
  description: 'Adds extra starting time to the clock.',
  maxLevel: 5,
  costPerLevel: withInstallments([60, 90, 130, 180, 240]),
  prerequisites: [{ nodeId: BASE_SKILL_ROOT_ID, requiredLevel: 1 }],
  effectAtLevel: (level) => ({ kind: 'moreTime', bonusMs: level * 5000 }),
};

// --- Movement ---

const playerSpeed: SkillNode<BaseSkillEffect> = {
  id: 'player-speed',
  name: 'Player Speed',
  description: 'Increases how fast the ship moves side to side.',
  maxLevel: 5,
  costPerLevel: withInstallments([50, 75, 100, 150, 200]),
  prerequisites: [{ nodeId: BASE_SKILL_ROOT_ID, requiredLevel: 1 }],
  effectAtLevel: (level) => ({ kind: 'playerSpeed', multiplier: 1 + level * 0.1 }),
};

const enemySlowdown: SkillNode<BaseSkillEffect> = {
  id: 'enemy-slowdown',
  name: 'Enemy Slowdown',
  description: 'Enemies fall a little slower for every level purchased.',
  maxLevel: 5,
  costPerLevel: withInstallments([60, 90, 120, 160, 220]),
  prerequisites: [{ nodeId: BASE_SKILL_ROOT_ID, requiredLevel: 1 }],
  effectAtLevel: (level) => ({ kind: 'enemySpeed', multiplier: 1 - level * 0.04 }),
};

// --- Defense ---
// Dodge before Armor is the one deliberately-chained example here: a
// concrete case that prerequisites can gate on any other node, not
// evidence that everything needs a chain.

const healthPool: SkillNode<BaseSkillEffect> = {
  id: 'health-pool',
  name: 'Health Pool',
  description: 'A second, riskier path to more starting time - enemies get a little tougher too.',
  maxLevel: 5,
  costPerLevel: withInstallments([80, 110, 150, 200, 260]),
  prerequisites: [{ nodeId: BASE_SKILL_ROOT_ID, requiredLevel: 1 }],
  effectAtLevel: (level) => ({
    kind: 'health',
    bonusTimeMs: level * 3000,
    enemyHpMultiplier: 1 + level * 0.08,
  }),
};

const dodge: SkillNode<BaseSkillEffect> = {
  id: 'dodge',
  name: 'Dodge',
  description: 'A chance to avoid an enemy impact entirely - no time lost at all when it triggers.',
  maxLevel: 5,
  costPerLevel: withInstallments([70, 100, 140, 190, 250]),
  prerequisites: [{ nodeId: BASE_SKILL_ROOT_ID, requiredLevel: 1 }],
  effectAtLevel: (level) => ({ kind: 'dodge', chance: level * 0.05 }),
};

const armor: SkillNode<BaseSkillEffect> = {
  id: 'armor',
  name: 'Armor',
  description: "Reduces how much time an impact costs, when it isn't dodged.",
  maxLevel: 5,
  costPerLevel: withInstallments([70, 100, 140, 190, 250]),
  prerequisites: [{ nodeId: 'dodge', requiredLevel: 1 }],
  effectAtLevel: (level) => ({ kind: 'armor', damageReduction: level * 0.06 }),
};

// --- Firing ---

const pierce: SkillNode<BaseSkillEffect> = {
  id: 'pierce',
  name: 'Piercing Shots',
  description: 'A chance for a shot to pierce through instead of being spent on one hit.',
  maxLevel: 5,
  costPerLevel: withInstallments([60, 90, 130, 180, 240]),
  prerequisites: [{ nodeId: BASE_SKILL_ROOT_ID, requiredLevel: 1 }],
  effectAtLevel: (level) => ({ kind: 'pierce', chance: level * 0.06 }),
};

const burn: SkillNode<BaseSkillEffect> = {
  id: 'burn',
  name: 'Burn',
  description: 'A chance to inflict a burn that slows the enemy for a few seconds.',
  maxLevel: 5,
  costPerLevel: withInstallments([60, 90, 130, 180, 240]),
  prerequisites: [{ nodeId: BASE_SKILL_ROOT_ID, requiredLevel: 1 }],
  effectAtLevel: (level) => ({
    kind: 'burn',
    chance: level * 0.06,
    slowMultiplier: 0.5,
    durationSec: level === 0 ? 0 : 1.5 + level * 0.5,
  }),
};

const fireRate: SkillNode<BaseSkillEffect> = {
  id: 'fire-rate',
  name: 'Firing Speed',
  description: 'Lowers the cooldown between shots.',
  maxLevel: 5,
  costPerLevel: withInstallments([70, 100, 140, 190, 250]),
  prerequisites: [{ nodeId: BASE_SKILL_ROOT_ID, requiredLevel: 1 }],
  effectAtLevel: (level) => ({ kind: 'fireRate', cooldownSec: Math.max(0.2, 0.6 - level * 0.08) }),
};

// --- Active Abilities ---
// Level 0 means "not yet unlocked" - the ability can't be used at all
// until the first level is purchased.

const bomb: SkillNode<BaseSkillEffect> = {
  id: 'bomb',
  name: 'Bomb',
  description: 'An area-clearing blast that damages every enemy on screen.',
  maxLevel: 5,
  costPerLevel: withInstallments([100, 140, 180, 230, 290]),
  prerequisites: [{ nodeId: BASE_SKILL_ROOT_ID, requiredLevel: 1 }],
  effectAtLevel: (level) => ({
    kind: 'bomb',
    cooldownSec: level === 0 ? Infinity : 33 - level * 3,
    damage: level === 0 ? 0 : 32 + level * 8,
  }),
};

const freeze: SkillNode<BaseSkillEffect> = {
  id: 'freeze',
  name: 'Freeze',
  description: 'Stops every enemy on screen in place for a few seconds.',
  maxLevel: 5,
  costPerLevel: withInstallments([100, 140, 180, 230, 290]),
  prerequisites: [{ nodeId: BASE_SKILL_ROOT_ID, requiredLevel: 1 }],
  effectAtLevel: (level) => ({
    kind: 'freeze',
    cooldownSec: level === 0 ? Infinity : 35 - level * 3,
    durationSec: level === 0 ? 0 : 2.5 + level * 0.4,
  }),
};

export const BASE_SKILL_CATEGORIES: Record<BaseSkillCategory, SkillNode<BaseSkillEffect>[]> = {
  economy: [bounty, moreTime],
  movement: [playerSpeed, enemySlowdown],
  defense: [healthPool, dodge, armor],
  firing: [pierce, burn, fireRate],
  active: [bomb, freeze],
};

/** Every node in the Base tree, including the free root trunk. */
export const BASE_SKILL_NODES: SkillNode<BaseSkillEffect>[] = [
  skillsRoot,
  ...Object.values(BASE_SKILL_CATEGORIES).flat(),
];

/** category of every non-root node, keyed by node id - the root has no
 * category of its own since it isn't part of any branch. */
export const BASE_SKILL_NODE_CATEGORY: Partial<Record<string, BaseSkillCategory>> = Object.fromEntries(
  Object.entries(BASE_SKILL_CATEGORIES).flatMap(([category, nodes]) =>
    nodes.map((n) => [n.id, category as BaseSkillCategory])
  )
);

export function findBaseSkillNode(id: string): SkillNode<BaseSkillEffect> | undefined {
  return BASE_SKILL_NODES.find((n) => n.id === id);
}
