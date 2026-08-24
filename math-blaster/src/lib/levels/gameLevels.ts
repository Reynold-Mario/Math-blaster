import type { Curriculum, LevelDefinition } from './LevelDefinition';
import { cumulativeScope } from './LevelDefinition';
import type { WavePlan } from './waves';

// Fall speeds throughout are markedly slower than the flat-grunt era they
// were tuned for. Enemies now weave, dive, hide behind shields and take
// more than one problem to bring down; a screen of those arriving at the
// old speeds is unreadable rather than hard. Slower descent is what buys
// the player time to actually read a formation and choose a target.

const WORLD_K = 'World 1 · Sprout Garden';
const WORLD_G1 = 'World 2 · Sunny Meadow';
const WORLD_G2 = 'World 3 · Golden Fields';
const WORLD_G3 = 'World 4 · Whispering Forest';

const kCurriculum: Curriculum = { operations: ['+', '-'], numberRange: [1, 5] };
const meadowCurriculum: Curriculum = { operations: ['+', '-'], numberRange: [1, 10] };
const caveCurriculum: Curriculum = { operations: ['+', '-'], numberRange: [10, 20] };
const g2aCurriculum: Curriculum = { operations: ['+', '-'], numberRange: [1, 100] };
const g2bCurriculum: Curriculum = { operations: ['×'], numberRange: [2, 3] };
const forestCurriculum: Curriculum = { operations: ['×'], numberRange: [2, 5] };
const skyCurriculum: Curriculum = { operations: ['×', '÷'], numberRange: [6, 10] };

// Every plan opens with one or two introductory waves and loops from
// index 1, so the gentlest wave is only ever seen once - a level that
// runs long escalates instead of resetting to its own tutorial.

const kWaves: WavePlan = {
  waves: [
    { shape: 'line', archetypes: ['drifter'], gapSec: 3.4 },
    { shape: 'line', archetypes: ['drifter', 'drifter'], gapSec: 4.0 },
    { shape: 'vee', archetypes: ['drifter', 'drifter', 'drifter'], gapSec: 4.8, staggerPct: 7 },
  ],
  loopFrom: 1,
};

const meadowWaves: WavePlan = {
  waves: [
    { shape: 'line', archetypes: ['drifter', 'drifter'], gapSec: 3.4 },
    { shape: 'line', archetypes: ['weaver'], gapSec: 3.0 },
    { shape: 'vee', archetypes: ['drifter', 'weaver', 'drifter'], gapSec: 4.4, staggerPct: 8 },
    { shape: 'pincer', archetypes: ['weaver', 'weaver'], gapSec: 4.0 },
  ],
  loopFrom: 1,
};

const caveWaves: WavePlan = {
  waves: [
    { shape: 'line', archetypes: ['weaver', 'weaver'], gapSec: 3.2 },
    { shape: 'column', archetypes: ['diver', 'diver'], gapSec: 3.6, staggerPct: 12 },
    { shape: 'pincer', archetypes: ['weaver', 'diver', 'weaver', 'diver'], gapSec: 4.6 },
    { shape: 'scatter', archetypes: ['diver', 'weaver', 'weaver'], gapSec: 4.0, staggerPct: 10 },
  ],
  loopFrom: 1,
};

const centuryWaves: WavePlan = {
  waves: [
    { shape: 'line', archetypes: ['drifter', 'weaver'], gapSec: 3.2 },
    { shape: 'line', archetypes: ['splitter'], gapSec: 3.8 },
    { shape: 'vee', archetypes: ['weaver', 'splitter', 'weaver'], gapSec: 4.6, staggerPct: 8 },
    { shape: 'scatter', archetypes: ['diver', 'splitter'], gapSec: 4.2, staggerPct: 10 },
  ],
  loopFrom: 1,
};

const groveWaves: WavePlan = {
  waves: [
    { shape: 'line', archetypes: ['bulwark'], gapSec: 3.8 },
    { shape: 'line', archetypes: ['drifter', 'bulwark'], gapSec: 4.2 },
    { shape: 'vee', archetypes: ['weaver', 'bulwark', 'weaver'], gapSec: 4.8, staggerPct: 9 },
    { shape: 'pincer', archetypes: ['splitter', 'bulwark'], gapSec: 4.6 },
  ],
  loopFrom: 1,
};

