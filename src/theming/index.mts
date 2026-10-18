import { mark, webEvidence, type WebEvidence, type Utterance } from "../evidence.mjs";
import { joinKnowledgeReadings, type KnowledgeReading } from "../taxonomy/four.mjs";
import { attrs, el, escapeHtml as escapeHtmlText } from "../html.mjs";
import {
  themePalette,
  tokenVar,
  THEME_TOKEN_ROLES,
  type PaletteSeeds,
  type TypeTokens,
  type ThemeTokens,
  type ThemePalette,
} from "@red-cup-engineering/web-theming-service/theming-computer";

export { escapeHtmlText as escapeHtml };

export type NavItem = {
  href: string;
  label: string;
  current?: boolean;
};

export type HeadLink = {
  rel: string;
  href: string;
  type?: string;
  title?: string;
};

export type ThemeContext = {
  title?: string;
  lang?: string;
  description?: string;
  author?: string;
  siteName?: string;
  canonical?: string;
  stylesheets?: readonly string[];
  links?: readonly HeadLink[];
  nav?: readonly NavItem[];
  year?: number | string | null;
  nonce?: string;
  [key: string]: unknown;
};

export type NormalizedThemeContext = ThemeContext & {
  title: string;
  lang: string;
  description: string;
  author: string;
  siteName: string;
  canonical: string;
  stylesheets: readonly string[];
  links: readonly HeadLink[];
  nav: readonly NavItem[];
  year: number | string | null;
  nonce: string;
};

export type Theme = {
  name: string;
  head(ctx: NormalizedThemeContext): string;
  header(ctx: NormalizedThemeContext): string;
  footer(ctx: NormalizedThemeContext): string;
  wrap(articleHtml: string, ctx: NormalizedThemeContext): string;
  css: string;
};

export type ThemeAssessment = Readonly<{
  kind: "web.theme-assessment";
  value: KnowledgeReading;
  judgments: readonly ThemeJudgment[];
}>;

export type ThemeAdmission = {
  themeName: string;
  admitted: boolean;
  value: KnowledgeReading;
  judgments: readonly ThemeJudgment[];
  entries: readonly WebEvidence[];
  utterances: readonly Utterance[];
  settlement: ThemeAssessment;
  reasons: readonly string[];
};

export type ThemeJudgment = {
  value: KnowledgeReading;
  reason: string;
  path: string;
};

export const THEME_MEMBERS = Object.freeze(["name", "head", "header", "footer", "wrap", "css"] as const);

const LANDMARK_ROLE = Object.freeze({
  header: "banner",
  nav: "navigation",
  main: "main",
  footer: "contentinfo",
});

export { attrs, el };

export function meta(name: string, content: unknown): string {
  if (content === null || content === undefined || content === "") return "";
  return el("meta", { name, content });
}

export function viewportMeta(): string {
  return el("meta", { name: "viewport", content: "width=device-width, initial-scale=1" });
}

export function charsetMeta(): string {
  return el("meta", { charset: "utf-8" });
}

// ── Design tokens ──────────────────────────────────────────────────────────
//
// One canonical vocabulary of CSS custom properties, shared by every theme. A
// palette is data, not an opaque CSS string: each theme declares its values for
// the roles it uses and `tokenCss` renders the deterministic `:root` block.
// Themes keep their own values (561's bone, emsenn's warm grey, koios's red) —
// only the *names* are shared, so site CSS that references a role keeps working
// no matter which palette is in force. Layered palettes (light → dark, brand →
// instance) compose by last-wins merge with `composeTokens`; there is nothing to
// "settle" because a token is a terminal value, not a claim.

// The token vocabulary itself — the role list, the role → CSS-var mapping, and
// the ThemeTokens / ThemePalette types — lives beside the palette derivation in
// web-theming-computer, so a new role is added once, next to the code that
// produces its value. web-theming owns only the *renderer* below; it re-exports
// the vocabulary so this module stays the single import site for theme authors.
export { THEME_TOKEN_ROLES, tokenVar } from "@red-cup-engineering/web-theming-service/theming-computer";
export type { ThemeTokens, ThemePalette } from "@red-cup-engineering/web-theming-service/theming-computer";

