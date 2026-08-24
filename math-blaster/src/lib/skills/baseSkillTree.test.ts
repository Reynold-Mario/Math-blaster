import { isUnlocked, type SkillProgress } from './SkillTree';
import {
  BASE_SKILL_BRANCH_IDS,
  BASE_SKILL_CATEGORIES,
  BASE_SKILL_NODES,
  BASE_SKILL_ROOT_ID,
  findBaseSkillNode,
  isBranchGateId,
  type BaseSkillCategory,
} from './baseSkillTree';

const GATE_IDS = Object.values(BASE_SKILL_BRANCH_IDS);
const CATEGORIES = Object.keys(BASE_SKILL_CATEGORIES) as BaseSkillCategory[];

const ROOT_BOUGHT: SkillProgress = { [BASE_SKILL_ROOT_ID]: 1 };

/** ids of every node purchasable at the given progress. */
function unlockedIds(progress: SkillProgress): string[] {
  return BASE_SKILL_NODES.filter((n) => isUnlocked(n, progress))
    .map((n) => n.id)
    .sort();
}

function skillIdsOf(category: BaseSkillCategory): string[] {
  return BASE_SKILL_CATEGORIES[category].filter((n) => !isBranchGateId(n.id)).map((n) => n.id);
}

/** What each gate makes buyable the moment it opens - deliberately spelled
 * out rather than derived from the tree, so a mis-wired prerequisite shows
 * up here instead of agreeing with itself. Armor is absent from Defense on
 * purpose: it chains behind Dodge, not the gate. */
const SKILLS_OPENED_BY_GATE: Record<BaseSkillCategory, string[]> = {
  economy: ['bounty', 'more-time'],
  movement: ['player-speed', 'enemy-slowdown'],
  defense: ['dodge'],
  firing: ['pierce', 'burn', 'fire-rate'],
  active: ['bomb', 'freeze'],
  progression: ['checkpoint'],
};

describe('tree shape', () => {
  it('has a free, prerequisite-free root', () => {
    const root = findBaseSkillNode(BASE_SKILL_ROOT_ID)!;
    expect(root.prerequisites).toEqual([]);
    expect(root.costPerLevel).toEqual([[0]]);
    expect(root.maxLevel).toBe(1);
  });

  it('hangs nothing but the five branch gates directly off the root', () => {
    const rootChildren = BASE_SKILL_NODES.filter((n) =>
      n.prerequisites.some((p) => p.nodeId === BASE_SKILL_ROOT_ID)
    ).map((n) => n.id);
    expect(rootChildren.sort()).toEqual([...GATE_IDS].sort());
  });

  it('gives every category exactly one gate, recognised as a gate', () => {
    expect(GATE_IDS).toHaveLength(CATEGORIES.length);
    for (const category of CATEGORIES) {
      const gateId = BASE_SKILL_BRANCH_IDS[category];
      expect(isBranchGateId(gateId)).toBe(true);
      expect(BASE_SKILL_CATEGORIES[category].filter((n) => isBranchGateId(n.id))).toHaveLength(1);
      for (const skillId of skillIdsOf(category)) expect(isBranchGateId(skillId)).toBe(false);
    }
  });

  it('leaves no node unreachable from the root', () => {
    const reached = new Set<string>([BASE_SKILL_ROOT_ID]);
    for (let pass = 0; pass < BASE_SKILL_NODES.length; pass++) {
      for (const node of BASE_SKILL_NODES) {
        if (node.prerequisites.length > 0 && node.prerequisites.every((p) => reached.has(p.nodeId))) {
          reached.add(node.id);
        }
      }
    }
    expect([...reached].sort()).toEqual(BASE_SKILL_NODES.map((n) => n.id).sort());
  });
});

describe('gated unlock pacing', () => {
  it('unlocks nothing but the root before anything is bought', () => {
    expect(unlockedIds({})).toEqual([BASE_SKILL_ROOT_ID]);
  });

  it('reveals the five gates - and no skills - once the root is bought', () => {
    expect(unlockedIds(ROOT_BOUGHT)).toEqual([BASE_SKILL_ROOT_ID, ...GATE_IDS].sort());
  });

  it.each(CATEGORIES)('opening the %s gate unlocks only that category', (category) => {
    const progress: SkillProgress = { ...ROOT_BOUGHT, [BASE_SKILL_BRANCH_IDS[category]]: 1 };
    const skills = unlockedIds(progress).filter((id) => id !== BASE_SKILL_ROOT_ID && !isBranchGateId(id));
    expect(skills).toEqual([...SKILLS_OPENED_BY_GATE[category]].sort());
  });

  it('keeps a category locked when a different gate is opened', () => {
    const progress: SkillProgress = { ...ROOT_BOUGHT, [BASE_SKILL_BRANCH_IDS.economy]: 1 };
    for (const skillId of skillIdsOf('active')) {
      expect(isUnlocked(findBaseSkillNode(skillId)!, progress)).toBe(false);
    }
  });

  it('still chains Armor behind Dodge, not just behind the Defense gate', () => {
    const gateOnly: SkillProgress = { ...ROOT_BOUGHT, [BASE_SKILL_BRANCH_IDS.defense]: 1 };
    const armor = findBaseSkillNode('armor')!;
    expect(isUnlocked(armor, gateOnly)).toBe(false);
    expect(isUnlocked(armor, { ...gateOnly, dodge: 1 })).toBe(true);
  });
});

describe('gate pricing', () => {
  it.each(CATEGORIES)('makes the %s gate a single click', (category) => {
    const gate = findBaseSkillNode(BASE_SKILL_BRANCH_IDS[category])!;
    expect(gate.maxLevel).toBe(1);
    expect(gate.costPerLevel).toHaveLength(1);
    expect(gate.costPerLevel[0]).toHaveLength(1);
  });

  it.each(CATEGORIES)('prices the %s gate below the cheapest skill behind it', (category) => {
    const gate = findBaseSkillNode(BASE_SKILL_BRANCH_IDS[category])!;
    const cheapestFirstLevel = Math.min(
      ...skillIdsOf(category).map((id) =>
        findBaseSkillNode(id)!.costPerLevel[0].reduce((a, b) => a + b, 0)
      )
    );
    expect(gate.costPerLevel[0][0]).toBeLessThan(cheapestFirstLevel);
  });
});
