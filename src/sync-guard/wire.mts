// Web wire admission policy received from memetics-federation@0cd862144b.
// Provenance is a readable source claim, not cryptographic verification.
import type { KnowledgeReading } from "../taxonomy/four.mjs";

type ChargeValueName = KnowledgeReading;
export type Assertion = Readonly<{
  e: string;
  a: string;
  v: unknown;
  t?: unknown;
  source?: string;
  signature?: { by?: unknown };
}>;
export type AssertionTrace = readonly Assertion[];
export type Recognizer = (source: string) => unknown;
export type RecognitionInput = undefined | null | Recognizer | Set<string> | readonly string[] | Map<string, unknown> | Record<string, unknown>;
export type Provenance = Readonly<{ source: string; kind: "source" | "signature" | "witnessed-t" }>;

export function assertAssertion(assertion: Assertion): Assertion {
  if (!assertion || typeof assertion !== "object" || typeof assertion.e !== "string" || typeof assertion.a !== "string") {
    throw new TypeError("assertion must be an object with string e and a");
  }
  return assertion;
}

export function provenanceOf(assertion: Assertion): Provenance | null {
  if (typeof assertion.source === "string" && assertion.source) return Object.freeze({ source: assertion.source, kind: "source" });
  if (assertion.signature && typeof assertion.signature.by === "string" && assertion.signature.by) {
    return Object.freeze({ source: assertion.signature.by, kind: "signature" });
  }
  const t = assertion.t;
  if (t && typeof t === "object" && typeof (t as { by?: unknown }).by === "string" && (t as { by?: string }).by) {
    return Object.freeze({ source: (t as { by: string }).by, kind: "witnessed-t" });
  }
  return null;
}

export function recognizerFrom(input: RecognitionInput): (source: string) => ChargeValueName {
  if (input == null) return () => "potential";
  if (typeof input === "function") return (source) => coerceCharge(input(source));
  if (input instanceof Set) return (source) => input.has(source) ? "potential" : "absurd";
  if (Array.isArray(input)) {
    const set = new Set(input);
    return (source) => set.has(source) ? "potential" : "absurd";
  }
  if (input instanceof Map) return (source) => input.has(source) ? coerceCharge(input.get(source)) : "absurd";
  if (typeof input === "object") {
    return (source) => Object.prototype.hasOwnProperty.call(input, source)
      ? coerceCharge((input as Record<string, unknown>)[source])
      : "absurd";
  }
  return () => "absurd";
}

function coerceCharge(value: unknown): ChargeValueName {
  if (value === true) return "potential";
  if (value === false) return "absurd";
  if (value === "potential" || value === "active" || value === "absurd" || value === "stable") return value;
  if (value && typeof value === "object") {
    const object = value as { value?: unknown; settled?: unknown };
    if (object.value !== undefined) return coerceCharge(object.value);
    if (object.settled !== undefined) return object.settled ? "potential" : "absurd";
  }
  return "absurd";
}

