import type { SkillNode } from './SkillTree';

export type BaseSkillCategory = 'economy' | 'movement' | 'defense' | 'firing' | 'active';

/**
 * What a Base-tree node actually grants at a given level. Each node
 * returns exactly one member of this union; costs/balance below are
 * initial values, not final tuning.
 */
export type BaseSkillEffect =
  | { kind: 'root' }
  /** A branch gate - grants no gameplay effect of its own, it only opens
   * the category's skills for purchase. See the branch-gate note below. */
  | { kind: 'branch'; category: BaseSkillCategory; opened: boolean }
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

/** id of the single free root node every other node ultimately branches
 * from - see skillsRoot below. */
export const BASE_SKILL_ROOT_ID = 'skills-root';

/** id of each category's branch gate, keyed by the category it opens. */
export const BASE_SKILL_BRANCH_IDS: Record<BaseSkillCategory, string> = {
  economy: 'branch-economy',
  movement: 'branch-movement',
  defense: 'branch-defense',
  firing: 'branch-firing',
  active: 'branch-active',
};

const BRANCH_ID_SET = new Set(Object.values(BASE_SKILL_BRANCH_IDS));

/** True for the five branch-gate nodes - they're structural doorways, not
 * upgrades, and the shop UI renders them differently for that reason. */
export function isBranchGateId(id: string): boolean {
  return BRANCH_ID_SET.has(id);
}

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

/**
 * Shape of the tree. Nothing hangs off the root directly except the five
 * branch gates - one per (already colour-coded) category. Buying the free
 * root therefore reveals five choices, not eleven skills; a category's
 * skills only appear once the player has paid to open that branch:
 *
 *   skills-root
 *   |- branch-economy .... 25
 *   |  |- bounty
 *   |  '- more-time
 *   |- branch-movement ... 30
 *   |  |- player-speed
 *   |  '- enemy-slowdown
 *   |- branch-defense .... 40
 *   |  |- dodge
 *   |  |   '- armor
 *   |  '- health-pool
 *   |- branch-firing ..... 40
 *   |  |- pierce
 *   |  |- burn
 *   |  '- fire-rate
 *   '- branch-active ..... 60
 *      |- bomb
 *      '- freeze
 *
 * The point is pacing: the player picks ONE branch to invest in at a
 * time, so the shop never dumps every node on them at once. Gates are a
 * single installment (one click opens a branch - the gate is a doorway,
 * not a grind) and cost less than the cheapest skill behind them, but
 * enough that opening a branch is a real decision at ~5 currency/kill.
 * Economy is cheapest on purpose: it funds everything else.
 *
 * Armor behind Dodge is the one skill-to-skill chain, kept from before
 * the gates existed - mitigating a hit you didn't dodge only means
 * something once you can dodge at all.
 *
 * NOTE: SkillTreeScreen's radial diagram treats a node's *first*
 * prerequisite as its parent bead - list the direct parent first if a
 * node ever gains more than one.
 */

/** Prerequisite on a category's gate - what every skill in that category
 * is gated behind. */
function behindGate(category: BaseSkillCategory) {
  return [{ nodeId: BASE_SKILL_BRANCH_IDS[category], requiredLevel: 1 }];
}