export type TokenCssOptions = {
  /** Selector to attach the variables to (default `:root`). */
  selector?: string;
  /** Indent for each declaration (default two spaces). */
  indent?: string;
};

/** Render a palette to a CSS rule declaring each defined token as a custom property. */
export function tokenCss(tokens: ThemeTokens, options: TokenCssOptions = {}): string {
  const selector = options.selector ?? ":root";
  const indent = options.indent ?? "  ";
  const lines: string[] = [];
  for (const role of THEME_TOKEN_ROLES) {
    const value = tokens[role];
    if (value === undefined || value === null) continue;
    lines.push(`${indent}${tokenVar(role)}: ${value};`);
  }
  return `${selector} {\n${lines.join("\n")}\n}`;
}

/** Merge palette layers left-to-right; a later layer's defined token wins. */
export function composeTokens(...layers: readonly (ThemeTokens | null | undefined)[]): ThemeTokens {
  const out: ThemeTokens = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const role of THEME_TOKEN_ROLES) {
      const value = layer[role];
      if (value !== undefined && value !== null) out[role] = value;
    }
  }
  return out;
}

// ── Palettes & style variations ──────────────────────────────────────────────
//
// A palette is a `light` base plus optional `dark` and named `variants`. Dark
// mode falls out of the data: `paletteCss` emits the base on `:root`, the dark
// overrides under `@media (prefers-color-scheme: dark)`, and explicit
// `[data-theme="…"]` selectors so a site can pin or switch a variation without
// touching the OS preference. No hand-rolled media blocks per theme.

/** Render a palette to CSS: base `:root`, dark `@media`, and `[data-theme]` switches. */
export function paletteCss(palette: ThemePalette): string {
  const blocks = [tokenCss(palette.light)];
  if (palette.dark) {
    const dark = composeTokens(palette.light, palette.dark);
    blocks.push(`@media (prefers-color-scheme: dark) {\n${tokenCss(dark)}\n}`);
    blocks.push(tokenCss(palette.light, { selector: '[data-theme="light"]' }));
    blocks.push(tokenCss(dark, { selector: '[data-theme="dark"]' }));
  }
  if (palette.variants) {
    for (const [name, tokens] of Object.entries(palette.variants)) {
      blocks.push(tokenCss(composeTokens(palette.light, tokens), { selector: `[data-theme="${name}"]` }));
    }
  }
  return blocks.join("\n");
}

// ── Shared layers: reset + styled content components ──────────────────────────
//
// Every theme assembles its `css` from `paletteCss(palette)` + BASE_CSS +
// COMPONENT_CSS + its own chrome CSS. BASE_CSS is the reset; COMPONENT_CSS is the
// content-component library — prose, cards, feeds, breadcrumbs, toc, tags,
// tables, callouts, forms — written against the canonical tokens, so content is
// styled consistently no matter which palette is in force. This is the layer that
// lets the ecosystem ship styled content the way Hugo/Astro/WordPress themes do,
// instead of every site re-inventing a stylesheet.

export const BASE_CSS = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{color-scheme:light dark;-webkit-text-size-adjust:100%;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}
body{background:var(--surface);color:var(--ink);line-height:1.55;overflow-wrap:break-word;hyphens:auto}
img{max-width:100%;height:auto;display:block}
a{color:var(--accent)}
a:visited{color:var(--visited,var(--accent))}
::selection{background:var(--selection,var(--accent));color:var(--surface)}`;

export const COMPONENT_CSS = `/* Headings — type as mass: display face, tight, load-bearing. */
h1,h2,h3,h4,h5,h6{font-family:var(--sans);font-weight:700;line-height:1.1;letter-spacing:-.02em;text-wrap:balance;overflow-wrap:break-word}
h1{font-size:clamp(1.9rem,5vw,2.8rem);margin:0 0 .5rem}
h2{font-size:clamp(1.35rem,3vw,1.8rem);margin:2rem 0 .6rem;padding-top:.6rem;border-top:1px solid var(--rule)}
h3{font-size:1.2rem;margin:1.5rem 0 .4rem}
h4{font-size:1rem;margin:1.2rem 0 .3rem}
p{text-wrap:pretty}

