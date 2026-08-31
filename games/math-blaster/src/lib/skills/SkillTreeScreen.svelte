<script lang="ts">
	import {
		BASE_SKILL_BRANCH_IDS,
		BASE_SKILL_NODES,
		BASE_SKILL_NODE_CATEGORY,
		BASE_SKILL_ROOT_ID,
		isBranchGateId,
		type BaseSkillCategory,
		type BaseSkillEffect
	} from './baseSkillTree';
	import {
		getLevel,
		getInstallmentsPaid,
		installmentsForNextLevel,
		nextInstallmentCost,
		type SkillNode
	} from './SkillTree';
	import type { PlayerProfile } from '../runtime/PlayerProfile';
	import { AUTHORED_GRADES, type GradeLevel } from '../levels/gradeTree';

	interface Props {
		profile: PlayerProfile;
		onPlay: () => void;
		onPurchase: (node: SkillNode<BaseSkillEffect>) => void;
		onSelectGrade: (grade: GradeLevel) => void;
		/** The grade came from the platform, not from the player. The picker
		 * shows what it is and refuses to change it - see `gradeLocked` in
		 * `Game.svelte` for why offering the choice would be a lie. */
		gradeLocked?: boolean;
	}
	let { profile, onPlay, onPurchase, onSelectGrade, gradeLocked = false }: Props = $props();

	/** Only the grades that actually have maths authored for them. Grades 4-12
	 * are typed but unauthored, so offering them would promise content that
	 * doesn't exist. Read from `gradeTree` rather than recomputed here: the
	 * clamp a platform-asserted grade goes through has to agree with what the
	 * picker offers, and two copies of one predicate is how they stop agreeing. */
	const PLAYABLE_GRADES: GradeLevel[] = AUTHORED_GRADES;
	const GRADE_LABELS: Partial<Record<GradeLevel, string>> = { K: 'K' };
	function gradeLabel(grade: GradeLevel): string {
		return GRADE_LABELS[grade] ?? grade;
	}

	const CATEGORY_LABELS: Record<BaseSkillCategory, string> = {
		economy: '💰 Economy',
		movement: '🏃 Movement',
		defense: '🛡 Defense',
		firing: '🎯 Firing',
		active: '⚡ Active Abilities',
		progression: '🚩 Progression'
	};
	const CATEGORY_ORDER: BaseSkillCategory[] = [
		'economy',
		'movement',
		'defense',
		'firing',
		'active',
		'progression'
	];
	const CATEGORY_BRIGHT: Record<BaseSkillCategory, string> = {
		economy: 'var(--accent-warm)',
		movement: 'var(--accent-cyan)',
		defense: 'var(--accent-green)',
		firing: 'var(--accent-hot)',
		active: 'var(--accent-violet)',
		progression: '#a78bfa'
	};
	const ROOT_COLOR = '#f7b955';
	const NODE_ICON: Record<string, string> = {
		'skills-root': '🌟',
		'branch-economy': '💰',
		'branch-movement': '🏃',
		'branch-defense': '🛡',
		'branch-progression': '🚩',
		checkpoint: '🚩',
		'branch-firing': '🎯',
		'branch-active': '⚡',
		bounty: '💰',
		'more-time': '⏱',
		'player-speed': '🏃',
		'enemy-slowdown': '🐌',
		dodge: '🤸',
		armor: '🛡',
		pierce: '🏹',
		burn: '🔥',
		'fire-rate': '🔫',
		bomb: '💣',
		freeze: '❄'
	};

	function nodeColor(node: SkillNode<BaseSkillEffect>): string {
		if (node.id === BASE_SKILL_ROOT_ID) return ROOT_COLOR;
		const category = BASE_SKILL_NODE_CATEGORY[node.id];
		return category ? CATEGORY_BRIGHT[category] : '#94a3b8';
	}

	/** A 1-level node has no meaningful "Level 1/1" to show: the root is
	 * the trunk and the five gates are branches, not upgrades. */
	function levelLabel(node: SkillNode<BaseSkillEffect>, level: number): string {
		if (node.maxLevel > 1) return `Level ${level}/${node.maxLevel}`;
		return isBranchGateId(node.id) ? 'Branch' : 'Trunk';
	}

	function branchOpen(category: BaseSkillCategory): boolean {
		return getLevel(profile.skillProgress, BASE_SKILL_BRANCH_IDS[category]) > 0;
	}

	function describeEffect(effect: BaseSkillEffect): string {
		switch (effect.kind) {
			case 'root':
				return 'Opens the five skill branches.';
			case 'branch':
				return effect.opened
					? 'Branch open - its skills are for sale.'
					: 'Opens this branch of skills.';
			case 'playerSpeed':
				return `Move speed ×${effect.multiplier.toFixed(2)}`;
			case 'enemySpeed':
				return `Enemy fall speed ×${effect.multiplier.toFixed(2)}`;
			case 'dodge':
				return `${Math.round(effect.chance * 100)}% dodge chance`;
			case 'armor':
				return `${Math.round(effect.penaltyReduction * 100)}% less time lost per hit`;
			case 'pierce':
				return `${Math.round(effect.chance * 100)}% pierce chance`;
			case 'burn':
				return `${Math.round(effect.chance * 100)}% burn chance, ${effect.durationSec.toFixed(1)}s slow`;
			case 'fireRate':
				return `${effect.cooldownSec.toFixed(2)}s between shots`;
			case 'bomb':
				return `Clears ${effect.layersStripped} layer${effect.layersStripped === 1 ? '' : 's'}, ${effect.cooldownSec.toFixed(0)}s cooldown`;
			case 'freeze':
				return `${effect.durationSec.toFixed(1)}s freeze, ${effect.cooldownSec.toFixed(0)}s cooldown`;
			case 'bounty':
				return `+${effect.bonusPerKill} currency per kill`;
			case 'moreTime':
				return `+${(effect.bonusMs / 1000).toFixed(0)}s start time`;
			case 'checkpoint':
				return effect.startWave <= 1 ? 'Start from wave 1' : `Start from wave ${effect.startWave}`;
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
		// Anything already owned stays on the diagram even when its parent
		// isn't bought: a profile saved before the branch gates existed has
		// skills bought straight off the root, and hiding those would lose
		// sight of upgrades the player still has (and still benefits from).
		if (pipPurchased(pip)) return true;
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
		/** The child pip this line runs to. One edge per pip, so this is unique. */
		key: string;
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
			if (parentPos) edges.push({ key: pip.key, x1: parentPos.x, y1: parentPos.y, x2: x, y2: y });
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
			layout.nodes.reduce((max, n) => Math.max(max, Math.hypot(n.x, n.y)), 0) +
				NODE_HALF +
				CANVAS_MARGIN
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
			'nw'
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
		onPurchase(pip.node);
		activePipKey = null;
	}
</script>

{#snippet pipBox(entry: LaidOutPip)}
	{@const pip = entry.pip}
	{@const purchased = pipPurchased(pip)}
	{@const maxed = purchased && pip.node.maxLevel > 1 && pip.level === pip.node.maxLevel}
	{@const installments = purchased
		? null
		: installmentsForNextLevel(pip.node, profile.skillProgress)}
	{@const paid = purchased ? 0 : getInstallmentsPaid(profile.skillSubProgress, pip.node.id)}
	<button
		type="button"
		class="pip-box"
		class:root={pip.node.id === BASE_SKILL_ROOT_ID}
		class:branch={isBranchGateId(pip.node.id)}
		class:purchased
		class:maxed
		style="--pip-color: {nodeColor(pip.node)}"
		onclick={() => onPipClick(pip)}
		aria-label="{pip.node.name}, {levelLabel(pip.node, pip.level)}"
	>
		<span class="pip-icon">{NODE_ICON[pip.node.id] ?? '❓'}</span>
		{#if pip.node.maxLevel > 1}<span class="pip-level">{pip.level}</span>{/if}
		{#if maxed}<span class="max-badge">✦</span>{/if}
		{#if installments && installments.length > 1}
			<span class="installment-dots">
				{#each installments as _, i (i)}
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
	{@const cost = purchased
		? null
		: nextInstallmentCost(node, profile.skillProgress, profile.skillSubProgress)}
	<div class="pip-popover dir-{direction}">
		<div class="popover-head">
			<span class="popover-icon">{NODE_ICON[node.id] ?? '❓'}</span>
			<div class="popover-title">
				<strong>{node.name}</strong>
				<span class="popover-level">{levelLabel(node, pip.level)}</span>
			</div>
		</div>
		<p class="popover-desc">{node.description}</p>
		{#if purchased}
			<p class="popover-next">{describeEffect(node.effectAtLevel(pip.level))}</p>
			{#if node.maxLevel === 1}
				<p class="popover-owned">✓ Unlocked</p>
			{:else if pip.level === node.maxLevel}
				<p class="popover-maxed">✦ Fully upgraded ✦</p>
			{:else}
				<p class="popover-owned">✓ Owned</p>
			{/if}
		{:else}
			<p class="popover-next">Next: {describeEffect(node.effectAtLevel(pip.level))}</p>
			{#if installments && installments.length > 1}
				<p class="popover-progress">Buy-out {paid}/{installments.length}</p>
			{/if}
			<button
				type="button"
				class="buy-btn"
				disabled={cost === null || profile.currency < cost}
				onclick={() => purchase(pip)}
			>
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
		{#each CATEGORY_ORDER as category (category)}
			<span class="legend-item" class:locked={!branchOpen(category)}>
				<span class="legend-dot" style="background: {CATEGORY_BRIGHT[category]}"></span>
				{CATEGORY_LABELS[category]}{branchOpen(category) ? '' : ' 🔒'}
			</span>
		{/each}
	</div>

	<div class="radial-viewport" bind:this={viewportEl}>
		<div class="radial-canvas" style="width: {canvasSize}px; height: {canvasSize}px;">
			<svg
				class="tree-lines"
				width={canvasSize}
				height={canvasSize}
				viewBox="0 0 {canvasSize} {canvasSize}"
			>
				{#each layout.edges as edge (edge.key)}
					<line
						x1={halfExtent + edge.x1}
						y1={halfExtent + edge.y1}
						x2={halfExtent + edge.x2}
						y2={halfExtent + edge.y2}
						stroke="var(--edge-strong)"
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
		<div class="grade-picker">
			<span class="grade-label">Grade</span>
			<div
				class="grade-options"
				class:locked={gradeLocked}
				role="radiogroup"
				aria-label="Which grade's maths to practise"
			>
				{#each PLAYABLE_GRADES as grade (grade)}
					<button
						class="grade-btn"
						class:selected={profile.selectedGrade === grade}
						role="radio"
						aria-checked={profile.selectedGrade === grade}
						disabled={gradeLocked}
						onclick={() => onSelectGrade(grade)}>{gradeLabel(grade)}</button
					>
				{/each}
			</div>
			{#if gradeLocked}
				<span class="grade-note">from your account</span>
			{/if}
		</div>
		<button class="play-btn" onclick={onPlay}>Play ▶</button>
	</div>
</div>

<style>
	.grade-options.locked .grade-btn {
		cursor: default;
		opacity: 0.55;
	}
	/* The chosen grade stays fully legible when locked - the point is to show
     what it is, not to grey out the answer along with the controls. */
	.grade-options.locked .grade-btn.selected {
		opacity: 1;
	}
	.grade-note {
		font-size: 0.5rem;
		opacity: 0.6;
		white-space: nowrap;
	}

	.skill-tree-screen {
		display: flex;
		flex-direction: column;
		min-height: 420px;
		max-height: 70vh;
		background: var(--surface);
		border: 4px solid var(--edge);
		border-radius: 14px;
		overflow: hidden;
	}

	.grade-picker {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.grade-label {
		font-size: 11px;
		font-weight: 700;
		opacity: 0.8;
	}
	.grade-options {
		display: flex;
		gap: 4px;
	}
	.grade-btn {
		min-width: 30px;
		height: 30px;
		border: 2px solid var(--edge);
		border-radius: 7px;
		background: var(--surface-alt);
		color: var(--text);
		font-family: 'Press Start 2P', monospace;
		font-size: 10px;
		cursor: pointer;
	}
	.grade-btn.selected {
		background: var(--accent-warm);
		color: var(--bg);
	}

	.tree-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		background: var(--surface-alt);
		color: var(--accent-warm);
		border-bottom: 3px solid var(--edge);
	}
	.tree-header h2 {
		font-family: 'Press Start 2P', monospace;
		font-size: 13px;
		margin: 0;
	}
	.currency-badge {
		font-family: 'Press Start 2P', monospace;
		font-size: 12px;
		background: var(--surface-alt);
		border: 2px solid var(--edge);
		border-radius: 8px;
		padding: 4px 8px;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 16px;
		padding: 8px 14px;
		border-bottom: 2px solid var(--edge);
		font-family: 'Press Start 2P', monospace;
		font-size: 8px;
	}
	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		opacity: 0.85;
	}
	/* A branch the player hasn't paid to open yet - its skills aren't on
   * the diagram at all, so say so rather than leaving a gap. */
	.legend-item.locked {
		opacity: 0.4;
	}
	.legend-item.locked .legend-dot {
		background: #55637f !important;
	}
	.legend-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		border: 1px solid var(--edge-strong);
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
		border: 3px solid var(--edge);
		background: #26314c;
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
	/* Branch gates sit between the root and the skills in the hierarchy
   * and read that way: bigger than a skill bead, and once open they get
   * an inner ring instead of a level number. */
	.pip-box.branch {
		width: 68px;
		height: 68px;
		border-width: 4px;
	}
	.pip-box.branch .pip-icon {
		font-size: 25px;
	}
	.pip-box.branch.purchased {
		box-shadow:
			0 3px 0 rgba(0, 0, 0, 0.25),
			inset 0 0 0 3px rgba(255, 255, 255, 0.6);
	}
	.pip-box.purchased,
	.pip-box.maxed {
		background: var(--pip-color);
		filter: none;
		opacity: 1;
	}
	.pip-box.maxed {
		box-shadow:
			0 3px 0 rgba(0, 0, 0, 0.25),
			0 0 0 3px var(--accent-warm);
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
		color: var(--accent-warm);
		text-shadow: 0 0 2px var(--bg);
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
		border: 1px solid rgba(230, 237, 249, 0.45);
		background: transparent;
	}
	.dot.filled {
		background: var(--text);
		border-color: var(--text);
	}

	.pip-popover {
		position: absolute;
		width: 190px;
		background: var(--tooltip);
		color: var(--text);
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
		border-top-color: var(--tooltip);
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
		border-bottom-color: var(--tooltip);
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
		border-right-color: var(--tooltip);
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
		border-left-color: var(--tooltip);
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
		color: var(--accent-warm);
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
		color: var(--accent-warm);
		text-align: center;
		font-weight: 700;
	}
	.buy-btn {
		font-family: 'Press Start 2P', monospace;
		font-size: 10px;
		padding: 8px;
		background: var(--accent-green);
		color: var(--bg);
		border: 2px solid rgba(6, 10, 22, 0.45);
		border-radius: 6px;
		cursor: pointer;
	}
	.buy-btn:disabled {
		background: #2a3550;
		color: #6c7c9c;
		cursor: not-allowed;
	}

	.tree-footer {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		justify-content: space-between;
		padding: 10px 14px;
		border-top: 3px solid var(--edge);
		background: var(--surface);
	}
	.play-btn {
		font-family: 'Press Start 2P', monospace;
		font-size: 13px;
		padding: 10px 20px;
		background: var(--accent-hot);
		color: #fff;
		border: 3px solid var(--edge);
		border-radius: 10px;
		cursor: pointer;
		box-shadow: 0 4px 0 rgba(0, 0, 0, 0.3);
	}
	.play-btn:active {
		transform: translateY(3px);
		box-shadow: 0 1px 0 rgba(0, 0, 0, 0.3);
	}
</style>
