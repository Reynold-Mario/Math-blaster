/**
 * Generic, content-free skill-tree mechanics: nodes with per-level costs
 * and prerequisites, and pure functions to check and apply purchases. Both
 * the Base (combat) tree and the Grade (curriculum) tree are built on top
 * of this - this file has no opinion on what an "effect" actually does.
 */

export interface SkillPrerequisite {
  nodeId: string;
  requiredLevel: number;
}

export interface SkillNode<TEffect> {
  id: string;
  name: string;
  description: string;
  maxLevel: number;
  /** Cost of each level, broken into the ordered installments needed to
   * pay it off - costPerLevel[0] is the level 0->1 installments; summed,
   * they're that level's total price. A node can use a different
   * installment count at different levels (a single-entry array just
   * means "one purchase completes this level"). */
  costPerLevel: number[][];
  prerequisites: SkillPrerequisite[];
  /** The effect granted at a given purchased level. effectAtLevel(0)
   * should represent "not yet purchased". */
  effectAtLevel: (level: number) => TEffect;
}

/** How far a player has progressed through a tree - purchased (completed)
 * levels keyed by node id. A node id absent from this map is at level 0. */
export type SkillProgress = Record<string, number>;

/** Installments already paid toward each node's NEXT level - keyed by
 * node id. Absent/0 means none paid yet; resets to 0 the instant a level
 * completes (the paid installment carries the node to the next level
 * instead of accumulating here). */
export type SkillSubProgress = Record<string, number>;

export function getLevel(progress: SkillProgress, nodeId: string): number {
  return progress[nodeId] ?? 0;
}

export function getInstallmentsPaid(subProgress: SkillSubProgress, nodeId: string): number {
  return subProgress[nodeId] ?? 0;
}

/** True when every prerequisite is met, regardless of whether the node
 * itself has any levels left to purchase or points available. A node with
 * no prerequisites is always unlocked. */
export function isUnlocked<TEffect>(node: SkillNode<TEffect>, progress: SkillProgress): boolean {
  return node.prerequisites.every((p) => getLevel(progress, p.nodeId) >= p.requiredLevel);
}

/** The ordered installment costs still needed to complete this node's next
 * level, or null once the node is already maxed out. */
export function installmentsForNextLevel<TEffect>(
  node: SkillNode<TEffect>,
  progress: SkillProgress
): number[] | null {
  const level = getLevel(progress, node.id);
  if (level >= node.maxLevel) return null;
  return node.costPerLevel[level];
}

/** Cost of the single next installment payable right now, or null if the
 * node is already maxed out. */
export function nextInstallmentCost<TEffect>(
  node: SkillNode<TEffect>,
  progress: SkillProgress,
  subProgress: SkillSubProgress
): number | null {
  const installments = installmentsForNextLevel(node, progress);
  if (!installments) return null;
  return installments[getInstallmentsPaid(subProgress, node.id)];
}

export function canPurchaseNextInstallment<TEffect>(
  node: SkillNode<TEffect>,
  progress: SkillProgress,
  subProgress: SkillSubProgress,
  availablePoints: number
): boolean {
  if (!isUnlocked(node, progress)) return false;
  const cost = nextInstallmentCost(node, progress, subProgress);
  return cost !== null && availablePoints >= cost;
}

export interface InstallmentPurchaseResult {
  progress: SkillProgress;
  subProgress: SkillSubProgress;
  pointsSpent: number;
  /** True when this installment was the last one needed - the node's
   * level just advanced. */
  levelCompleted: boolean;
}

/** Attempts to pay the next installment toward a node's next level.
 * Neither input is mutated. Returns null if the purchase isn't currently
 * possible (locked, maxed out, or underfunded). When the installment
 * completes the level, subProgress for that node resets to 0 and progress
 * advances by one level; otherwise only subProgress moves. */
export function purchaseNextInstallment<TEffect>(
  node: SkillNode<TEffect>,
  progress: SkillProgress,
  subProgress: SkillSubProgress,
  availablePoints: number
): InstallmentPurchaseResult | null {
  if (!canPurchaseNextInstallment(node, progress, subProgress, availablePoints)) return null;
  const cost = nextInstallmentCost(node, progress, subProgress)!;
  const installments = installmentsForNextLevel(node, progress)!;
  const paid = getInstallmentsPaid(subProgress, node.id) + 1;
  if (paid >= installments.length) {
    const level = getLevel(progress, node.id);
    return {
      progress: { ...progress, [node.id]: level + 1 },
      subProgress: { ...subProgress, [node.id]: 0 },
      pointsSpent: cost,
      levelCompleted: true,
    };
  }
  return {
    progress,
    subProgress: { ...subProgress, [node.id]: paid },
    pointsSpent: cost,
    levelCompleted: false,
  };
}

/** The effect a node currently grants, given how far it's been
 * purchased. */
export function currentEffect<TEffect>(node: SkillNode<TEffect>, progress: SkillProgress): TEffect {
  return node.effectAtLevel(getLevel(progress, node.id));
}

/** Total points already spent across every node in a tree - completed
 * levels in full, plus any installments already paid toward a node's
 * in-progress level. Useful for a "points invested" display. */
export function totalPointsSpent<TEffect>(
  nodes: SkillNode<TEffect>[],
  progress: SkillProgress,
  subProgress: SkillSubProgress = {}
): number {
  return nodes.reduce((sum, node) => {
    const level = getLevel(progress, node.id);
    const completed = node.costPerLevel
      .slice(0, level)
      .reduce((s, installments) => s + installments.reduce((a, b) => a + b, 0), 0);
    const partial =
      level < node.maxLevel
        ? node.costPerLevel[level].slice(0, getInstallmentsPaid(subProgress, node.id)).reduce((a, b) => a + b, 0)
        : 0;
    return sum + completed + partial;
  }, 0);
}
