// Palette derivation. Give a few seeds — ink, surface, accent — and get a full
// token set, computed in OKLCH so the derived shades are perceptually even
// regardless of hue. Polarity-agnostic: "toward fg/bg" works for light or dark
// seeds alike. `deriveDark` synthesises a dark scheme from a light one by
// re-seeding with inverted lightness, then re-deriving — so a theme ships one
// set of intentions and gets both schemes.

import { mix, oklchToRgb, toHex, toOklch, type Oklch } from "./color.mjs";
import type { ColorTokens, TypeTokens } from "./tokens.mjs";

export type { TypeTokens } from "./tokens.mjs";

/**
 * The colour roles `derivePalette` always populates: the shared `ColorTokens`
 * vocabulary with the derived roles made required (only `alarm` stays optional,
 * since it is only present when an alarm seed is given).
 */
export type DerivedPalette = Required<Omit<ColorTokens, "alarm">> & Pick<ColorTokens, "alarm">;

export type PaletteSeeds = {
  /** Primary text / marks. */
  ink: string;
  /** Page ground. */
  surface: string;
  /** Primary accent (links, citations). */
  accent: string;
  /** Optional alert accent. */
  alarm?: string;
};

const toward = (a: string, b: string, t: number): string => toHex(oklchToRgb(mix(toOklch(a), toOklch(b), t)));

/** Derive a full colour palette from ink/surface/accent seeds, in OKLCH. */
export function derivePalette(seeds: PaletteSeeds): DerivedPalette {
  const { ink, surface, accent } = seeds;
  const palette: DerivedPalette = {
    ink,
    surface,
    accent,
    inkSoft: toward(ink, surface, 0.32),
    surfaceDeep: toward(surface, ink, 0.06),
    surfaceEdge: toward(surface, ink, 0.16),
    rule: toward(surface, ink, 0.14),
    tint: toward(surface, ink, 0.05),
    tintStrong: toward(surface, ink, 0.11),
    selection: toward(accent, surface, 0.55),
    visited: toward(accent, ink, 0.35),
  };
  if (seeds.alarm !== undefined) palette.alarm = seeds.alarm;
  return palette;
}

/** A complete light+dark palette, structurally a web-theming `ThemePalette`. */
export type FullPalette = {
  light: DerivedPalette & TypeTokens;
  dark: DerivedPalette & TypeTokens;
};

/**
 * Build a complete light+dark palette from seeds plus type/layout tokens — the
 * one call a theme needs: colours derived in OKLCH (light) and synthesised
 * (dark), with the shared type stacks merged in. Assignable directly to
 * web-theming's `ThemePalette`.
 */
export function themePalette(seeds: PaletteSeeds, type: TypeTokens = {}): FullPalette {
  return {
    light: { ...derivePalette(seeds), ...type },
    dark: { ...deriveDark(seeds), ...type },
  };
}

const setL = (o: Oklch, l: number, maxC?: number): Oklch => ({
  ...o,
  l,
  c: maxC === undefined ? o.c : Math.min(o.c, maxC),
});

/**
 * Synthesise a dark palette from a light one's seeds: pull the surface down to a
 * near-black ground, lift the ink to a near-white, and raise a too-dark accent
 * so it reads on the dark ground — then re-derive the rest.
 */
export function deriveDark(seeds: PaletteSeeds): DerivedPalette {
  const surfaceO = toOklch(seeds.surface);
  const inkO = toOklch(seeds.ink);
  const accentO = toOklch(seeds.accent);

  const darkSurface = toHex(oklchToRgb(setL(surfaceO, 0.16, 0.03)));
  const darkInk = toHex(oklchToRgb(setL(inkO, 0.92, 0.02)));
  const darkAccent = toHex(oklchToRgb(accentO.l < 0.62 ? setL(accentO, 0.72) : accentO));

  const darkSeeds: PaletteSeeds = { ink: darkInk, surface: darkSurface, accent: darkAccent };
  if (seeds.alarm !== undefined) {
    const alarmO = toOklch(seeds.alarm);
    darkSeeds.alarm = toHex(oklchToRgb(alarmO.l < 0.62 ? setL(alarmO, 0.72) : alarmO));
  }
  return derivePalette(darkSeeds);
}
