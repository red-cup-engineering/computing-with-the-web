// Contrast, two ways. WCAG 2.1 contrast ratio is the current normative standard
// (the 4.5:1 / 3:1 thresholds). APCA (Accessible Perceptual Contrast Algorithm)
// is the next-gen model drafted for WCAG 3 — polarity-aware and perceptually
// weighted, reported in Lc units. We compute both: WCAG to certify against the
// living standard, APCA to design with the better perceptual signal.

import { parseColor, type Rgb } from "./color.mjs";

// ── WCAG 2.1 ─────────────────────────────────────────────────────────────────

function wcagLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance of an sRGB colour (0–1). */
export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * wcagLinear(rgb.r) + 0.7152 * wcagLinear(rgb.g) + 0.0722 * wcagLinear(rgb.b);
}

/** WCAG 2.1 contrast ratio between two colour strings (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(parseColor(a));
  const lb = relativeLuminance(parseColor(b));
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export type WcagLevel = "AA" | "AAA";

/** Does fg-on-bg meet a WCAG 2.1 level? `large` = ≥18pt or ≥14pt bold. */
export function meetsWcag(
  fg: string,
  bg: string,
  options: { level?: WcagLevel; large?: boolean } = {},
): boolean {
  const ratio = contrastRatio(fg, bg);
  const level = options.level ?? "AA";
  const large = options.large ?? false;
  const threshold = level === "AAA" ? (large ? 4.5 : 7) : large ? 3 : 4.5;
  return ratio >= threshold;
}

// ── APCA 0.1.9 (WCAG 3 draft) ─────────────────────────────────────────────────

const APCA = {
  trc: 2.4,
  R: 0.2126729,
  G: 0.7151522,
  B: 0.072175,
  normBG: 0.56,
  normTXT: 0.57,
  revTXT: 0.62,
  revBG: 0.65,
  blkThrs: 0.022,
  blkClmp: 1.414,
  scale: 1.14,
  loOffset: 0.027,
  loClip: 0.1,
  deltaYmin: 0.0005,
} as const;

function apcaY(rgb: Rgb): number {
  const lin = (c: number): number => c ** APCA.trc;
  let y = APCA.R * lin(rgb.r) + APCA.G * lin(rgb.g) + APCA.B * lin(rgb.b);
  if (y < APCA.blkThrs) y += (APCA.blkThrs - y) ** APCA.blkClmp;
  return y;
}

/**
 * APCA lightness contrast (Lc), signed: positive for dark-text-on-light,
 * negative for light-text-on-dark. The magnitude is the perceptual contrast;
 * common guidance: |Lc| ≥ 75 for body text, ≥ 60 for larger/heavier, ≥ 45 for
 * large headings, ≥ 30 for non-text/disabled.
 */
export function apcaLc(text: string, background: string): number {
  const txtY = apcaY(parseColor(text));
  const bgY = apcaY(parseColor(background));
  if (Math.abs(bgY - txtY) < APCA.deltaYmin) return 0;

  let sapc: number;
  let output: number;
  if (bgY > txtY) {
    sapc = (bgY ** APCA.normBG - txtY ** APCA.normTXT) * APCA.scale;
    output = sapc < APCA.loClip ? 0 : sapc - APCA.loOffset;
  } else {
    sapc = (bgY ** APCA.revBG - txtY ** APCA.revTXT) * APCA.scale;
    output = sapc > -APCA.loClip ? 0 : sapc + APCA.loOffset;
  }
  return output * 100;
}

/** Absolute APCA Lc (perceptual contrast magnitude). */
export function apcaContrast(text: string, background: string): number {
  return Math.abs(apcaLc(text, background));
}
