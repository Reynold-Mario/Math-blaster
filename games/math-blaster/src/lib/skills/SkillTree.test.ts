import {
  getLevel,
  getInstallmentsPaid,
  isUnlocked,
  installmentsForNextLevel,
  nextInstallmentCost,
  canPurchaseNextInstallment,
  purchaseNextInstallment,
  currentEffect,
  totalPointsSpent,
  type SkillNode,
  type SkillProgress,
  type SkillSubProgress,
} from './SkillTree';

function makeNode(overrides: Partial<SkillNode<number>> = {}): SkillNode<number> {
  return {
    id: 'node-a',
    name: 'Node A',
    description: 'A test node',
    maxLevel: 3,
    costPerLevel: [[10], [20], [30]],
    prerequisites: [],
    effectAtLevel: (level) => level,
    ...overrides,
  };
}

describe('getLevel', () => {
  it('is 0 for a node absent from progress', () => {
    expect(getLevel({}, 'node-a')).toBe(0);
  });

  it('reads the stored level', () => {
    expect(getLevel({ 'node-a': 2 }, 'node-a')).toBe(2);
  });
});

describe('getInstallmentsPaid', () => {
  it('is 0 for a node with no sub-progress recorded', () => {
    expect(getInstallmentsPaid({}, 'node-a')).toBe(0);
  });

  it('reads the stored installment count', () => {
    expect(getInstallmentsPaid({ 'node-a': 2 }, 'node-a')).toBe(2);
  });
});

describe('isUnlocked', () => {
  it('is always true when there are no prerequisites', () => {
    expect(isUnlocked(makeNode(), {})).toBe(true);
  });

  it('is false when a prerequisite level is not yet met', () => {
    const node = makeNode({ prerequisites: [{ nodeId: 'dodge', requiredLevel: 1 }] });
    expect(isUnlocked(node, {})).toBe(false);
  });

  it('is true once every prerequisite level is met', () => {
    const node = makeNode({ prerequisites: [{ nodeId: 'dodge', requiredLevel: 1 }] });
    expect(isUnlocked(node, { dodge: 1 })).toBe(true);
  });
});

describe('installmentsForNextLevel', () => {
  it('returns the installments for the next level to purchase', () => {
    const node = makeNode({ costPerLevel: [[10, 5], [20], [30]] });
    expect(installmentsForNextLevel(node, {})).toEqual([10, 5]);
    expect(installmentsForNextLevel(node, { 'node-a': 1 })).toEqual([20]);
  });

  it('returns null once the node is maxed out', () => {
    const node = makeNode();
    expect(installmentsForNextLevel(node, { 'node-a': 3 })).toBeNull();
  });
});

describe('nextInstallmentCost', () => {
  it('returns the cost of the very next installment', () => {
    const node = makeNode({ costPerLevel: [[6, 4], [20], [30]] });
    expect(nextInstallmentCost(node, {}, {})).toBe(6);
    expect(nextInstallmentCost(node, {}, { 'node-a': 1 })).toBe(4);
  });

  it('returns null once the node is maxed out', () => {
    const node = makeNode();
    expect(nextInstallmentCost(node, { 'node-a': 3 }, {})).toBeNull();
  });
});

describe('canPurchaseNextInstallment', () => {
  it('is false when locked by a prerequisite regardless of available points', () => {
    const node = makeNode({ prerequisites: [{ nodeId: 'dodge', requiredLevel: 1 }] });
    expect(canPurchaseNextInstallment(node, {}, {}, 9999)).toBe(false);
  });

  it('is false when unlocked but underfunded', () => {
    const node = makeNode();
    expect(canPurchaseNextInstallment(node, {}, {}, 5)).toBe(false);
  });

  it('is true when unlocked and affordable', () => {
    const node = makeNode();
    expect(canPurchaseNextInstallment(node, {}, {}, 10)).toBe(true);
  });

  it('is false when already maxed out even with unlimited points', () => {
    const node = makeNode();
    expect(canPurchaseNextInstallment(node, { 'node-a': 3 }, {}, 9999)).toBe(false);
  });
});

describe('purchaseNextInstallment', () => {
  it('returns null when the purchase is not possible', () => {
    const node = makeNode();
    expect(purchaseNextInstallment(node, {}, {}, 5)).toBeNull();
  });

  it('completes a single-installment level in one purchase, without mutating inputs', () => {
    const node = makeNode();
    const progress: SkillProgress = {};
    const subProgress: SkillSubProgress = {};
    const purchase = purchaseNextInstallment(node, progress, subProgress, 10);
    expect(purchase).toEqual({
      progress: { 'node-a': 1 },
      subProgress: { 'node-a': 0 },
      pointsSpent: 10,
      levelCompleted: true,
    });
    expect(progress).toEqual({});
    expect(subProgress).toEqual({});
  });

  it('advances sub-progress without completing the level when more installments remain', () => {
    const node = makeNode({ costPerLevel: [[6, 4], [20], [30]] });
    const purchase = purchaseNextInstallment(node, {}, {}, 6);
    expect(purchase).toEqual({
      progress: {},
      subProgress: { 'node-a': 1 },
      pointsSpent: 6,
      levelCompleted: false,
    });
  });

  it('completes the level on the final installment and resets sub-progress', () => {
    const node = makeNode({ costPerLevel: [[6, 4], [20], [30]] });
    const purchase = purchaseNextInstallment(node, {}, { 'node-a': 1 }, 4);
    expect(purchase).toEqual({
      progress: { 'node-a': 1 },
      subProgress: { 'node-a': 0 },
      pointsSpent: 4,
      levelCompleted: true,
    });
  });

  it('increments an already-purchased level', () => {
    const node = makeNode();
    const purchase = purchaseNextInstallment(node, { 'node-a': 1 }, {}, 20);
    expect(purchase).toEqual({
      progress: { 'node-a': 2 },
      subProgress: { 'node-a': 0 },
      pointsSpent: 20,
      levelCompleted: true,
    });
  });
});

describe('currentEffect', () => {
  it('calls effectAtLevel(0) for an unpurchased node', () => {
    const node = makeNode({ effectAtLevel: (level) => level * 100 });
    expect(currentEffect(node, {})).toBe(0);
  });

  it('calls effectAtLevel with the purchased level', () => {
    const node = makeNode({ effectAtLevel: (level) => level * 100 });
    expect(currentEffect(node, { 'node-a': 2 })).toBe(200);
  });
});

describe('totalPointsSpent', () => {
  it('is 0 across nodes with no purchases', () => {
    expect(totalPointsSpent([makeNode()], {})).toBe(0);
  });

  it('sums the cost of every level purchased so far, across nodes', () => {
    const nodeA = makeNode({ id: 'node-a', costPerLevel: [[10], [20], [30]] });
    const nodeB = makeNode({ id: 'node-b', costPerLevel: [[5], [5], [5]] });
    const progress = { 'node-a': 2, 'node-b': 1 };
    // node-a: 10 + 20 = 30, node-b: 5
    expect(totalPointsSpent([nodeA, nodeB], progress)).toBe(35);
  });

  it('includes installments already paid toward an in-progress level', () => {
    const nodeA = makeNode({ id: 'node-a', costPerLevel: [[6, 4], [20], [30]] });
    const progress = { 'node-a': 0 };
    const subProgress = { 'node-a': 1 };
    // level 0 not yet complete, but its first installment (6) is paid
    expect(totalPointsSpent([nodeA], progress, subProgress)).toBe(6);
  });
});