/* Prose — the default styled content block. */
.prose{font-family:var(--serif);font-size:1.0625rem;line-height:1.6;max-width:var(--measure,42rem)}
.prose>*+*{margin-top:1.1rem}
.prose a{color:var(--accent);text-underline-offset:2px}
.prose strong{font-weight:700}
.prose em{font-style:italic}
.prose ul,.prose ol{padding-left:1.4rem}
.prose li+li{margin-top:.3rem}
.prose hr{border:0;border-top:2px solid var(--rule);margin:2rem 0}

/* Lede — opening paragraph. */
.lede{font-family:var(--serif);font-size:clamp(1.1rem,1.6vw,1.3rem);line-height:1.45;color:var(--ink)}

/* Figures. */
figure{margin:1.6rem 0}
figcaption{font-family:var(--mono);font-size:.78rem;color:var(--ink-soft);margin-top:.4rem}

/* Code. */
code{font-family:var(--mono);font-size:.88em;background:var(--surface-deep);padding:.1em .35em;border-radius:var(--radius,.25rem)}
pre{font-family:var(--mono);font-size:.85rem;background:var(--surface-deep);border:1px solid var(--surface-edge);padding:1rem;overflow-x:auto;border-radius:var(--radius,.25rem)}
pre code{background:none;padding:0}

/* Blockquote + callout. */
blockquote{margin:1.4rem 0;padding:.5rem 0 .5rem 1.2rem;border-left:3px solid var(--accent);font-style:italic;color:var(--ink-soft)}
.callout{background:var(--tint,var(--surface-deep));border-left:3px solid var(--accent);padding:.9rem 1.1rem;margin:1.4rem 0}

/* Held contradiction — the display state mainstream theming kits structurally
   lack, because none sit on a paraconsistent substrate. A cell our logic holds
   as both-witnessed-and-obstructed is SHOWN, never silently resolved (Cubist
   anti-closure: sustain the reading rather than collapse it). Anti-closure with
   rails: it is always visible (Tuftean integrity — contradiction is never
   hidden) yet restrained by default (Brutalist salience scarcity — not every
   mark shouts). [data-mode=audit] amplifies it into a salient block; calm mode
   keeps it a quiet underline. Themeable via --alarm; no new token names. */
