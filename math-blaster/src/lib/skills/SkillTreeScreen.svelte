<script lang="ts">
  import {
    BASE_SKILL_NODES,
    BASE_SKILL_NODE_CATEGORY,
    BASE_SKILL_ROOT_ID,
    type BaseSkillCategory,
    type BaseSkillEffect,
  } from './baseSkillTree';
  import {
    getLevel,
    getInstallmentsPaid,
    installmentsForNextLevel,
    nextInstallmentCost,
    purchaseNextInstallment,
    type SkillNode,
  } from './SkillTree';
  import type { PlayerProfile } from '../runtime/PlayerProfile';
  import { savePlayerProfile } from '../runtime/PlayerProfile';

  interface Props {
    profile: PlayerProfile;
    onPlay: () => void;
  }
  let { profile, onPlay }: Props = $props();

  const CATEGORY_LABELS: Record<BaseSkillCategory, string> = {
    economy: '💰 Economy',
    movement: '🏃 Movement',
    defense: '🛡 Defense',
    firing: '🎯 Firing',
    active: '⚡ Active Abilities',
  };
  const CATEGORY_ORDER: BaseSkillCategory[] = ['economy', 'movement', 'defense', 'firing', 'active'];
  const CATEGORY_BRIGHT: Record<BaseSkillCategory, string> = {
    economy: 'var(--marquee-yellow)',
    movement: 'var(--accent-blue)',
    defense: 'var(--accent-green)',
    firing: 'var(--marquee-red)',
    active: 'var(--accent-pink)',
  };
  const ROOT_COLOR = '#f4d35e';
  const NODE_ICON: Record<string, string> = {
    'skills-root': '🌟',
    bounty: '💰',
    'more-time': '⏱',
    'player-speed': '🏃',
    'enemy-slowdown': '🐌',
    'health-pool': '❤️',
    dodge: '🤸',
    armor: '🛡',
    pierce: '🏹',
    burn: '🔥',
    'fire-rate': '🔫',
    bomb: '💣',
    freeze: '❄',
  };

  function nodeColor(node: SkillNode<BaseSkillEffect>): string {
    if (node.id === BASE_SKILL_ROOT_ID) return ROOT_COLOR;
    const category = BASE_SKILL_NODE_CATEGORY[node.id];
    return category ? CATEGORY_BRIGHT[category] : '#94a3b8';
  }

  function describeEffect(effect: BaseSkillEffect): string {
    switch (effect.kind) {
      case 'root':
        return 'Unlocks the rest of the tree.';
      case 'playerSpeed':
        return `Move speed ×${effect.multiplier.toFixed(2)}`;
      case 'enemySpeed':
        return `Enemy fall speed ×${effect.multiplier.toFixed(2)}`;
      case 'health':
        return `+${(effect.bonusTimeMs / 1000).toFixed(0)}s start time (enemies ×${effect.enemyHpMultiplier.toFixed(2)} HP)`;
      case 'dodge':
        return `${Math.round(effect.chance * 100)}% dodge chance`;
      case 'armor':
        return `${Math.round(effect.damageReduction * 100)}% less time lost per hit`;
      case 'pierce':
        return `${Math.round(effect.chance * 100)}% pierce chance`;
      case 'burn':
        return `${Math.round(effect.chance * 100)}% burn chance, ${effect.durationSec.toFixed(1)}s slow`;
      case 'fireRate':
        return `${effect.cooldownSec.toFixed(2)}s between shots`;
      case 'bomb':
        return `${effect.damage} dmg blast, ${effect.cooldownSec.toFixed(0)}s cooldown`;
      case 'freeze':
        return `${effect.durationSec.toFixed(1)}s freeze, ${effect.cooldownSec.toFixed(0)}s cooldown`;
      case 'bounty':
        return `+${effect.bonusPerKill} currency per kill`;
      case 'moreTime':
        return `+${(effect.bonusMs / 1000).toFixed(0)}s start time`;
    }
  }

  /** One purchasable bead in the radial diagram: a single level of a
   * single node. A node's own levels chain outward from each other
   * (bounty#1 -> bounty#2 -> ...); a node with a prerequisite instead
   * chains outward from whichever bead satisfies that prerequisite
   * (armor#1's parent is dodge#1) - that's what makes the tree fork. */
  interface Pip {
    key: string;
    node: SkillNode<BaseSkillEffect>;
    level: number;
    parentKey: string | null;
  }

  function buildPips(nodes: SkillNode<BaseSkillEffect>[]): Map<string, Pip> {
    const pips = new Map<string, Pip>();
    for (const node of nodes) {
      for (let level = 1; level <= node.maxLevel; level++) {
        const key = `${node.id}#${level}`;
        let parentKey: string | null;
        if (level > 1) {
          parentKey = `${node.id}#${level - 1}`;
        } else if (node.prerequisites.length > 0) {
          const first = node.prerequisites[0];
          parentKey = `${first.nodeId}#${first.requiredLevel}`;
        } else {
          parentKey = null;
        }
        pips.set(key, { key, node, level, parentKey });
      }
    }
    return pips;
  }

  const ALL_PIPS = buildPips(BASE_SKILL_NODES);
  const ROOT_PIP = ALL_PIPS.get(`${BASE_SKILL_ROOT_ID}#1`)!;
  const CHILDREN_OF = new Map<string | null, Pip[]>();
  for (const pip of ALL_PIPS.values()) {
    const list = CHILDREN_OF.get(pip.parentKey) ?? [];
    list.push(pip);
    CHILDREN_OF.set(pip.parentKey, list);
  }

  function pipPurchased(pip: Pip): boolean {
    return getLevel(profile.skillProgress, pip.node.id) >= pip.level;
  }
  /** A bead renders once its parent bead is bought (or it's the root,
   * which has none) - the diagram grows one bead at a time as the player
   * invests, instead of showing the whole potential tree up front. */
  function pipVisible(pip: Pip): boolean {
    if (pip.parentKey === null) return true;
    const parent = ALL_PIPS.get(pip.parentKey);
    return parent !== undefined && pipPurchased(parent);
  }
  function visibleChildrenOf(pip: Pip): Pip[] {
    return (CHILDREN_OF.get(pip.key) ?? []).filter(pipVisible);
  }
  function leafWeight(pip: Pip): number {
    const children = visibleChildrenOf(pip);
    if (children.length === 0) return 1;
    return children.reduce((sum, c) => sum + leafWeight(c), 0);
  }

  interface LaidOutPip {
    pip: Pip;
    x: number;
    y: number;
    angleDeg: number;
    depth: number;
  }
  interface Edge {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }

  const RING_OFFSET = 30;
  const RING_STEP = 100;
  function radiusForDepth(depth: number): number {
    return depth === 0 ? 0 : RING_OFFSET + depth * RING_STEP;
  }

  /** Angular breathing room between sibling branches, so a bead's whole
   * sector reads as a distinct spoke instead of the ring looking like one
   * solid wall of pips right after the node feeding them is purchased. */
  const SIBLING_GAP_DEG = 5;

  const layout = $derived.by(() => {
    const nodes: LaidOutPip[] = [];
    const edges: Edge[] = [];
    function place(
      pip: Pip,
      depth: number,
      startAngle: number,
      endAngle: number,
      parentPos: { x: number; y: number } | null
    ) {
      const angleDeg = depth === 0 ? 0 : (startAngle + endAngle) / 2;
      const radius = radiusForDepth(depth);
      const rad = (angleDeg * Math.PI) / 180;
      const x = radius * Math.sin(rad);
      const y = -radius * Math.cos(rad);
      nodes.push({ pip, x, y, angleDeg, depth });
      if (parentPos) edges.push({ x1: parentPos.x, y1: parentPos.y, x2: x, y2: y });
      const children = visibleChildrenOf(pip);
      if (children.length === 0) return;
      const weights = children.map(leafWeight);
      const total = weights.reduce((a, b) => a + b, 0);
      const totalGap = children.length > 1 ? SIBLING_GAP_DEG * (children.length - 1) : 0;
      const usableSpan = Math.max(0, endAngle - startAngle - totalGap);
      let cursor = startAngle;
      for (let i = 0; i < children.length; i++) {
        const span = usableSpan * (weights[i] / total);
        place(children[i], depth + 1, cursor, cursor + span, { x, y });
        cursor += span + SIBLING_GAP_DEG;
      }
    }
    place(ROOT_PIP, 0, 0, 360, null);
    return { nodes, edges };
  });

  const NODE_HALF = 38;
  const CANVAS_MARGIN = 40;
  const MIN_HALF_EXTENT = 200;
  const halfExtent = $derived(
    Math.max(
      MIN_HALF_EXTENT,
      layout.nodes.reduce((max, n) => Math.max(max, Math.hypot(n.x, n.y)), 0) + NODE_HALF + CANVAS_MARGIN
    )
  );
  const canvasSize = $derived(halfExtent * 2);

  let viewportEl: HTMLDivElement | undefined = $state();
  $effect(() => {
    void canvasSize;
    const el = viewportEl;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
      el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
    });
  });

  /** Which side of a bead its popover should open on - always the side
   * facing back toward the tree's center, so the bubble grows inward
   * instead of running off the edge of the game border. */
  function compassDirection(angleDeg: number): 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw' {
    const sectors: Array<'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'> = [
      'n',
      'ne',
      'e',
      'se',
      's',
      'sw',
      'w',
      'nw',
    ];
    const toward = (((angleDeg + 180) % 360) + 360) % 360;
    return sectors[Math.round(toward / 45) % 8];
  }

  let activePipKey = $state<string | null>(null);

  /** Clicking a bead opens its bubble; clicking the same bead again closes
   * it, clicking a different one switches straight to that bead's bubble. */
  function onPipClick(pip: Pip) {
    activePipKey = activePipKey === pip.key ? null : pip.key;
  }

  function purchase(pip: Pip) {
    const result = purchaseNextInstallment(pip.node, profile.skillProgress, profile.skillSubProgress, profile.currency);
    if (!result) return;
    profile.skillProgress = result.progress;
    profile.skillSubProgress = result.subProgress;
    profile.currency -= result.pointsSpent;
    savePlayerProfile(profile);
    activePipKey = null;
  }
