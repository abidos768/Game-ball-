/**
 * Stage themes.
 *
 * The arena shifts appearance every few levels so progress is visible in the
 * world, not only in a number on the HUD.
 *
 * Two deliberate constraints:
 *
 *  1. Every stage shares the same near-black base. Stages are a *tint* on that
 *     base, not a different colour of background. Swapping between saturated
 *     backgrounds read as the screen changing skin mid-run.
 *  2. Colours are stored as RGBA tuples rather than CSS strings so they can be
 *     interpolated. The renderer eases between stages over a few seconds
 *     instead of cutting.
 */

export type RGBA = [number, number, number, number];

export type StageTheme = {
  name: string;
  bg: RGBA;
  grid: RGBA;
  gridMajor: RGBA;
  wall: RGBA;
  /** Accent for the stage banner (CSS, never interpolated). */
  accent: string;
};

export const LEVELS_PER_STAGE = 3;

// Base is #020617. The background barely moves between stages - a saturated
// background fill reads as the screen changing skin, which is what the first
// version got wrong. Stage identity is carried by the GRID and the WALL
// instead: thin lines can take strong colour without flooding the view.
export const STAGES: StageTheme[] = [
  {
    name: 'Shallows',
    bg: [2, 6, 23, 1],
    grid: [125, 211, 252, 0.10],
    gridMajor: [56, 189, 248, 0.20],
    wall: [56, 189, 248, 0.55],
    accent: '#38bdf8',
  },
  {
    name: 'Bloom',
    bg: [2, 14, 18, 1],
    grid: [94, 234, 212, 0.10],
    gridMajor: [45, 212, 191, 0.20],
    wall: [45, 212, 191, 0.55],
    accent: '#2dd4bf',
  },
  {
    name: 'Ember',
    bg: [16, 8, 8, 1],
    grid: [253, 186, 116, 0.10],
    gridMajor: [249, 115, 22, 0.20],
    wall: [251, 146, 60, 0.55],
    accent: '#fb923c',
  },
  {
    name: 'Void',
    bg: [9, 5, 20, 1],
    grid: [192, 132, 252, 0.10],
    gridMajor: [139, 92, 246, 0.20],
    wall: [167, 139, 250, 0.55],
    accent: '#a78bfa',
  },
  {
    name: 'Fracture',
    bg: [16, 5, 14, 1],
    grid: [249, 168, 212, 0.10],
    gridMajor: [236, 72, 153, 0.20],
    wall: [244, 114, 182, 0.55],
    accent: '#f472b6',
  },
  {
    name: 'Abyss',
    bg: [1, 3, 9, 1],
    grid: [203, 213, 225, 0.09],
    gridMajor: [148, 163, 184, 0.18],
    wall: [226, 232, 240, 0.50],
    accent: '#e2e8f0',
  },
];

/** 1-based stage number for a level. Levels 1-3 are stage 1, 4-6 stage 2, etc. */
export function stageNumber(level: number): number {
  return Math.floor((Math.max(1, level) - 1) / LEVELS_PER_STAGE) + 1;
}

export function themeForLevel(level: number): StageTheme {
  return STAGES[(stageNumber(level) - 1) % STAGES.length];
}

export function stageName(level: number): string {
  const n = stageNumber(level);
  const theme = themeForLevel(level);
  const lap = Math.floor((n - 1) / STAGES.length);
  // Second time through the cycle the stages come back harder: "Void II".
  return lap > 0 ? `${theme.name} ${'I'.repeat(lap + 1)}` : theme.name;
}

export function css(c: RGBA): string {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${c[3]})`;
}

/** Blend two themes. t = 0 is `a`, t = 1 is `b`. */
export function mixRGBA(a: RGBA, b: RGBA, t: number): RGBA {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}

export type BlendState = {
  bg: RGBA;
  grid: RGBA;
  gridMajor: RGBA;
  wall: RGBA;
};

export function blendFrom(theme: StageTheme): BlendState {
  return {
    bg: [...theme.bg],
    grid: [...theme.grid],
    gridMajor: [...theme.gridMajor],
    wall: [...theme.wall],
  };
}

/**
 * Ease the live palette toward the target stage.
 *
 * Called once per rendered frame.
 *
 * At 0.01 the change worked out to roughly 1 deltaE per second, which is at or
 * below the threshold of perception - the arena appeared not to change at all.
 * 0.022 settles in about 2.5s: clearly a transition, still not a cut.
 */
export function easeToward(current: BlendState, target: StageTheme, rate = 0.022) {
  current.bg = mixRGBA(current.bg, target.bg, rate);
  current.grid = mixRGBA(current.grid, target.grid, rate);
  current.gridMajor = mixRGBA(current.gridMajor, target.gridMajor, rate);
  current.wall = mixRGBA(current.wall, target.wall, rate);
}
