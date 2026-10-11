// Certification — turn a palette into checkable claims. Two lenses from the
// visual-engineering research, made arithmetic:
//   - legibility: every foreground/background pair a reader actually meets must
//     clear the living accessibility bar (WCAG 2.1), reported alongside APCA Lc.
//   - scarcity: "salience must be scarce" — count the loud (chromatic) colours
//     and hold them to a budget, so emphasis stays meaningful.
// The result is data a build step (or admitTheme) can gate on.

import { contrastRatio, apcaLc, meetsWcag, type WcagLevel } from "./contrast.mjs";
import { toOklch } from "./color.mjs";
import type { DerivedPalette } from "./palette.mjs";

export type ContrastCheck = {
  /** Human label, e.g. "body (ink on surface)". */
  pair: string;
  fg: string;
  bg: string;
  ratio: number;
  apca: number;
  level: WcagLevel;
  large: boolean;
  required: number;
  passes: boolean;
};

type Required = { fg: keyof DerivedPalette; bg: keyof DerivedPalette; pair: string; level: WcagLevel; large: boolean };

// The pairs a reader actually encounters. inkSoft is recessive (allowed at AA
// large); body/link/card text must clear AA normal.
const DEFAULT_PAIRS: readonly Required[] = Object.freeze([
  { fg: "ink", bg: "surface", pair: "body (ink on surface)", level: "AA", large: false },
  { fg: "ink", bg: "surfaceDeep", pair: "text on raised (ink on surfaceDeep)", level: "AA", large: false },
  { fg: "inkSoft", bg: "surface", pair: "secondary (inkSoft on surface)", level: "AA", large: true },
  { fg: "accent", bg: "surface", pair: "link (accent on surface)", level: "AA", large: false },
]);

const threshold = (level: WcagLevel, large: boolean): number =>
  level === "AAA" ? (large ? 4.5 : 7) : large ? 3 : 4.5;

/** Certify the legibility pairs of a palette against WCAG (with APCA reported). */
export function certifyContrast(palette: DerivedPalette, pairs: readonly Required[] = DEFAULT_PAIRS): ContrastCheck[] {
  const out: ContrastCheck[] = [];
  for (const p of pairs) {
    const fg = palette[p.fg];
    const bg = palette[p.bg];
    if (fg === undefined || bg === undefined) continue;
    out.push({
      pair: p.pair,
      fg,
      bg,
      ratio: Math.round(contrastRatio(fg, bg) * 100) / 100,
      apca: Math.round(apcaLc(fg, bg) * 10) / 10,
      level: p.level,
      large: p.large,
      required: threshold(p.level, p.large),
      passes: meetsWcag(fg, bg, { level: p.level, large: p.large }),
    });
  }
  return out;
}

export type ScarcityReport = {
  /** Tokens whose chroma exceeds the loud threshold. */
  loud: string[];
  count: number;
  budget: number;
  within: boolean;
};

/**
 * Scarcity test: count the chromatic ("loud") colours in a palette. Grounds and
 * marks (ink/surface/edges/rules) are near-neutral; accents and alerts carry
 * chroma. Holding the loud count to a small budget keeps salience scarce.
 */
export function scarcityReport(palette: DerivedPalette, opts: { chromaThreshold?: number; budget?: number } = {}): ScarcityReport {
  const chromaThreshold = opts.chromaThreshold ?? 0.04;
  const budget = opts.budget ?? 3;
  const loud: string[] = [];
  for (const [role, value] of Object.entries(palette)) {
    if (value === undefined) continue;
    if (toOklch(value).c > chromaThreshold) loud.push(role);
  }
  return { loud, count: loud.length, budget, within: loud.length <= budget };
}

export type PaletteCertification = {
  passes: boolean;
  contrast: ContrastCheck[];
  scarcity: ScarcityReport;
};

/** Full palette certification: legibility pairs pass AND scarcity is within budget. */
export function certifyPalette(
  palette: DerivedPalette,
  opts: { pairs?: readonly Required[]; chromaThreshold?: number; budget?: number } = {},
): PaletteCertification {
  const contrast = certifyContrast(palette, opts.pairs);
  const scarcity = scarcityReport(palette, opts);
  return {
    contrast,
    scarcity,
    passes: contrast.every((c) => c.passes) && scarcity.within,
  };
}