[data-contested=true]{text-decoration:underline dotted var(--alarm,#c33);text-decoration-thickness:2px;text-underline-offset:2px;cursor:help}
[data-mode=calm] [data-contested=true]{text-decoration-style:dotted}
[data-mode=audit] [data-contested=true]{background:color-mix(in oklab,var(--alarm,#c33) 12%,transparent);outline:1px solid var(--alarm,#c33);padding:0 .15em;border-radius:var(--radius,0)}
.contested-strip{font-family:var(--mono);font-size:.8rem;color:var(--alarm,#c33);background:color-mix(in oklab,var(--alarm,#c33) 8%,transparent);border:1px solid var(--alarm,#c33);padding:.5rem .7rem;margin:.6rem 0;border-radius:var(--radius,0);white-space:pre-line}
/* Honest absence — a gap is rendered, not left blank (Tuftean integrity). */
.gap,[data-gap=true]{font-family:var(--mono);font-size:.85em;font-style:italic;color:var(--ink-soft)}

/* Card grid + cards. */
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));gap:1rem;margin:1.4rem 0}
.card{background:var(--surface-deep);border:1px solid var(--surface-edge);padding:1.1rem 1.2rem;border-radius:var(--radius,0)}
a.card{display:block;text-decoration:none;color:inherit;transition:border-color .12s}
a.card:hover{border-color:var(--accent)}
.card__title{font-family:var(--sans);font-weight:700;font-size:1.15rem;letter-spacing:-.02em}
.card__meta{font-family:var(--mono);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-soft)}

/* Feed / list of entries (h-feed). */
.h-feed,.feed{list-style:none;padding:0;margin:0}
.h-feed>li,.feed>li{padding:1rem 0;border-bottom:1px solid var(--rule)}
.feed__title{font-family:var(--sans);font-weight:700;font-size:1.2rem}
.feed__sum{color:var(--ink-soft);margin-top:.3rem;max-width:60ch}

/* Breadcrumbs. */
.breadcrumbs{font-family:var(--mono);font-size:.72rem;letter-spacing:.04em;color:var(--ink-soft);margin-bottom:.6rem}
.breadcrumbs a{color:var(--ink-soft)}
.breadcrumb-sep{margin:0 .35em;color:var(--surface-edge)}

/* Table of contents. */
.toc{border:1px solid var(--surface-edge);background:var(--surface-deep);padding:.8rem 1rem;margin:1.4rem 0}
.toc summary{font-family:var(--mono);font-size:.74rem;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-soft);cursor:pointer}
.toc ul{list-style:none;padding-left:1rem;margin:.4rem 0 0}
.toc a{font-family:var(--mono);font-size:.82rem;color:var(--ink-soft)}
.toc a:hover{color:var(--ink)}

/* Tags. */
.tags{display:flex;flex-wrap:wrap;gap:.35rem;margin:1rem 0}
.tag,.tags a,.p-category{display:inline-block;font-family:var(--mono);font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;text-decoration:none;border:1px solid var(--surface-edge);padding:.15em .5em;color:var(--ink-soft)}
.tag:hover,.tags a:hover,a.p-category:hover{background:var(--ink);color:var(--surface)}

/* Tables. */
table{border-collapse:collapse;width:100%;margin:1.4rem 0;font-size:.95em}
th,td{padding:.4em .7em;border:1px solid var(--rule);text-align:left}
thead th{font-family:var(--mono);font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;background:var(--surface-deep)}

/* Pagination. */
.pagination{display:flex;gap:1rem;justify-content:space-between;font-family:var(--mono);font-size:.8rem;margin:2rem 0;padding-top:1rem;border-top:1px solid var(--rule)}

/* Forms. */
input,button,textarea,select{font-family:var(--sans);font-size:.9rem;color:var(--ink);background:var(--surface);border:1.5px solid var(--surface-edge);padding:.4rem .6rem;border-radius:var(--radius,0)}
button{font-weight:700;cursor:pointer}
button:hover{background:var(--ink);color:var(--surface)}

/* Accessibility. */
.skip-to-content{position:absolute;left:-9999px}
.skip-to-content:focus{position:static}`;

/** Assemble a theme's full stylesheet: palette + reset + components + chrome layers. */
export function assembleCss(palette: ThemePalette, ...chrome: readonly string[]): string {
  return [paletteCss(palette), BASE_CSS, COMPONENT_CSS, ...chrome.filter((s) => s && s.length > 0)].join("\n\n");
}

// ── Theme codec: a compact spec → a full Theme ───────────────────────────────
//
// The thin way to ship a theme. Declare a few colour SEEDS (ink / surface /
// accent, optional alarm) plus type-and-layout tokens and chrome; decodeTheme
// derives the perceptual light palette in OKLCH and synthesises the dark scheme
// (both via web-theming-computer), then assembles the stylesheet. A theme package
// becomes just its spec — no hand-listed shades, dark mode for free. There is no
// honest inverse (a spec is the source, assembled CSS the artefact), so this is a
// decoder/builder, not a round-tripping codec.

/** Palette derivation, re-exported so web-theming is the single import site. */
export { derivePalette, deriveDark, themePalette } from "@red-cup-engineering/web-theming-service/theming-computer";
export type { PaletteSeeds, TypeTokens } from "@red-cup-engineering/web-theming-service/theming-computer";

export type ThemeSpec = {
  /** Theme name; sets `<body class="theme-NAME">`. */
  name: string;
  /** Colour seeds: light shades derived in OKLCH, dark synthesised from them. */
  seeds: PaletteSeeds;
  /** Type stacks + layout tokens, merged into both schemes. */
  type?: TypeTokens;
  /** Pin specific derived tokens (escape hatch), per scheme. */
  overrides?: { light?: Partial<ThemeTokens>; dark?: Partial<ThemeTokens> };
  /** App- or identity-specific CSS appended after the reset + component library. */
  chrome?: string;
  /** Chrome hooks; default to empty head/header/footer and a pass-through wrap. */
  head?: Theme["head"];
  header?: Theme["header"];
  footer?: Theme["footer"];
  wrap?: Theme["wrap"];
};

/**
 * Decode a ThemeSpec into a full Theme plus its derived light+dark palette. The
 * result is a valid `Theme` (so it passes straight to `render`) with an extra
 * `palette` field for consumers that compose the palette directly — e.g.
 * `assembleCss(theme.palette, moreChrome)` for a sibling surface.
 */
export function decodeTheme(spec: ThemeSpec): Theme & { palette: ThemePalette } {
  const base = themePalette(spec.seeds, spec.type);
  const palette: ThemePalette = {
    light: { ...base.light, ...(spec.overrides?.light ?? {}) },
    dark: { ...base.dark, ...(spec.overrides?.dark ?? {}) },
  };
  return {
    name: spec.name,
    css: assembleCss(palette, spec.chrome ?? ""),
    head: spec.head ?? (() => ""),
    header: spec.header ?? (() => ""),
    footer: spec.footer ?? (() => ""),
    wrap: spec.wrap ?? ((articleHtml: string) => articleHtml),
    palette,
  };
}

export function isTheme(value: unknown): value is Theme {
  if (value === null || typeof value !== "object") return false;
  const theme = value as Record<string, unknown>;
  if (typeof theme.name !== "string" || theme.name.length === 0) return false;
  if (typeof theme.css !== "string") return false;
  return (
    typeof theme.head === "function" &&
    typeof theme.header === "function" &&
    typeof theme.footer === "function" &&
    typeof theme.wrap === "function"
  );
}

export function assertTheme(value: unknown): asserts value is Theme {
  if (value === null || typeof value !== "object") throw new TypeError("theme: expected an object");
  const theme = value as Record<string, unknown>;
  if (typeof theme.name !== "string" || theme.name.length === 0) {
    throw new TypeError("theme.name: expected a non-empty string");
  }
  for (const member of ["head", "header", "footer", "wrap"]) {
    if (typeof theme[member] !== "function") throw new TypeError(`theme.${member}: expected a function`);
  }
  if (typeof theme.css !== "string") throw new TypeError('theme.css: expected a string (use "" if linked)');
}

function themeJudgments(value: unknown): ThemeJudgment[] {
  const judgments: ThemeJudgment[] = [];
  const theme = value as Record<string, unknown> | null;
  if (value === null || typeof value !== "object") {
    return [{ value: "active", reason: "theme value is not an object", path: "theme" }];
  }
  if (typeof theme?.name !== "string" || theme.name.length === 0) {
    judgments.push({ value: "active", reason: "theme.name must be a non-empty string", path: "theme.name" });
  }
  for (const member of ["head", "header", "footer", "wrap"]) {
    if (typeof theme?.[member] !== "function") {
      judgments.push({ value: "active", reason: `theme.${member} must be a function`, path: `theme.${member}` });
    }
  }
  if (typeof theme?.css !== "string") {
    judgments.push({ value: "active", reason: "theme.css must be a string", path: "theme.css" });
  }
  return judgments.length === 0
    ? [{ value: "potential", reason: "theme satisfies the render contract", path: "theme" }]
    : judgments;
}

export function admitTheme(value: unknown): ThemeAdmission {
  const name = typeof (value as { name?: unknown } | null)?.name === "string" ? String((value as { name: string }).name) : "anonymous";
  const judgments = Object.freeze(themeJudgments(value));
  const subject = mark(Object.freeze(["theme", name] as const));
  // A judgment made good claims satisfaction; a failed judgment claims the
  // contrary predicate — its own fact, never a denial of the first.
  const entries = Object.freeze(judgments.map((judgment) => webEvidence(
    subject,
    mark(judgment.value === "potential" ? "satisfies-theme-contract" : "violates-theme-contract"),
    mark(judgment.path),
    judgment.reason,
  )));
  const utterances = Object.freeze(entries.map((entry) => entry.utterance));
  const settlement: ThemeAssessment = Object.freeze({
    kind: "web.theme-assessment",
    value: judgments.reduce<KnowledgeReading>((value, judgment) => joinKnowledgeReadings(value, judgment.value), "absurd"),
    judgments,
  });
  return {
    themeName: name,
    admitted: settlement.value === "potential",
    value: settlement.value,
    judgments,
    entries,
    utterances,
    settlement,
    reasons: judgments.map((judgment) => judgment.reason),
  };
}

export function normalizeContext(ctx: ThemeContext = {}): NormalizedThemeContext {
  const siteName = typeof ctx.siteName === "string" ? ctx.siteName : "";
  const title = typeof ctx.title === "string" && ctx.title.length > 0
    ? ctx.title
    : siteName.length > 0 ? siteName : "Untitled";
  return {
    ...ctx,
    title,
    lang: typeof ctx.lang === "string" && ctx.lang.length > 0 ? ctx.lang : "en",
    description: typeof ctx.description === "string" ? ctx.description : "",
    author: typeof ctx.author === "string" ? ctx.author : "",
    siteName,
    canonical: typeof ctx.canonical === "string" ? ctx.canonical : "",
    stylesheets: Array.isArray(ctx.stylesheets) ? [...ctx.stylesheets] : [],
    links: Array.isArray(ctx.links) ? [...ctx.links] : [],
    nav: Array.isArray(ctx.nav) ? [...ctx.nav] : [],
    year: ctx.year ?? null,
    nonce: typeof ctx.nonce === "string" ? ctx.nonce : "",
  };
}

function renderHead(theme: Theme, ctx: NormalizedThemeContext): string {
  const parts = [
    charsetMeta(),
    viewportMeta(),
    el("title", null, escapeHtmlText(ctx.title)),
    meta("description", ctx.description || null),
    meta("author", ctx.author || null),
    meta("generator", `@red-cup-engineering/web-theming theme=${theme.name}`),
  ];
  if (ctx.canonical) parts.push(el("link", { rel: "canonical", href: ctx.canonical }));
  for (const href of ctx.stylesheets) {
    if (typeof href === "string" && href.length > 0) parts.push(el("link", { rel: "stylesheet", href }));
  }
  for (const link of ctx.links) {
    if (link && typeof link.rel === "string" && typeof link.href === "string") {
      parts.push(el("link", { rel: link.rel, href: link.href, type: link.type ?? null, title: link.title ?? null }));
    }
  }
  if (theme.css.length > 0) parts.push(el("style", ctx.nonce ? { nonce: ctx.nonce } : null, theme.css));
  const hook = theme.head(ctx);
  if (hook.length > 0) parts.push(hook);
  return parts.filter(Boolean).join("\n    ");
}

function renderMain(theme: Theme, articleHtml: string, ctx: NormalizedThemeContext): string {
  const body = articleHtml == null ? "" : String(articleHtml);
  const wrapped = theme.wrap(body, ctx);
  const inner = typeof wrapped === "string" ? wrapped : body;
  if (body.length > 0 && !inner.includes(body)) {
    throw new Error(`theme "${theme.name}" wrap() dropped or rewrote the article body; the engine article must pass through verbatim`);
  }
  return inner;
}

export function render(theme: Theme, articleHtml: string, context: ThemeContext = {}): string {
  assertTheme(theme);
  const ctx = normalizeContext(context);
  const head = renderHead(theme, ctx);
  const headerInner = theme.header(ctx);
  const footerInner = theme.footer(ctx);
  const main = renderMain(theme, articleHtml, ctx);
  const header = headerInner.length > 0 ? el("header", { role: LANDMARK_ROLE.header }, headerInner) : "";
  const footer = footerInner.length > 0 ? el("footer", { role: LANDMARK_ROLE.footer }, footerInner) : "";
  const mainEl = el("main", { id: "main-content", role: LANDMARK_ROLE.main }, `\n${main}\n`);
  const bodyParts = [header, mainEl, footer].filter(Boolean).join("\n");
  return `<!DOCTYPE html>
<html lang="${escapeHtmlText(ctx.lang)}">
<head>
    ${head}
</head>
<body class="theme-${escapeHtmlText(theme.name)}">
${bodyParts}
</body>
</html>
`;
}

export function renderNav(items: readonly NavItem[] | null | undefined, ariaLabel = "Primary"): string {
  if (!Array.isArray(items) || items.length === 0) return "";
  const links = items
    .filter((item) => item && typeof item.href === "string" && typeof item.label === "string")
    .map((item) => el("li", null, el(
      "a",
      { href: item.href, "aria-current": item.current ? "page" : null },
      escapeHtmlText(item.label),
    )))
    .join("");
  return el("nav", { role: LANDMARK_ROLE.nav, "aria-label": ariaLabel }, el("ul", null, links));
}

const MINIMAL_CSS = `:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;font:1rem/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;background:#fff}
@media(prefers-color-scheme:dark){body{color:#eee;background:#111}}
header[role=banner],footer[role=contentinfo]{padding:1rem;max-width:42rem;margin:0 auto}
main{max-width:42rem;margin:0 auto;padding:0 1rem}
h1{font-size:1.5rem;margin:0 0 .25rem}
nav ul{list-style:none;display:flex;gap:1rem;padding:0;margin:.5rem 0}
a{color:inherit}
[data-contested=true]{outline:2px solid var(--alarm,#c33);outline-offset:2px}
footer[role=contentinfo]{font-size:.85rem;opacity:.7;border-top:1px solid currentColor}`;

export const minimal: Theme = {
  name: "minimal",
  head() {
    return "";
  },
  header(ctx) {
    const masthead = ctx.siteName && ctx.siteName !== ctx.title
      ? el("p", { class: "site-name" }, escapeHtmlText(ctx.siteName))
      : "";
    return masthead + el("h1", null, escapeHtmlText(ctx.title)) + renderNav(ctx.nav, "Primary");
  },
  footer(ctx) {
    const who = ctx.siteName || ctx.author || "";
    const year = ctx.year != null ? `${ctx.year} ` : "";
    const text = who ? `${year}${who}`.trim() : "";
    return el("p", null, escapeHtmlText(text));
  },
  wrap(articleHtml) {
    return articleHtml;
  },
  css: MINIMAL_CSS,
};

const ATELIER_CSS = `:root{--ink:#1a1a1a;--paper:#fbfbf9;--accent:#7a4;--rule:#ddd;color-scheme:light dark}
@media(prefers-color-scheme:dark){:root{--ink:#e8e8e8;--paper:#16181c;--rule:#333}}
*{box-sizing:border-box}
body{margin:0;color:var(--ink);background:var(--paper);
  font:1.05rem/1.7 Georgia,"Iowan Old Style",Palatino,serif}
header[role=banner]{border-bottom:2px solid var(--rule);padding:1.25rem 1rem}
.masthead{max-width:46rem;margin:0 auto;display:flex;flex-wrap:wrap;align-items:baseline;gap:.75rem 1.5rem}
.masthead h1{font:600 1.6rem/1.2 system-ui,sans-serif;margin:0}
.site-name{font:600 .8rem/1 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;opacity:.7;margin:0}
nav[role=navigation] ul{list-style:none;display:flex;flex-wrap:wrap;gap:1rem;padding:0;margin:.5rem 0 0}
nav a{color:inherit;text-decoration:none;border-bottom:2px solid transparent}
nav a:hover,nav a[aria-current=page]{border-bottom-color:var(--accent)}
main{padding:2rem 1rem}
.prose{max-width:46rem;margin:0 auto}
.prose section.subject{margin:0 0 1.25rem}
[data-contested=true]{background:rgba(204,51,51,.12);outline:1px solid var(--alarm,#c33);padding:0 .15em}
footer[role=contentinfo]{border-top:2px solid var(--rule);margin-top:3rem;padding:1.5rem 1rem;
  font:.85rem/1.5 system-ui,sans-serif}
.colophon{max-width:46rem;margin:0 auto;display:flex;flex-wrap:wrap;justify-content:space-between;gap:1rem;opacity:.75}`;

export const atelier: Theme = {
  name: "atelier",
  head() {
    return el("meta", { name: "theme-color", content: "#7a4" });
  },
  header(ctx) {
    const eyebrow = ctx.siteName && ctx.siteName !== ctx.title
      ? el("p", { class: "site-name" }, escapeHtmlText(ctx.siteName))
      : "";
    return el("div", { class: "masthead" }, eyebrow + el("h1", null, escapeHtmlText(ctx.title))) + renderNav(ctx.nav, "Primary");
  },
  footer(ctx) {
    const who = ctx.author || ctx.siteName || "";
    const year = ctx.year != null ? `${ctx.year}` : "";
    const left = el("span", null, escapeHtmlText([year, who].filter(Boolean).join(" ")));
    const right = el("span", { class: "credit" }, "Set in atelier");
    return el("div", { class: "colophon" }, left + right);
  },
  wrap(articleHtml) {
    return el("div", { class: "prose" }, articleHtml);
  },
  css: ATELIER_CSS,
};