function branchGate(
  category: BaseSkillCategory,
  name: string,
  description: string,
  cost: number
): SkillNode<BaseSkillEffect> {
  return {
    id: BASE_SKILL_BRANCH_IDS[category],
    name,
    description,
    maxLevel: 1,
    costPerLevel: [[cost]],
    prerequisites: [{ nodeId: BASE_SKILL_ROOT_ID, requiredLevel: 1 }],
    effectAtLevel: (level) => ({ kind: 'branch', category, opened: level >= 1 }),
  };
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

const economyBranch = branchGate(
  'economy',
  'Economy',
  'Opens the Economy branch: earn more, and buy yourself more time on the clock.',
  25
);

const bounty: SkillNode<BaseSkillEffect> = {
  id: 'bounty',
  name: 'Bounty',
  description: 'Increases the currency each defeated enemy drops, by a flat amount per level.',
  maxLevel: 5,
  costPerLevel: withInstallments([40, 60, 90, 130, 180]),
  prerequisites: behindGate('economy'),
  effectAtLevel: (level) => ({ kind: 'bounty', bonusPerKill: level * 5 }),
};

const moreTime: SkillNode<BaseSkillEffect> = {
  id: 'more-time',
  name: 'More Time',
  description: 'Adds extra starting time to the clock.',
  maxLevel: 5,
  costPerLevel: withInstallments([60, 90, 130, 180, 240]),
  prerequisites: behindGate('economy'),
  effectAtLevel: (level) => ({ kind: 'moreTime', bonusMs: level * 5000 }),
};

// --- Movement ---

const movementBranch = branchGate(
  'movement',
  'Movement',
  'Opens the Movement branch: line up under enemies faster, and give yourself longer to do it.',
  30
);

const playerSpeed: SkillNode<BaseSkillEffect> = {
  id: 'player-speed',
  name: 'Player Speed',
  description: 'Increases how fast the ship moves side to side.',
  maxLevel: 5,
  costPerLevel: withInstallments([50, 75, 100, 150, 200]),
  prerequisites: behindGate('movement'),
  effectAtLevel: (level) => ({ kind: 'playerSpeed', multiplier: 1 + level * 0.1 }),
};

const enemySlowdown: SkillNode<BaseSkillEffect> = {
  id: 'enemy-slowdown',
  name: 'Enemy Slowdown',
  description: 'Enemies fall a little slower for every level purchased.',
  maxLevel: 5,
  costPerLevel: withInstallments([60, 90, 120, 160, 220]),
  prerequisites: behindGate('movement'),
  effectAtLevel: (level) => ({ kind: 'enemySpeed', multiplier: 1 - level * 0.04 }),
};

// --- Defense ---
// Dodge forks: Armor mitigates the hits you don't dodge, so it chains
// behind Dodge rather than off the gate.

const defenseBranch = branchGate(
  'defense',
  'Defense',
  "Opens the Defense branch: dodge impacts, blunt the ones you can't, or just take more of them.",
  40
);

const dodge: SkillNode<BaseSkillEffect> = {
  id: 'dodge',
  name: 'Dodge',
  description: 'A chance to avoid an enemy impact entirely - no time lost at all when it triggers.',
  maxLevel: 5,
  costPerLevel: withInstallments([70, 100, 140, 190, 250]),
  prerequisites: behindGate('defense'),
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

const healthPool: SkillNode<BaseSkillEffect> = {
  id: 'health-pool',
  name: 'Health Pool',
  description: 'A second, riskier path to more starting time - enemies get a little tougher too.',
  maxLevel: 5,
  costPerLevel: withInstallments([80, 110, 150, 200, 260]),
  prerequisites: behindGate('defense'),
  effectAtLevel: (level) => ({
    kind: 'health',
    bonusTimeMs: level * 3000,
    enemyHpMultiplier: 1 + level * 0.08,
  }),
};

// --- Firing ---

const firingBranch = branchGate(
  'firing',
  'Firing',
  'Opens the Firing branch: make each shot count for more, and fire them off faster.',
  40
);

const pierce: SkillNode<BaseSkillEffect> = {
  id: 'pierce',
  name: 'Piercing Shots',
  description: 'A chance for a shot to pierce through instead of being spent on one hit.',
  maxLevel: 5,
  costPerLevel: withInstallments([60, 90, 130, 180, 240]),
  prerequisites: behindGate('firing'),
  effectAtLevel: (level) => ({ kind: 'pierce', chance: level * 0.06 }),
};

const burn: SkillNode<BaseSkillEffect> = {
  id: 'burn',
  name: 'Burn',
  description: 'A chance to inflict a burn that slows the enemy for a few seconds.',
  maxLevel: 5,
  costPerLevel: withInstallments([60, 90, 130, 180, 240]),
  prerequisites: behindGate('firing'),
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
  prerequisites: behindGate('firing'),
  effectAtLevel: (level) => ({ kind: 'fireRate', cooldownSec: Math.max(0.2, 0.6 - level * 0.08) }),
};

// --- Active Abilities ---
// Level 0 means "not yet unlocked" - the ability can't be used at all
// until the first level is purchased.

const activeBranch = branchGate(
  'active',
  'Active Abilities',
  'Opens the Active Abilities branch: on-demand powers you trigger yourself. The priciest gate.',
  60
);

const bomb: SkillNode<BaseSkillEffect> = {
  id: 'bomb',
  name: 'Bomb',
  description: 'An area-clearing blast that damages every enemy on screen.',
  maxLevel: 5,
  costPerLevel: withInstallments([100, 140, 180, 230, 290]),
  prerequisites: behindGate('active'),
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
  prerequisites: behindGate('active'),
  effectAtLevel: (level) => ({
    kind: 'freeze',
    cooldownSec: level === 0 ? Infinity : 35 - level * 3,
    durationSec: level === 0 ? 0 : 2.5 + level * 0.4,
  }),
};

/** Each category leads with its branch gate, followed by the skills that
 * gate opens - this order is also the sibling order the radial diagram
 * lays branches out in. */
export const BASE_SKILL_CATEGORIES: Record<BaseSkillCategory, SkillNode<BaseSkillEffect>[]> = {
  economy: [economyBranch, bounty, moreTime],
  movement: [movementBranch, playerSpeed, enemySlowdown],
  defense: [defenseBranch, dodge, armor, healthPool],
  firing: [firingBranch, pierce, burn, fireRate],
  active: [activeBranch, bomb, freeze],
};

/** Every node in the Base tree, including the free root trunk and the
 * five branch gates. */
export const BASE_SKILL_NODES: SkillNode<BaseSkillEffect>[] = [
  skillsRoot,
  ...Object.values(BASE_SKILL_CATEGORIES).flat(),
];

/** category of every non-root node, keyed by node id - the root has no
 * category of its own since it isn't part of any branch. A branch gate
 * belongs to the category it opens. */
export const BASE_SKILL_NODE_CATEGORY: Partial<Record<string, BaseSkillCategory>> = Object.fromEntries(
  Object.entries(BASE_SKILL_CATEGORIES).flatMap(([category, nodes]) =>
    nodes.map((n) => [n.id, category as BaseSkillCategory])
  )
);

export function findBaseSkillNode(id: string): SkillNode<BaseSkillEffect> | undefined {
  return BASE_SKILL_NODES.find((n) => n.id === id);
}
