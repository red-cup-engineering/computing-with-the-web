// Original 14 theming-computer regression cases received from emsenn/web-theming-computer
// src/index.test.mts (blob c1ee13fe5207ca54e877b401052f1082cf37795d).
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseColor,
  toHex,
  toOklch,
  oklchToRgb,
  rgbToOklch,
  formatOklch,
  lighten,
  darken,
  mute,
  withLightness,
  mix,
  adjust,
  contrastRatio,
  meetsWcag,
  relativeLuminance,
  apcaLc,
  apcaContrast,
  RATIOS,
  modularScale,
  fluidClamp,
  fluidTypeScale,
  derivePalette,
  deriveDark,
  certifyPalette,
  themePalette,
} from "./index.mjs";

const approx = (a: number, b: number, eps = 1e-3): void =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b} (±${eps})`);

test("parseColor accepts hex (3/4/6/8) and rgb()/rgba()", () => {
  assert.deepEqual(parseColor("#fff"), { r: 1, g: 1, b: 1, a: 1 });
  assert.deepEqual(parseColor("#000000"), { r: 0, g: 0, b: 0, a: 1 });
  const half = parseColor("#00000080");
  approx(half.a, 0.5019, 1e-3);
  const c = parseColor("rgb(255, 0, 0)");
  assert.deepEqual({ r: c.r, g: c.g, b: c.b }, { r: 1, g: 0, b: 0 });
  approx(parseColor("rgba(0,0,0,0.5)").a, 0.5);
});

test("toHex round-trips and pads", () => {
  assert.equal(toHex({ r: 1, g: 1, b: 1, a: 1 }), "#ffffff");
  assert.equal(toHex({ r: 0, g: 0, b: 0, a: 1 }), "#000000");
  assert.equal(toHex({ r: 1, g: 0, b: 0, a: 0.5 }), "#ff000080");
  assert.equal(toHex(parseColor("#3D5588")), "#3d5588");
});

test("OKLCH anchors: white L≈1 C≈0, black L≈0, and round-trips are stable", () => {
  const white = toOklch("#ffffff");
  approx(white.l, 1, 2e-3);
  approx(white.c, 0, 2e-3);
  const black = toOklch("#000000");
  approx(black.l, 0, 2e-3);
  for (const hex of ["#3d5588", "#ff4530", "#f2ead8", "#0a0a0a", "#d11a1a"]) {
    assert.equal(toHex(oklchToRgb(toOklch(hex))), hex, `round-trip ${hex}`);
  }
});

test("formatOklch emits CSS Color 4 syntax", () => {
  assert.match(formatOklch(toOklch("#ff0000")), /^oklch\(\d/);
  assert.match(formatOklch({ l: 0.6, c: 0.1, h: 30, a: 0.5 }), /\/ 0\.5\)$/);
});

test("lighten/darken move perceptual lightness monotonically; mute reduces chroma", () => {
  const base = toOklch("#3d5588");
  assert.ok(lighten(base, 0.3).l > base.l);
  assert.ok(darken(base, 0.3).l < base.l);
  assert.ok(mute(base, 0.5).c < base.c);
  assert.equal(withLightness(base, 0.5).l, 0.5);
  // adjust applies an op string→string
  const lighter = adjust("#3d5588", (o) => lighten(o, 0.2));
  assert.ok(toOklch(lighter).l > base.l);
});

test("mix interpolates perceptually; endpoints are the inputs", () => {
  const a = toOklch("#000000");
  const b = toOklch("#ffffff");
  assert.equal(toHex(oklchToRgb(mix(a, b, 0))), "#000000");
  assert.equal(toHex(oklchToRgb(mix(a, b, 1))), "#ffffff");
  const midL = mix(a, b, 0.5).l;
  assert.ok(midL > 0.3 && midL < 0.7);
});

test("WCAG: black/white is 21:1, identical is 1:1, threshold gates hold", () => {
  approx(contrastRatio("#000000", "#ffffff"), 21, 0.01);
  approx(contrastRatio("#123456", "#123456"), 1, 1e-9);
  // 561 ink on bone is high contrast → passes AAA body.
  assert.ok(meetsWcag("#0a0a0a", "#f2ead8", { level: "AAA" }));
  // mid-grey on white fails AA body but the same can pass for large text.
  assert.equal(meetsWcag("#999999", "#ffffff", { level: "AA" }), false);
  assert.ok(relativeLuminance(parseColor("#ffffff")) > relativeLuminance(parseColor("#000000")));
});

test("APCA: polarity is signed, magnitude high for black/white", () => {
  // dark text on light bg → positive, near the algorithm's max (~106)
  const darkOnLight = apcaLc("#000000", "#ffffff");
  assert.ok(darkOnLight > 100, `expected >100, got ${darkOnLight}`);
  // light text on dark bg → negative
  const lightOnDark = apcaLc("#ffffff", "#000000");
  assert.ok(lightOnDark < -90, `expected <-90, got ${lightOnDark}`);
  // equal colours → 0
  assert.equal(apcaLc("#777777", "#777777"), 0);
  assert.ok(apcaContrast("#000000", "#ffffff") > 100);
});

test("modular + fluid scales", () => {
  assert.equal(modularScale(16, 2, 0), 16);
  assert.equal(modularScale(16, 2, 1), 32);
  approx(modularScale(16, RATIOS.perfectFourth, 1), 21.328, 1e-2);
  const clamp = fluidClamp({ minPx: 16, maxPx: 24, minVw: 360, maxVw: 1240 });
  assert.match(clamp, /^clamp\(1rem, [\d.]+rem \+ [\d.]+vw, 1\.5rem\)$/);
  const scale = fluidTypeScale({ basePx: 16, up: 3, down: 1 });
  assert.equal(scale.length, 5);
  const base = scale.find((s) => s.step === 0)!;
  assert.equal(base.minPx, 16);
  // higher steps are larger
  assert.ok(scale.find((s) => s.step === 3)!.maxPx > base.maxPx);
});

test("derivePalette fills every role from three seeds, in-gamut", () => {
  const p = derivePalette({ ink: "#0a0a0a", surface: "#f2ead8", accent: "#3d5588", alarm: "#ff4530" });
  for (const role of ["ink", "inkSoft", "surface", "surfaceDeep", "surfaceEdge", "rule", "tint", "tintStrong", "selection", "accent", "visited", "alarm"] as const) {
    assert.match(p[role]!, /^#[0-9a-f]{6}$/, `${role} is a hex colour`);
  }
  // inkSoft sits between ink and surface in lightness (recessive).
  const lInk = toOklch(p.ink).l;
  const lSoft = toOklch(p.inkSoft).l;
  const lSurface = toOklch(p.surface).l;
  assert.ok(lInk < lSoft && lSoft < lSurface, "inkSoft is between ink and surface");
  // surfaceDeep is darker than surface on a light theme.
  assert.ok(toOklch(p.surfaceDeep).l < lSurface);
});

test("deriveDark inverts the scheme: dark ground, light ink, accent stays legible", () => {
  const dark = deriveDark({ ink: "#0a0a0a", surface: "#f2ead8", accent: "#3d5588" });
  const lSurface = toOklch(dark.surface).l;
  const lInk = toOklch(dark.ink).l;
  assert.ok(lSurface < 0.25, "dark surface is near-black");
  assert.ok(lInk > 0.85, "dark ink is near-white");
  // ink-on-surface in the dark scheme must clear AA body.
  assert.ok(meetsWcag(dark.ink, dark.surface, { level: "AA" }), "dark scheme is legible");
});

test("certifyPalette: a derived 561 palette is legible and scarce", () => {
  const p = derivePalette({ ink: "#0a0a0a", surface: "#f2ead8", accent: "#3d5588", alarm: "#ff4530" });
  const cert = certifyPalette(p);
  assert.ok(cert.passes, `expected pass: ${JSON.stringify(cert, null, 2)}`);
  // body pair certified and high-contrast
  const body = cert.contrast.find((c) => c.pair.startsWith("body"))!;
  assert.ok(body.passes && body.ratio > 4.5);
  // scarcity: only accent + alarm are loud → within the default budget of 3
  assert.ok(cert.scarcity.within);
  assert.ok(cert.scarcity.loud.includes("accent") && cert.scarcity.loud.includes("alarm"));
  assert.ok(!cert.scarcity.loud.includes("ink"));
});

test("certifyPalette flags an illegible / loud palette", () => {
  const bad = derivePalette({ ink: "#bbbbbb", surface: "#ffffff", accent: "#ffee00" });
  const cert = certifyPalette(bad, { budget: 0 });
  assert.equal(cert.passes, false);
});

test("themePalette returns a complete light+dark palette with type tokens merged", () => {
  const p = themePalette(
    { ink: "#0a0a0a", surface: "#f2ead8", accent: "#3d5588" },
    { sans: "X", mono: "Y", radius: "0" },
  );
  assert.equal(p.light.sans, "X");
  assert.equal(p.dark.mono, "Y");
  assert.equal(p.light.radius, "0");
  // colours present in both schemes; dark surface is darker than light surface
  assert.match(p.light.ink, /^#[0-9a-f]{6}$/);
  assert.ok(toOklch(p.dark.surface).l < toOklch(p.light.surface).l);
});