const forestWaves: WavePlan = {
  waves: [
    { shape: 'line', archetypes: ['bulwark', 'weaver'], gapSec: 3.6 },
    { shape: 'line', archetypes: ['sentinel'], gapSec: 4.2 },
    { shape: 'vee', archetypes: ['spore', 'sentinel', 'spore'], gapSec: 4.8, staggerPct: 8 },
    { shape: 'scatter', archetypes: ['diver', 'bulwark', 'weaver'], gapSec: 4.4, staggerPct: 11 },
  ],
  loopFrom: 1,
};

const skyWaves: WavePlan = {
  waves: [
    { shape: 'pincer', archetypes: ['weaver', 'weaver'], gapSec: 3.2 },
    { shape: 'vee', archetypes: ['diver', 'sentinel', 'diver'], gapSec: 4.6, staggerPct: 9 },
    { shape: 'column', archetypes: ['bulwark', 'bulwark'], gapSec: 4.0, staggerPct: 13 },
    { shape: 'scatter', archetypes: ['splitter', 'weaver', 'diver', 'sentinel'], gapSec: 5.0, staggerPct: 12 },
  ],
  loopFrom: 1,
};

// --- World 1: Kindergarten ---

export const k1: LevelDefinition = {
  id: 'k1',
  name: 'Sprout Sums',
  world: WORLD_K,
  theme: { name: 'Sprout Garden', sky1: '#bbf7d0', sky2: '#fef9c3', ground: '#86efac' },
  curriculum: kCurriculum,
  arcadeDifficulty: { fallSpeed: [8, 12], maxConcurrent: 3 },
  waves: kWaves,
  enemiesToClear: 5,
};

// --- World 2: Grade 1 ---

export const l1: LevelDefinition = {
  id: 'l1',
  name: 'Meadow Muddle',
  world: WORLD_G1,
  theme: { name: 'Sunny Meadow', sky1: '#8ec9ff', sky2: '#eaf9ff', ground: '#7cc576' },
  curriculum: meadowCurriculum,
  arcadeDifficulty: { fallSpeed: [10, 15], maxConcurrent: 3 },
  waves: meadowWaves,
  enemiesToClear: 6,
};

export const l2: LevelDefinition = {
  id: 'l2',
  name: 'Cave Carry',
  world: WORLD_G1,
  theme: { name: 'Twilight Cave', sky1: '#93a6ff', sky2: '#c9d3ff', ground: '#6b8f6a' },
  curriculum: caveCurriculum,
  arcadeDifficulty: { fallSpeed: [12, 17], maxConcurrent: 4 },
  waves: caveWaves,
  enemiesToClear: 7,
  boss: {
    name: 'Sum Slime King',
    sprite: 'boss1',
    surviveSec: 20,
    comboToDefeat: 5,
    scope: [...cumulativeScope(k1, l1), caveCurriculum],
    arcadeDifficulty: { fallSpeed: [15, 20], maxConcurrent: 3 },
    // The first boss teaches the shape of a boss fight: one open phase to
    // learn the rhythm, then a single shielded phase to introduce weak
    // points while there's still plenty of clock left.
    phases: [
      {
        name: 'Slime Surge',
        weight: 1,
        driftSpeed: 12,
        addInterval: [3.2, 4.2],
        addArchetype: 'spore',
        vulnerableSec: 0,
        shieldedSec: 0,
      },
      {
        name: 'Crystal Crust',
        weight: 1,
        driftSpeed: 17,
        addInterval: [2.6, 3.4],
        addArchetype: 'drifter',
        vulnerableSec: 6,
        shieldedSec: 4.5,
      },
    ],
    finaleProblem: { operator: '+', left: 18, right: 15 },
    theme: { name: 'Sunset Showdown', sky1: '#ff9a76', sky2: '#ffd97d', ground: '#7cc576' },
  },
};

// --- World 3: Grade 2 ---

export const g2a: LevelDefinition = {
  id: 'g2a',
  name: 'Century Count',
  world: WORLD_G2,
  theme: { name: 'Golden Fields', sky1: '#fef3c7', sky2: '#fde68a', ground: '#ca8a04' },
  curriculum: g2aCurriculum,
  arcadeDifficulty: { fallSpeed: [12, 16], maxConcurrent: 4 },
  waves: centuryWaves,
  enemiesToClear: 7,
};

