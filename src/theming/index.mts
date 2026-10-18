import { mark, webEvidence, type WebEvidence, type Utterance } from "../evidence.mjs";
import { joinKnowledgeReadings, type KnowledgeReading } from "../taxonomy/four.mjs";
import { admitTheme as dataAdmitTheme } from "@red-cup-engineering/web-theming-service/theming";

// Data owns deterministic document/CSS rendering; Web owns its evidence admission.
export { THEME_MEMBERS, attrs, el, escapeHtml, meta, viewportMeta, charsetMeta, THEME_TOKEN_ROLES, tokenVar, tokenCss, composeTokens, paletteCss, BASE_CSS, COMPONENT_CSS, assembleCss, derivePalette, deriveDark, themePalette, decodeTheme, isTheme, assertTheme, normalizeContext, render, renderNav, minimal, atelier } from "@red-cup-engineering/web-theming-service/theming";
export type { NavItem, HeadLink, ThemeContext, NormalizedThemeContext, Theme, ThemeTokens, ThemePalette, TokenCssOptions, PaletteSeeds, TypeTokens, ThemeSpec } from "@red-cup-engineering/web-theming-service/theming";

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

export function admitTheme(value: unknown): ThemeAdmission {
  const { themeName: name, judgments } = dataAdmitTheme(value);
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
