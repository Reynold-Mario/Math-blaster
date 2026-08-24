import type { Curriculum, LevelDefinition } from './LevelDefinition';
import { cumulativeScope } from './LevelDefinition';

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

// --- World 1: Kindergarten ---

export const k1: LevelDefinition = {
  id: 'k1',
  name: 'Sprout Sums',
  world: WORLD_K,
  theme: { name: 'Sprout Garden', sky1: '#bbf7d0', sky2: '#fef9c3', ground: '#86efac' },
  curriculum: kCurriculum,
  arcadeDifficulty: { fallSpeed: [12, 18], spawnInterval: [3.8, 5.0], maxConcurrent: 2 },
  grunt: 'slime',
  enemiesToClear: 6,
};

// --- World 2: Grade 1 ---

export const l1: LevelDefinition = {
  id: 'l1',
  name: 'Meadow Muddle',
  world: WORLD_G1,
  theme: { name: 'Sunny Meadow', sky1: '#8ec9ff', sky2: '#eaf9ff', ground: '#7cc576' },
  curriculum: meadowCurriculum,
  arcadeDifficulty: { fallSpeed: [16, 24], spawnInterval: [3.2, 4.3], maxConcurrent: 3 },
  grunt: 'slime',
  enemiesToClear: 8,
};

export const l2: LevelDefinition = {
  id: 'l2',
  name: 'Cave Carry',
  world: WORLD_G1,
  theme: { name: 'Twilight Cave', sky1: '#93a6ff', sky2: '#c9d3ff', ground: '#6b8f6a' },
  curriculum: caveCurriculum,
  arcadeDifficulty: { fallSpeed: [20, 28], spawnInterval: [2.8, 3.8], maxConcurrent: 3 },
  grunt: 'bat',
  enemiesToClear: 8,
  boss: {
    name: 'Sum Slime King',
    sprite: 'boss1',
    hp: 260,
    scope: [...cumulativeScope(k1, l1), caveCurriculum],
    arcadeDifficulty: { fallSpeed: [24, 32], spawnInterval: [1.9, 2.7], maxConcurrent: 3 },
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
  arcadeDifficulty: { fallSpeed: [19, 27], spawnInterval: [2.9, 3.9], maxConcurrent: 3 },
  grunt: 'bat',
  enemiesToClear: 8,
};

export const g2b: LevelDefinition = {
  id: 'g2b',
  name: 'Grouping Grove',
  world: WORLD_G2,
  theme: { name: 'Grouping Grove', sky1: '#fde68a', sky2: '#d9f99d', ground: '#84cc16' },
  curriculum: g2bCurriculum,
  arcadeDifficulty: { fallSpeed: [17, 25], spawnInterval: [3.1, 4.1], maxConcurrent: 3 },
  grunt: 'robot',
  enemiesToClear: 8,
  boss: {
    name: 'Hundred Hydra',
    sprite: 'boss1',
    hp: 300,
    scope: [...cumulativeScope(k1, l1, l2, g2a), g2bCurriculum],
    arcadeDifficulty: { fallSpeed: [25, 33], spawnInterval: [1.8, 2.6], maxConcurrent: 3 },
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
  arcadeDifficulty: { fallSpeed: [18, 26], spawnInterval: [3.0, 4.0], maxConcurrent: 3 },
  grunt: 'robot',
  enemiesToClear: 9,
};

export const l4: LevelDefinition = {
  id: 'l4',
  name: 'Sky Division',
  world: WORLD_G3,
  theme: { name: 'Cloud Peaks', sky1: '#7dd3fc', sky2: '#bae6fd', ground: '#4c7a4a' },
  curriculum: skyCurriculum,
  arcadeDifficulty: { fallSpeed: [22, 30], spawnInterval: [2.6, 3.6], maxConcurrent: 3 },
  grunt: 'robot',
  gruntTint: 'hue-rotate(65deg)',
  enemiesToClear: 9,
  boss: {
    name: 'The Math Overlord',
    sprite: 'boss2',
    hp: 380,
    scope: [...cumulativeScope(k1, l1, l2, g2a, g2b, l3), skyCurriculum],
    arcadeDifficulty: { fallSpeed: [26, 34], spawnInterval: [1.7, 2.4], maxConcurrent: 4 },
    finaleProblem: { operator: '×', left: 9, right: 10 },
    theme: { name: "Overlord's Arena", sky1: '#312e81', sky2: '#4c1d95', ground: '#334155' },
  },
};

export const GAME_LEVELS: LevelDefinition[] = [k1, l1, l2, g2a, g2b, l3, l4];
