import { createRequire } from "node:module";

/** Checked calls to HTML's published JavaScript string-rendering contract. */
const owner: unknown = createRequire(import.meta.url)("@red-cup-engineering/html-structural-projection-service/string-rendering");
function renderer(name: string): (...args: unknown[]) => string {
  if (typeof owner !== "object" || owner === null || !(name in owner)) {
    throw new TypeError("HTML string-rendering must export " + name);
  }
  const call: unknown = Reflect.get(owner, name);
  if (typeof call !== "function") throw new TypeError("HTML string-rendering must export " + name);
  return (...args) => {
    const value: unknown = call(...args);
    if (typeof value !== "string") throw new TypeError("HTML " + name + " must return a string");
    return value;
  };
}
const ownerEscape = renderer("escapeHtml");
const ownerAttrs = renderer("attrs");
const ownerEl = renderer("el");
export type HtmlStringAttributes = Readonly<Record<string, unknown>>;
export const escapeHtml = (value: unknown): string => ownerEscape(value);
export const attrs = (map?: HtmlStringAttributes | null): string => ownerAttrs(map);
export const el = (tag: string, attributes?: HtmlStringAttributes | null, children?: string | readonly string[]): string => ownerEl(tag, attributes, children);
