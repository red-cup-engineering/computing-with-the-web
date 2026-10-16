import test from "node:test";
import assert from "node:assert/strict";
import { mark, webEvidence } from "./evidence.mjs";

test("Web evidence uses genuine SignCell carriers and preserves opaque testimony", () => {
  const testimony = { by: "test-witness", callback() { return "not JSON"; } };
  const entry = webEvidence(mark("theme"), mark("violates-theme-contract"), mark("theme.header"), testimony);
  assert.equal(entry.provenance, testimony);
  assert.equal(entry.utterance.kind, "utterance.carrier");
  assert.equal(entry.utterance.token.hand, "left");
  assert.equal(entry.utterance.claim.mark.value, "violates-theme-contract");
  assert.deepEqual(entry.cell.subject, "theme");
  assert.deepEqual(entry.cell.predicate, "violates-theme-contract");
  assert.deepEqual(entry.cell.object, "theme.header");
  assert.deepEqual(entry.cell.for, [entry.utterance]);
  assert.deepEqual(entry.cell.against, []);
  assert.equal(entry.cell.value, undefined);
  const noTestimony = webEvidence(mark("a"), mark("GET text/html"), mark("b"));
  assert.equal(Object.hasOwn(noTestimony, "provenance"), false);
});

