import { createRequire } from "node:module";
import { isKnowledgeReading, type KnowledgeReading } from "./taxonomy/four.mjs";

/** Checked views of SignCell 0.4.2's published carrier schemas. */
export type Mark = Readonly<{ kind: "utterance.mark"; value: unknown }>;
export type Utterance = Readonly<{
  kind: "utterance.carrier";
  token: Readonly<{ kind: "utterance.token"; hand: "left"; mark: Mark }>;
  claim: Readonly<{ kind: "utterance.claim"; hand: "right"; mark: Mark }>;
}>;
export type Cell = Readonly<{
  subject: unknown; predicate: unknown; object: unknown;
  for: readonly unknown[]; against: readonly unknown[];
  value?: KnowledgeReading;
}>;

/** Web preserves opaque testimony outside the canonical carrier identity. */
export type WebEvidence = Readonly<{
  subject: Mark;
  predicate: Mark;
  object: Mark;
  provenance?: unknown;
  utterance: Utterance;
  cell: Cell;
}>;

const require = createRequire(import.meta.url);
function supplier(module: string, loaded: unknown, name: string): (...args: unknown[]) => unknown {
  if (!record(loaded) || typeof loaded[name] !== "function") {
    throw new TypeError(module + " must export " + name);
  }
  const call = loaded[name];
  return (...args) => call(...args);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
const ownerMark = supplier("@red-cup-engineering/signcell/mark", require("@red-cup-engineering/signcell/mark"), "mark");
const ownerIsMark = supplier("@red-cup-engineering/signcell/mark", require("@red-cup-engineering/signcell/mark"), "isMark");
const ownerUtterEvidence = supplier("@red-cup-engineering/signcell/utterance", require("@red-cup-engineering/signcell/utterance"), "utterEvidence");
const ownerIsUtterance = supplier("@red-cup-engineering/signcell/utterance", require("@red-cup-engineering/signcell/utterance"), "isUtterance");
const ownerCell = supplier("@red-cup-engineering/signcell/cell", require("@red-cup-engineering/signcell/cell"), "cell");
const ownerIsCell = supplier("@red-cup-engineering/signcell/cell", require("@red-cup-engineering/signcell/cell"), "isCell");

function isMark(value: unknown): value is Mark {
  return record(value) && exactKeys(value, ["kind", "value"])
    && value.kind === "utterance.mark" && ownerIsMark(value) === true;
}
function isUtterance(value: unknown): value is Utterance {
  if (!record(value) || !exactKeys(value, ["kind", "token", "claim"])
    || value.kind !== "utterance.carrier" || !record(value.token) || !record(value.claim)) return false;
  return exactKeys(value.token, ["kind", "hand", "mark"])
    && exactKeys(value.claim, ["kind", "hand", "mark"])
    && value.token.kind === "utterance.token" && value.token.hand === "left" && isMark(value.token.mark)
    && value.claim.kind === "utterance.claim" && value.claim.hand === "right" && isMark(value.claim.mark)
    && ownerIsUtterance(value) === true;
}
function isCell(value: unknown): value is Cell {
  return record(value) && exactKeys(value, ["subject", "predicate", "object", "for", "against"], ["value"])
    && Array.isArray(value.for) && Array.isArray(value.against)
    && (!Object.hasOwn(value, "value") || isKnowledgeReading(value.value))
    && ownerIsCell(value) === true;
}
export function mark(value: unknown): Mark {
  const result = ownerMark(value);
  if (!isMark(result)) throw new TypeError("SignCell mark returned an invalid carrier");
  return result;
}
/** The utterance witnesses its own claim; it does not attribute that claim to an actor.
 * Opaque supplied provenance is retained separately and is never coerced to JSON. */
export function webEvidence(subject: Mark, predicate: Mark, object: Mark, provenance?: unknown): WebEvidence {
  const entry = { subject, predicate, object };
  const utterance = ownerUtterEvidence(entry);
  if (!isUtterance(utterance)) throw new TypeError("SignCell utterance returned an invalid carrier");
  const cell = ownerCell(subject.value, predicate.value, object.value, { for: [utterance] });
  if (!isCell(cell)) throw new TypeError("SignCell cell returned an invalid carrier");
  return Object.freeze({ ...entry, ...(provenance === undefined ? {} : { provenance }), utterance, cell });
}

