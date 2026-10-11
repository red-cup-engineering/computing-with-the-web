// @red-cup-engineering/web-theming-computer — operationalizes the web-theming design
// system. Pure, deterministic functions over colours, contrast, scales, and
// palettes, grounded in current living standards (OKLCH / CSS Color 4, WCAG 2.1,
// APCA / WCAG 3 draft, fluid clamp() typography). Consumed by web-theming themes
// to derive palettes-as-data and to certify them.

export {
  type Rgb,
  type Oklch,
  parseColor,
  toHex,
  rgbToOklch,
  oklchToRgb,
  toOklch,
  formatOklch,
  withLightness,
  withChroma,
  rotateHue,
  lighten,
  darken,
  mute,
  mix,
  adjust,
} from "./color.mjs";

export {
  type WcagLevel,
  relativeLuminance,
  contrastRatio,
  meetsWcag,
  apcaLc,
  apcaContrast,
} from "./contrast.mjs";

export {
  RATIOS,
  type FluidStep,
  modularScale,
  fluidClamp,
  fluidTypeScale,
} from "./scale.mjs";

export {
  type ColorTokens,
  type TypeTokens,
  type ThemeTokens,
  type ThemePalette,
  THEME_TOKEN_ROLES,
  tokenVar,
} from "./tokens.mjs";

export {
  type DerivedPalette,
  type PaletteSeeds,
  type FullPalette,
  derivePalette,
  deriveDark,
  themePalette,
} from "./palette.mjs";

export {
  type ContrastCheck,
  type ScarcityReport,
  type PaletteCertification,
  certifyContrast,
  scarcityReport,
  certifyPalette,
} from "./lint.mjs";
