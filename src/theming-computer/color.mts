// Colour math in OKLab / OKLCH — the perceptually-uniform space behind CSS
// Color 4's `oklch()`. Working in OKLCH means lightness, chroma, and hue move
// independently and *perceptually*: derive a tint by raising L, a muted edge by
// lowering C, a dark scheme by inverting L — without the hue drift and uneven
// steps that plague sRGB/HSL manipulation. Conversions follow Björn Ottosson's
// reference matrices.

export type Rgb = {
  /** sRGB channels, gamma-encoded, 0–1. */
  r: number;
  g: number;
  b: number;
  /** Alpha 0–1 (default 1). */
  a: number;
};

export type Oklch = {
  /** Perceptual lightness, 0–1. */
  l: number;
  /** Chroma, ≥0 (typically 0–0.4). */
  c: number;
  /** Hue in degrees, 0–360. */
  h: number;
  /** Alpha 0–1. */
  a: number;
};

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

// ── sRGB gamma ──────────────────────────────────────────────────────────────

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

// ── Parsing & formatting (sRGB) ───────────────────────────────────────────────

/** Parse `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()` into sRGB 0–1. */
export function parseColor(input: string): Rgb {
  const s = input.trim().toLowerCase();
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    const expand = (h: string): number => parseInt(h.length === 1 ? h + h : h, 16);
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: expand(hex[0]!) / 255,
        g: expand(hex[1]!) / 255,
        b: expand(hex[2]!) / 255,
        a: hex.length === 4 ? expand(hex[3]!) / 255 : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
    throw new Error(`unrecognised hex colour: ${input}`);
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1]!.split(/[,/]/).map((p) => p.trim()).filter(Boolean);
    const chan = (p: string): number => (p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p) / 255);
    return {
      r: clamp01(chan(parts[0]!)),
      g: clamp01(chan(parts[1]!)),
      b: clamp01(chan(parts[2]!)),
      a: parts[3] !== undefined ? clamp01(parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1,
    };
  }
  throw new Error(`unrecognised colour: ${input}`);
}

const hex2 = (x: number): string => Math.round(clamp01(x) * 255).toString(16).padStart(2, "0");

/** Format sRGB as `#rrggbb` (or `#rrggbbaa` when alpha < 1). */
export function toHex(rgb: Rgb): string {
  const base = `#${hex2(rgb.r)}${hex2(rgb.g)}${hex2(rgb.b)}`;
  return rgb.a < 1 ? `${base}${hex2(rgb.a)}` : base;
}

// ── OKLab / OKLCH conversions ─────────────────────────────────────────────────

export function rgbToOklch(rgb: Rgb): Oklch {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);

  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const c = Math.hypot(A, B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h, a: rgb.a };
}

export function oklchToRgb(o: Oklch): Rgb {
  const hr = (o.h * Math.PI) / 180;
  const A = o.c * Math.cos(hr);
  const B = o.c * Math.sin(hr);

  const l_ = o.l + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = o.l - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = o.l - 0.0894841775 * A - 1.291485548 * B;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return {
    r: clamp01(linearToSrgb(r)),
    g: clamp01(linearToSrgb(g)),
    b: clamp01(linearToSrgb(b)),
    a: o.a,
  };
}

/** Parse any sRGB colour string into OKLCH. */
export function toOklch(input: string): Oklch {
  return rgbToOklch(parseColor(input));
}

/** Format OKLCH as a CSS `oklch()` string (gamut-clamped on the sRGB round-trip). */
export function formatOklch(o: Oklch, places = 4): string {
  const L = (o.l * 100).toFixed(2);
  const C = o.c.toFixed(places);
  const H = o.h.toFixed(2);
  return o.a < 1 ? `oklch(${L}% ${C} ${H} / ${o.a})` : `oklch(${L}% ${C} ${H})`;
}

// ── Perceptual operations ─────────────────────────────────────────────────────

const wrapHue = (h: number): number => ((h % 360) + 360) % 360;

/** Set lightness (0–1), keeping chroma, hue, alpha. */
export function withLightness(o: Oklch, l: number): Oklch {
  return { ...o, l: clamp01(l) };
}

/** Set chroma (≥0). */
export function withChroma(o: Oklch, c: number): Oklch {
  return { ...o, c: Math.max(0, c) };
}

/** Rotate hue by degrees. */
export function rotateHue(o: Oklch, deg: number): Oklch {
  return { ...o, h: wrapHue(o.h + deg) };
}

/** Lighten toward white by a fraction of the remaining headroom. */
export function lighten(o: Oklch, amount: number): Oklch {
  return withLightness(o, o.l + (1 - o.l) * amount);
}

/** Darken toward black by a fraction of the current lightness. */
export function darken(o: Oklch, amount: number): Oklch {
  return withLightness(o, o.l * (1 - amount));
}

/** Mute: scale chroma toward grey by a fraction. */
export function mute(o: Oklch, amount: number): Oklch {
  return withChroma(o, o.c * (1 - amount));
}

/** Perceptual mix of two colours in OKLab, t in 0–1 (0 = a, 1 = b). */
export function mix(a: Oklch, b: Oklch, t: number): Oklch {
  const k = clamp01(t);
  const ar = oklchToRgb(a);
  const br = oklchToRgb(b);
  // Interpolate in OKLab to avoid hue-arc ambiguity.
  const A = rgbToOklch(ar);
  const B = rgbToOklch(br);
  const aA = A.c * Math.cos((A.h * Math.PI) / 180);
  const aB = A.c * Math.sin((A.h * Math.PI) / 180);
  const bA = B.c * Math.cos((B.h * Math.PI) / 180);
  const bB = B.c * Math.sin((B.h * Math.PI) / 180);
  const L = A.l + (B.l - A.l) * k;
  const mA = aA + (bA - aA) * k;
  const mB = aB + (bB - aB) * k;
  let h = (Math.atan2(mB, mA) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c: Math.hypot(mA, mB), h, a: a.a + (b.a - a.a) * k };
}

/** Convenience: apply an OKLCH op to a hex/rgb string, return hex. */
export function adjust(input: string, op: (o: Oklch) => Oklch): string {
  return toHex(oklchToRgb(op(toOklch(input))));
}
