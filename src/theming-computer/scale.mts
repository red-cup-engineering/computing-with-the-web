// Type and space scales. A modular scale fixes ratios so sizes relate by a
// constant (a "rhythm" rather than ad-hoc values — the Bauhaus rhythm constraint,
// made arithmetic). Fluid steps interpolate between a small-screen and large-
// screen size with `clamp()`, so type breathes with the viewport without media
// queries — the current living-standard fluid-typography technique.

/** Named musical/typographic ratios. */
export const RATIOS = Object.freeze({
  minorSecond: 1.067,
  majorSecond: 1.125,
  minorThird: 1.2,
  majorThird: 1.25,
  perfectFourth: 1.333,
  augmentedFourth: 1.414,
  perfectFifth: 1.5,
  goldenSection: 1.618,
});

/** A size on a modular scale: base × ratio^step (step may be negative). */
export function modularScale(base: number, ratio: number, step: number): number {
  return base * ratio ** step;
}

/**
 * Build a `clamp(min, preferred, max)` declaration that scales `minPx`→`maxPx`
 * as the viewport goes `minVw`→`maxVw`. The preferred term is the line through
 * those two points, expressed in rem + vw so it honours user zoom.
 */
export function fluidClamp(opts: {
  minPx: number;
  maxPx: number;
  minVw?: number;
  maxVw?: number;
  rootPx?: number;
}): string {
  const { minPx, maxPx } = opts;
  const minVw = opts.minVw ?? 360;
  const maxVw = opts.maxVw ?? 1240;
  const root = opts.rootPx ?? 16;
  const slope = (maxPx - minPx) / (maxVw - minVw);
  const interceptPx = minPx - slope * minVw;
  const interceptRem = interceptPx / root;
  const slopeVw = slope * 100;
  const minRem = minPx / root;
  const maxRem = maxPx / root;
  const lo = Math.min(minRem, maxRem);
  const hi = Math.max(minRem, maxRem);
  return `clamp(${round(lo)}rem, ${round(interceptRem)}rem + ${round(slopeVw)}vw, ${round(hi)}rem)`;
}

const round = (n: number): number => Math.round(n * 10000) / 10000;

export type FluidStep = {
  /** Step index relative to the base (0 = base). */
  step: number;
  /** The `clamp()` declaration. */
  value: string;
  /** Floor / ceiling in px, for reference. */
  minPx: number;
  maxPx: number;
};

/**
 * Generate a fluid modular type scale: each step's floor uses `minRatio` and its
 * ceiling uses `maxRatio` (a larger ceiling ratio makes display sizes scale up
 * harder on wide screens). Returns steps from `down` below the base to `up`
 * above it.
 */
export function fluidTypeScale(opts: {
  basePx?: number;
  minRatio?: number;
  maxRatio?: number;
  up?: number;
  down?: number;
  minVw?: number;
  maxVw?: number;
  rootPx?: number;
}): FluidStep[] {
  const basePx = opts.basePx ?? 16;
  const minRatio = opts.minRatio ?? RATIOS.minorThird;
  const maxRatio = opts.maxRatio ?? RATIOS.perfectFourth;
  const up = opts.up ?? 5;
  const down = opts.down ?? 2;
  const minVw = opts.minVw ?? 360;
  const maxVw = opts.maxVw ?? 1240;
  const rootPx = opts.rootPx ?? 16;
  const steps: FluidStep[] = [];
  for (let step = -down; step <= up; step++) {
    const minPx = round(modularScale(basePx, minRatio, step));
    const maxPx = round(modularScale(basePx, maxRatio, step));
    steps.push({
      step,
      minPx,
      maxPx,
      value: fluidClamp({ minPx, maxPx, minVw, maxVw, rootPx }),
    });
  }
  return steps;
}