</script>

{#snippet pipBox(entry: LaidOutPip)}
  {@const pip = entry.pip}
  {@const purchased = pipPurchased(pip)}
  {@const maxed = purchased && pip.level === pip.node.maxLevel}
  {@const installments = purchased ? null : installmentsForNextLevel(pip.node, profile.skillProgress)}
  {@const paid = purchased ? 0 : getInstallmentsPaid(profile.skillSubProgress, pip.node.id)}
  <button
    type="button"
    class="pip-box"
    class:root={pip.node.id === BASE_SKILL_ROOT_ID}
    class:purchased
    class:maxed
    style="--pip-color: {nodeColor(pip.node)}"
    onclick={() => onPipClick(pip)}
    aria-label="{pip.node.name}, level {pip.level} of {pip.node.maxLevel}"
  >
    <span class="pip-icon">{NODE_ICON[pip.node.id] ?? '❓'}</span>
    <span class="pip-level">{pip.level}</span>
    {#if maxed}<span class="max-badge">✦</span>{/if}
    {#if installments && installments.length > 1}
      <span class="installment-dots">
        {#each installments as _, i}
          <span class="dot" class:filled={i < paid}></span>
        {/each}
      </span>
    {/if}
  </button>
{/snippet}

{#snippet popover(entry: LaidOutPip)}
  {@const pip = entry.pip}
  {@const node = pip.node}
  {@const purchased = pipPurchased(pip)}
  {@const direction = compassDirection(entry.angleDeg)}
  {@const installments = purchased ? null : installmentsForNextLevel(node, profile.skillProgress)}
  {@const paid = purchased ? 0 : getInstallmentsPaid(profile.skillSubProgress, node.id)}
  {@const cost = purchased ? null : nextInstallmentCost(node, profile.skillProgress, profile.skillSubProgress)}
  <div class="pip-popover dir-{direction}">
    <div class="popover-head">
      <span class="popover-icon">{NODE_ICON[node.id] ?? '❓'}</span>
      <div class="popover-title">
        <strong>{node.name}</strong>
        <span class="popover-level">Level {pip.level}/{node.maxLevel}</span>
      </div>
    </div>
    <p class="popover-desc">{node.description}</p>
    {#if purchased}
      <p class="popover-next">{describeEffect(node.effectAtLevel(pip.level))}</p>
      {#if pip.level === node.maxLevel}
        <p class="popover-maxed">✦ Fully upgraded ✦</p>
      {:else}
        <p class="popover-owned">✓ Owned</p>
      {/if}
    {:else}
      <p class="popover-next">Next: {describeEffect(node.effectAtLevel(pip.level))}</p>
      {#if installments && installments.length > 1}
        <p class="popover-progress">Buy-out {paid}/{installments.length}</p>
      {/if}
      <button type="button" class="buy-btn" disabled={cost === null || profile.currency < cost} onclick={() => purchase(pip)}>
        Buy 💰{cost}
      </button>
    {/if}
  </div>
{/snippet}

<div class="skill-tree-screen">
  <div class="tree-header">
    <h2>Skill Tree</h2>
    <div class="currency-badge">💰 {profile.currency}</div>
  </div>

  <div class="legend">
    {#each CATEGORY_ORDER as category}
      <span class="legend-item">
        <span class="legend-dot" style="background: {CATEGORY_BRIGHT[category]}"></span>
        {CATEGORY_LABELS[category]}
      </span>
    {/each}
  </div>

  <div class="radial-viewport" bind:this={viewportEl}>
    <div class="radial-canvas" style="width: {canvasSize}px; height: {canvasSize}px;">
      <svg class="tree-lines" width={canvasSize} height={canvasSize} viewBox="0 0 {canvasSize} {canvasSize}">
        {#each layout.edges as edge}
          <line
            x1={halfExtent + edge.x1}
            y1={halfExtent + edge.y1}
            x2={halfExtent + edge.x2}
            y2={halfExtent + edge.y2}
            stroke="var(--ink)"
            stroke-width="3"
          />
        {/each}
      </svg>
      {#each layout.nodes as entry (entry.pip.key)}
        <div class="pip-wrap" style="left: calc(50% + {entry.x}px); top: calc(50% + {entry.y}px);">
          {@render pipBox(entry)}
          {#if activePipKey === entry.pip.key}
            {@render popover(entry)}
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <div class="tree-footer">
    <button class="play-btn" onclick={onPlay}>Play ▶</button>
  </div>
</div>

<style>
  .skill-tree-screen {
    display: flex;
    flex-direction: column;
    min-height: 420px;
    max-height: 70vh;
    background: var(--panel);
    border: 4px solid var(--ink);
    border-radius: 14px;
    overflow: hidden;
  }

  .tree-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: var(--marquee-yellow);
    border-bottom: 3px solid var(--ink);
  }
  .tree-header h2 {
    font-family: 'Press Start 2P', monospace;
    font-size: 13px;
    margin: 0;
  }
  .currency-badge {
    font-family: 'Press Start 2P', monospace;
    font-size: 12px;
    background: #fff;
    border: 2px solid var(--ink);
    border-radius: 8px;
    padding: 4px 8px;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
    padding: 8px 14px;
    border-bottom: 2px solid var(--ink);
    font-family: 'Press Start 2P', monospace;
    font-size: 8px;
  }
  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    opacity: 0.85;
  }
  .legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1px solid var(--ink);
  }

  .radial-viewport {
    flex: 1;
    overflow: auto;
    display: flex;
    /* Plain `center` on a scrollable flex container clamps negative scroll
     * offsets to 0, permanently hiding any overflow before the centered
     * content (e.g. branches to the left of root) - `safe center` keeps
     * centering when everything fits, but falls back to start-aligned
     * once content overflows, so every pip stays reachable by scrolling. */
    align-items: safe center;
    justify-content: safe center;
    min-height: 300px;
  }
  .radial-canvas {
    position: relative;
    flex-shrink: 0;
  }
  .tree-lines {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }

  .pip-wrap {
    position: absolute;
    transform: translate(-50%, -50%);
  }
  .pip-wrap:has(.pip-popover) {
    z-index: 50;
  }

  .pip-box {
    position: relative;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    border: 3px solid var(--ink);
    background: #cbd5e1;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    padding: 0;
    box-shadow: 0 3px 0 rgba(0, 0, 0, 0.25);
    filter: grayscale(0.7);
    opacity: 0.9;
  }
  .pip-box:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.25);
  }
  .pip-box.root {
    width: 76px;
    height: 76px;
    border-width: 4px;
  }
  .pip-box.purchased,
  .pip-box.maxed {
    background: var(--pip-color);
    filter: none;
    opacity: 1;
  }
  .pip-box.maxed {
    box-shadow: 0 3px 0 rgba(0, 0, 0, 0.25), 0 0 0 3px var(--marquee-yellow);
  }
  .pip-icon {
    font-size: 20px;
    line-height: 1;
  }
  .pip-box.root .pip-icon {
    font-size: 28px;
  }
  .pip-level {
    font-family: 'Press Start 2P', monospace;
    font-size: 8px;
    line-height: 1;
  }
  .max-badge {
    position: absolute;
    top: -8px;
    right: -8px;
    font-size: 13px;
    color: var(--marquee-yellow);
    text-shadow: 0 0 2px var(--ink);
  }
  .installment-dots {
    position: absolute;
    bottom: -10px;
    display: flex;
    gap: 3px;
  }
  .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    border: 1px solid rgba(20, 33, 61, 0.4);
    background: #fff;
  }
  .dot.filled {
    background: var(--ink);
    border-color: var(--ink);
  }

  .pip-popover {
    position: absolute;
    width: 190px;
    background: var(--ink);
    color: #fff;
    padding: 10px 12px;
    border-radius: 10px;
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    z-index: 30;
    box-shadow: 0 4px 0 rgba(0, 0, 0, 0.3);
    text-align: left;
  }
  .pip-popover.dir-n {
    bottom: calc(100% + 12px);
    left: 50%;
    transform: translateX(-50%);
  }
  .pip-popover.dir-n::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 6px solid transparent;
    border-top-color: var(--ink);
  }
  .pip-popover.dir-s {
    top: calc(100% + 12px);
    left: 50%;
    transform: translateX(-50%);
  }
  .pip-popover.dir-s::after {
    content: '';
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 6px solid transparent;
    border-bottom-color: var(--ink);
  }
  .pip-popover.dir-e {
    left: calc(100% + 12px);
    top: 50%;
    transform: translateY(-50%);
  }
  .pip-popover.dir-e::after {
    content: '';
    position: absolute;
    right: 100%;
    top: 50%;
    transform: translateY(-50%);
    border: 6px solid transparent;
    border-right-color: var(--ink);
  }
  .pip-popover.dir-w {
    right: calc(100% + 12px);
    top: 50%;
    transform: translateY(-50%);
  }
  .pip-popover.dir-w::after {
    content: '';
    position: absolute;
    left: 100%;
    top: 50%;
    transform: translateY(-50%);
    border: 6px solid transparent;
    border-left-color: var(--ink);
  }
  .pip-popover.dir-ne {
    bottom: calc(100% + 8px);
    left: calc(100% - 14px);
  }
  .pip-popover.dir-nw {
    bottom: calc(100% + 8px);
    right: calc(100% - 14px);
  }
  .pip-popover.dir-se {
    top: calc(100% + 8px);
    left: calc(100% - 14px);
  }
  .pip-popover.dir-sw {
    top: calc(100% + 8px);
    right: calc(100% - 14px);
  }

  .popover-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .popover-icon {
    font-size: 20px;
  }
  .popover-title {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }
  .popover-level {
    font-size: 10px;
    opacity: 0.75;
  }
  .popover-desc {
    opacity: 0.9;
  }
  .popover-next {
    color: var(--marquee-yellow);
  }
  .popover-progress {
    opacity: 0.75;
    font-size: 10px;
  }
  .popover-owned {
    opacity: 0.85;
    font-size: 11px;
  }
  .popover-maxed {
    color: var(--marquee-yellow);
    text-align: center;
    font-weight: 700;
  }
  .buy-btn {
    font-family: 'Press Start 2P', monospace;
    font-size: 10px;
    padding: 8px;
    background: var(--accent-green);
    color: var(--ink);
    border: 2px solid #fff;
    border-radius: 6px;
    cursor: pointer;
  }
  .buy-btn:disabled {
    background: #64748b;
    color: #cbd5e1;
    cursor: not-allowed;
  }

  .tree-footer {
    display: flex;
    justify-content: flex-end;
    padding: 10px 14px;
    border-top: 3px solid var(--ink);
    background: var(--panel);
  }
  .play-btn {
    font-family: 'Press Start 2P', monospace;
    font-size: 13px;
    padding: 10px 20px;
    background: var(--marquee-red);
    color: #fff;
    border: 3px solid var(--ink);
    border-radius: 10px;
    cursor: pointer;
    box-shadow: 0 4px 0 rgba(0, 0, 0, 0.3);
  }
  .play-btn:active {
    transform: translateY(3px);
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.3);
  }
</style>
