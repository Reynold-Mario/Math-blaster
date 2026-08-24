// Sprites are built as small numeric grids (0 = transparent) plus a palette
// mapping each number to a hex color. Shapes are generated with simple
// ellipse/rect helpers rather than hand-typed pixel-by-pixel, so every
// silhouette stays clean and symmetric.

export interface SpriteDef {
  w: number;
  h: number;
  grid: number[][];
  palette: Record<number, string>;
}

function blank(w: number, h: number): number[][] {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => 0));
}
function inEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number) {
  const dx = (x + 0.5 - cx) / rx;
  const dy = (y + 0.5 - cy) / ry;
  return dx * dx + dy * dy <= 1;
}
function fillEllipse(g: number[][], cx: number, cy: number, rx: number, ry: number, ch: number) {
  for (let y = 0; y < g.length; y++)
    for (let x = 0; x < g[0].length; x++) if (inEllipse(x, y, cx, cy, rx, ry)) g[y][x] = ch;
}
function fillRect(g: number[][], x0: number, y0: number, x1: number, y1: number, ch: number) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = ch;
}
function dot(g: number[][], x: number, y: number, ch: number) {
  if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = ch;
}

// Shared palette roles: 1 body, 2 dark/shade, 3 eyeWhite, 4 eyePupil, 5 accent, 6 accent2, 7 accent3

function slime(): SpriteDef {
  const w = 14, h = 10;
  const g = blank(w, h);
  fillEllipse(g, 7, 5.5, 6.5, 4, 1);
  fillRect(g, 1, 6, 12, 7, 1);
  fillRect(g, 1, 7, 12, 7, 2);
  fillEllipse(g, 4.5, 4, 1.3, 1.6, 3);
  fillEllipse(g, 9.5, 4, 1.3, 1.6, 3);
  dot(g, 4, 4, 4); dot(g, 5, 4, 4);
  dot(g, 9, 4, 4); dot(g, 10, 4, 4);
  return {
    w, h, grid: g,
    palette: { 1: '#4ade80', 2: '#16a34a', 3: '#ffffff', 4: '#14213d' },
  };
}

function bat(): SpriteDef {
  const w = 16, h = 12;
  const g = blank(w, h);
  const wingRows: [number, number][] = [[0, 2], [0, 3], [1, 4], [2, 5], [3, 6]];
  wingRows.forEach(([x0, x1], i) => {
    fillRect(g, x0, 3 + i, x1, 3 + i, 5);
    fillRect(g, w - 1 - x1, 3 + i, w - 1 - x0, 3 + i, 5);
  });
  fillEllipse(g, 8, 6, 3, 3, 1);
  dot(g, 6, 2, 1); dot(g, 9, 2, 1);
  dot(g, 6, 6, 4); dot(g, 10, 6, 4);
  return {
    w, h, grid: g,
    palette: { 1: '#c4b5fd', 4: '#1b1b2f', 5: '#7c3aed' },
  };
}

function robot(): SpriteDef {
  const w = 14, h = 14;
  const g = blank(w, h);
  fillRect(g, 3, 0, 10, 1, 6);
  dot(g, 6, 0, 5); dot(g, 7, 0, 5);
  fillRect(g, 2, 2, 11, 9, 1);
  fillRect(g, 2, 2, 11, 2, 2);
  fillRect(g, 4, 4, 9, 6, 3);
  dot(g, 5, 5, 4); dot(g, 8, 5, 4);
  fillRect(g, 0, 5, 1, 8, 5);
  fillRect(g, 12, 5, 13, 8, 5);
  fillRect(g, 3, 10, 5, 13, 2);
  fillRect(g, 8, 10, 10, 13, 2);
  return {
    w, h, grid: g,
    palette: { 1: '#93c5fd', 2: '#1e3a5f', 3: '#e0f7ff', 4: '#0891b2', 5: '#fb923c', 6: '#fde68a' },
  };
}

function player(): SpriteDef {
  const w = 14, h = 12;
  const g = blank(w, h);
  fillRect(g, 6, 0, 7, 3, 5);
  fillEllipse(g, 7, 7, 6, 4.5, 1);
  fillRect(g, 0, 9, 13, 11, 2);
  fillRect(g, 5, 6, 8, 7, 3);
  return {
    w, h, grid: g,
    palette: { 1: '#60a5fa', 2: '#334155', 3: '#fef08a', 5: '#f87171' },
  };
}

function boss1(): SpriteDef {
  const w = 20, h = 17;
  const g = blank(w, h);
  fillEllipse(g, 10, 11, 9, 6, 1);
  fillRect(g, 1, 13, 18, 15, 1);
  fillRect(g, 1, 14, 18, 14, 2);
  fillRect(g, 6, 2, 13, 4, 6);
  dot(g, 6, 1, 6); dot(g, 9, 0, 6); dot(g, 13, 1, 6);
  fillRect(g, 5, 5, 14, 7, 6);
  fillEllipse(g, 6.5, 9, 1.8, 2.2, 3);
  fillEllipse(g, 13.5, 9, 1.8, 2.2, 3);
  dot(g, 6, 9, 4); dot(g, 7, 9, 4);
  dot(g, 13, 9, 4); dot(g, 14, 9, 4);
  return {
    w, h, grid: g,
    palette: { 1: '#c084fc', 2: '#7e22ce', 3: '#ffffff', 4: '#2e1065', 6: '#fbbf24' },
  };
}

function boss2(): SpriteDef {
  const w = 20, h = 20;
  const g = blank(w, h);
  fillRect(g, 2, 4, 4, 6, 2); fillRect(g, 15, 4, 17, 6, 2);
  dot(g, 3, 3, 7); dot(g, 16, 3, 7);
  fillRect(g, 2, 6, 17, 15, 1);
  fillRect(g, 2, 6, 17, 7, 2);
  fillRect(g, 5, 9, 14, 12, 3);
  dot(g, 6, 10, 4); dot(g, 7, 10, 4);
  dot(g, 12, 10, 4); dot(g, 13, 10, 4);
  fillRect(g, 8, 12, 11, 12, 4);
  fillRect(g, 0, 9, 1, 13, 5); fillRect(g, 18, 9, 19, 13, 5);
  fillRect(g, 4, 16, 8, 19, 2); fillRect(g, 11, 16, 15, 19, 2);
  return {
    w, h, grid: g,
    palette: { 1: '#64748b', 2: '#1e293b', 3: '#86efac', 4: '#0f172a', 5: '#f472b6', 7: '#facc15' },
  };
}

export const SPRITES: Record<'slime' | 'bat' | 'robot' | 'player' | 'boss1' | 'boss2', SpriteDef> = {
  slime: slime(),
  bat: bat(),
  robot: robot(),
  player: player(),
  boss1: boss1(),
  boss2: boss2(),
};
