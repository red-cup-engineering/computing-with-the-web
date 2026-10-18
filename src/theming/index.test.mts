import test from "node:test";
import assert from "node:assert/strict";
import { THEME_MEMBERS, admitTheme, assertTheme, atelier, isTheme, minimal } from "./index.mjs";

// Web retains its distinct native evidence admission; Data owns the renderer cases.
test("theme contract is structural and exposes typed lesson admission judgments", () => {
  assert.deepEqual([...THEME_MEMBERS], ["name", "head", "header", "footer", "wrap", "css"]);
  assert.ok(isTheme(minimal));
  assert.ok(isTheme(atelier));
  assert.equal(isTheme({ name: "x", head() {}, header() {}, footer() {}, wrap() {} }), false);
  assert.throws(() => assertTheme({ name: "x", header() {}, footer() {}, wrap() {}, css: "" }), /theme\.head/);

  const good = admitTheme(minimal);
  assert.equal(good.admitted, true);
  assert.equal(good.value, "potential");
  assert.equal(good.judgments[0]?.path, "theme");
  assert.equal(good.settlement.value, "potential");
  assert.ok(good.entries[0]?.predicate);
  assert.ok(good.utterances[0]);
  assert.equal(good.utterances.length, good.entries.length);

  const bad = admitTheme({ name: "bad", head() {}, footer() {}, wrap() {}, css: "" });
  assert.equal(bad.admitted, false);
  assert.equal(bad.value, "active");
  // The failed judgment claims the contrary predicate as its own fact.
  assert.ok(bad.entries[0]?.predicate);
  assert.match(bad.reasons.join("\n"), /theme\.header/);
});