export const g2b: LevelDefinition = {
  id: 'g2b',
  name: 'Grouping Grove',
  world: WORLD_G2,
  theme: { name: 'Grouping Grove', sky1: '#fde68a', sky2: '#d9f99d', ground: '#84cc16' },
  curriculum: g2bCurriculum,
  arcadeDifficulty: { fallSpeed: [11, 15], maxConcurrent: 4 },
  waves: groveWaves,
  enemiesToClear: 7,
  boss: {
    name: 'Hundred Hydra',
    sprite: 'boss1',
    surviveSec: 24,
    comboToDefeat: 6,
    scope: [...cumulativeScope(k1, l1, l2, g2a), g2bCurriculum],
    arcadeDifficulty: { fallSpeed: [15, 21], maxConcurrent: 4 },
    phases: [
      {
        name: 'Many Heads',
        weight: 1,
        driftSpeed: 13,
        addInterval: [3.0, 4.0],
        addArchetype: 'spore',
        vulnerableSec: 0,
        shieldedSec: 0,
      },
      {
        name: 'Scaled Hide',
        weight: 1.2,
        driftSpeed: 18,
        addInterval: [2.4, 3.2],
        addArchetype: 'drifter',
        vulnerableSec: 5.5,
        shieldedSec: 4.5,
      },
      {
        name: 'Regrowth',
        weight: 1,
        driftSpeed: 22,
        addInterval: [2.0, 2.8],
        addArchetype: 'splitter',
        vulnerableSec: 4.5,
        shieldedSec: 5,
      },
    ],
    finaleProblem: { operator: '×', left: 3, right: 9 },
    theme: { name: "Hydra's Grove", sky1: '#fbbf24', sky2: '#f59e0b', ground: '#84cc16' },
  },
};

// --- World 4: Grade 3 ---

export const l3: LevelDefinition = {
  id: 'l3',
  name: 'Forest Factors',
  world: WORLD_G3,
  theme: { name: 'Whispering Forest', sky1: '#a78bfa', sky2: '#ddd6fe', ground: '#4c7a4a' },
  curriculum: forestCurriculum,
  arcadeDifficulty: { fallSpeed: [11, 16], maxConcurrent: 4 },
  waves: forestWaves,
  enemiesToClear: 7,
};

export const l4: LevelDefinition = {
  id: 'l4',
  name: 'Sky Division',
  world: WORLD_G3,
  theme: { name: 'Cloud Peaks', sky1: '#7dd3fc', sky2: '#bae6fd', ground: '#4c7a4a' },
  curriculum: skyCurriculum,
  arcadeDifficulty: { fallSpeed: [13, 18], maxConcurrent: 5 },
  waves: skyWaves,
  enemiesToClear: 8,
  boss: {
    name: 'The Math Overlord',
    sprite: 'boss2',
    surviveSec: 28,
    comboToDefeat: 7,
    scope: [...cumulativeScope(k1, l1, l2, g2a, g2b, l3), skyCurriculum],
    arcadeDifficulty: { fallSpeed: [16, 22], maxConcurrent: 4 },
    phases: [
      {
        name: 'Opening Theorem',
        weight: 1,
        driftSpeed: 14,
        addInterval: [2.8, 3.8],
        addArchetype: 'weaver',
        vulnerableSec: 0,
        shieldedSec: 0,
      },
      {
        name: 'Iron Axiom',
        weight: 1.2,
        driftSpeed: 20,
        addInterval: [2.3, 3.0],
        addArchetype: 'bulwark',
        vulnerableSec: 5,
        shieldedSec: 5,
      },
      {
        name: 'Final Proof',
        weight: 1,
        driftSpeed: 26,
        addInterval: [1.9, 2.6],
        addArchetype: 'sentinel',
        vulnerableSec: 4,
        shieldedSec: 5.5,
      },
    ],
    finaleProblem: { operator: '×', left: 9, right: 10 },
    theme: { name: "Overlord's Arena", sky1: '#312e81', sky2: '#4c1d95', ground: '#334155' },
  },
};

export const GAME_LEVELS: LevelDefinition[] = [k1, l1, l2, g2a, g2b, l3, l4];
