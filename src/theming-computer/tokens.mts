// Token vocabulary — the single source of truth for the design-token roles, in
// render order, with each role's canonical CSS custom-property name. Both the
// colour engine (palette derivation, certification) and the token renderer
// (web-theming's tokenCss / paletteCss) read this one list, so a new role is
// added once, here, beside the derivation that produces it — never maintained as
// two "structurally compatible" parallel lists across a package boundary.
//
// A token is a terminal value, not a claim: every role's value is an optional
// string, and composition is last-wins merge. The roles split into three bands —
// colour (derived in OKLCH), type (family stacks), and layout (sizes) — but they
// share one flat namespace because a theme declares them together and the
// renderer emits them together.

/** Colour roles — derived perceptually in OKLCH from ink/surface/accent seeds. */
export type ColorTokens = {
  /** Primary text / marks. */
  ink?: string;
  /** Recessive text: captions, metadata, secondary marks. */
  inkSoft?: string;
  /** Page ground. */
  surface?: string;
  /** Raised or inset ground: cards, panels, code blocks. */
  surfaceDeep?: string;
  /** Borders and edges drawn on a surface. */
  surfaceEdge?: string;
  /** Hairline rules between content. */
  rule?: string;
  /** Faint wash fill: tag/quote/meta backgrounds. */
  tint?: string;
  /** Stronger wash fill: hover/active backgrounds. */
  tintStrong?: string;
  /** ::selection background. */
  selection?: string;
  /** Primary accent: links, citations, emphasis. */
  accent?: string;
  /** Alert accent: hazard, urgency. */
  alarm?: string;
  /** Visited-link colour. */
  visited?: string;
};

/** Non-colour token roles a full palette also carries (type stacks, layout). */
export type TypeTokens = {
  /** Sans / display family stack. */
  sans?: string;
  /** Serif / slab body family stack. */
  serif?: string;
  /** Monospace family stack. */
  mono?: string;
  /** Page side gutter. */
  gutter?: string;
  /** Maximum content width. */
  max?: string;
  /** Optimal reading measure. */
  measure?: string;
  /** Corner radius (0 for the hard-edged brutalist register). */
  radius?: string;
};

/** The canonical design-token vocabulary: every role a theme can declare. */
export type ThemeTokens = ColorTokens & TypeTokens;

/** The canonical role → CSS custom-property name mapping, in render order. */
const TOKEN_VARS: Readonly<Record<keyof ThemeTokens, string>> = Object.freeze({
  ink: "--ink",
  inkSoft: "--ink-soft",
  surface: "--surface",
  surfaceDeep: "--surface-deep",
  surfaceEdge: "--surface-edge",
  rule: "--rule",
  tint: "--tint",
  tintStrong: "--tint-strong",
  selection: "--selection",
  accent: "--accent",
  alarm: "--alarm",
  visited: "--visited",
  sans: "--sans",
  serif: "--serif",
  mono: "--mono",
  gutter: "--gutter",
  max: "--max",
  measure: "--measure",
  radius: "--radius",
});

/** The canonical token roles, in render order. */
export const THEME_TOKEN_ROLES = Object.freeze(
  Object.keys(TOKEN_VARS) as readonly (keyof ThemeTokens)[],
);

/** The canonical CSS custom-property name for a token role (e.g. `inkSoft` → `--ink-soft`). */
export function tokenVar(role: keyof ThemeTokens): string {
  return TOKEN_VARS[role];
}

/**
 * A palette is a `light` base plus optional `dark` overrides and named
 * `variants`; dark mode and theme switches fall out of this data when rendered.
 */
export type ThemePalette = {
  /** The default palette (also the light scheme). */
  light: ThemeTokens;
  /** Overrides applied under dark color-scheme and `[data-theme="dark"]`. */
  dark?: ThemeTokens;
  /** Named alternates, opt-in via `[data-theme="<name>"]`. */
  variants?: Readonly<Record<string, ThemeTokens>>;
};
