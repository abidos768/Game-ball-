/**
 * Adaptive difficulty ("flow control").
 *
 * The goal is the band Block Blast keeps you in: always nearly losing, rarely
 * actually losing. Rather than a fixed curve that ramps with level, difficulty
 * is modulated by how the player is *currently* coping.
 *
 * Design rules this follows:
 *
 *  1. Never visible. No "difficulty adjusted" toast, no UI. If the player
 *     notices the rubber band, it stops working.
 *  2. Bounded. Comfort only shifts difficulty within a window around the
 *     level's baseline, so a good player still gets a real ramp and a bad one
 *     never gets a walkover.
 *  3. Slow to react. Comfort is smoothed over seconds, not frames, otherwise
 *     one unlucky hit would visibly soften the whole arena.
 *  4. Assists arrive as opportunity, not charity. When someone is struggling
 *     the game offers more edible enemies and quicker power-ups - it does not
 *     stop enemies from hunting them.
 */

export type FlowState = {
  /** Frames since the player last took damage. */
  sinceHit: number;
  /** Frames since the player last ate an enemy. */
  sinceKill: number;
  /** Times hit this run. */
  hits: number;
  /** Smoothed 0..1 estimate of how comfortable the player is. */
  comfort: number;
};

export function createFlow(): FlowState {
  return { sinceHit: 0, sinceKill: 0, hits: 0, comfort: 0.5 };
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Call once per logical tick (60/sec).
 *
 * `size` is the player radius; 10 is death, ~20 is the starting size.
 */
export function updateFlow(flow: FlowState, size: number) {
  flow.sinceHit++;
  flow.sinceKill++;

  // Three independent reads on "are they winning right now":
  //   headroom  - how far above the death threshold they are
  //   safety    - how long since anything hurt them (caps at 12s)
  //   momentum  - whether they are actively taking enemies down (caps at 15s)
  const headroom = clamp01((size - 12) / 45);
  const safety = clamp01(flow.sinceHit / (12 * 60));
  const momentum = 1 - clamp01(flow.sinceKill / (15 * 60));

  const target = clamp01(0.45 * headroom + 0.35 * safety + 0.2 * momentum);

  // Smooth hard. At 0.015/tick this takes several seconds to travel the full
  // range, so difficulty drifts rather than snapping.
  flow.comfort += (target - flow.comfort) * 0.015;
}

export function noteHit(flow: FlowState) {
  flow.sinceHit = 0;
  flow.hits++;
}

export function noteKill(flow: FlowState) {
  flow.sinceKill = 0;
}

/**
 * Difficulty multiplier, ~0.75 (struggling) to ~1.25 (cruising).
 *
 * Deliberately narrow. A wider band makes good runs trivially easy at the
 * start and bad runs unwinnable, which is the failure mode of naive rubber
 * banding.
 */
export function challenge(flow: FlowState): number {
  return 0.75 + flow.comfort * 0.5;
}

/**
 * Size multiplier range for a newly spawned enemy.
 *
 * Struggling players see mostly edible cells, which is the recovery path -
 * they still have to go and eat them. Comfortable players meet cells that
 * genuinely outclass them.
 */
export function enemySizeRange(flow: FlowState): [number, number] {
  const c = flow.comfort;
  const min = 0.35 + c * 0.15; // 0.35 -> 0.50
  const max = 1.15 + c * 0.85; // 1.15 -> 2.00
  return [min, max];
}

/** Frames until the next power-up. Rescue arrives sooner when it's needed. */
export function powerupDelay(flow: FlowState): number {
  const c = flow.comfort;
  const base = 420 + c * 520; // ~7s struggling -> ~15s cruising
  return Math.floor(base + Math.random() * 240);
}

/** Chance a newly spawned orb is a speed orb. */
export function speedOrbChance(flow: FlowState): number {
  // Slightly more speed orbs when comfortable: they are a scoring opportunity
  // rather than a lifeline, so they reward players who are already ahead.
  return 0.04 + flow.comfort * 0.05;
}

/**
 * How far from the player a new orb may spawn, as a fraction of the arena.
 *
 * When someone is starving, food appearing on the far side of a 3000px arena
 * is a death sentence they can't read or react to. Tightening the spawn radius
 * is the least visible way to help.
 */
export function orbSpawnBias(flow: FlowState): number {
  return 0.35 + flow.comfort * 0.65; // 35% of arena -> anywhere
}
