import test from "node:test";
import assert from "node:assert/strict";
import { assertAssertion, provenanceOf, recognizerFrom } from "./wire.mjs";

test("wire admission preserves permissive historical shape and object identity", () => {
  const candidate = { e: "", a: "", extra: () => "opaque" };
  // The original static API requires v; runtime admission deliberately does not.
  // @ts-expect-error Historical runtime admission accepts an absent v; its static type requires it.
  assert.equal(assertAssertion(candidate), candidate);
  for (const invalid of [null, false, 0, "wire", {}, { e: "x" }, { e: 1, a: "p" }]) {
    assert.throws(() => {
      // @ts-expect-error Exercise values outside the static API at its runtime boundary.
      assertAssertion(invalid);
    }, /object with string e and a/);
  }
});

test("wire provenance preserves precedence, ignored conflicts and nonempty strings", () => {
  const wire = { e: "x", a: "p", v: 1, source: "first", signature: { by: "second" }, t: { by: "third" } };
  assert.deepEqual(provenanceOf(wire), { source: "first", kind: "source" });
  assert.deepEqual(provenanceOf({ ...wire, source: "" }), { source: "second", kind: "signature" });
  assert.deepEqual(provenanceOf({ ...wire, source: "", signature: { by: "" } }), { source: "third", kind: "witnessed-t" });
  assert.deepEqual(provenanceOf({ ...wire, source: " " }), { source: " ", kind: "source" });
  assert.equal(provenanceOf({ e: "x", a: "p", v: 1 }), null);
});

test("wire recognizers preserve live collections, array snapshots and own properties", () => {
  assert.equal(recognizerFrom(undefined)("x"), "potential");
  assert.equal(recognizerFrom(null)("x"), "potential");
  const set = new Set<string>();
  const readSet = recognizerFrom(set);
  assert.equal(readSet("x"), "absurd");
  set.add("x");
  assert.equal(readSet("x"), "potential");
  const map = new Map<string, unknown>();
  const readMap = recognizerFrom(map);
  assert.equal(readMap("x"), "absurd");
  map.set("x", "stable");
  assert.equal(readMap("x"), "stable");
  const array = ["first"];
  const readArray = recognizerFrom(array);
  array.push("later");
  assert.equal(readArray("later"), "absurd");
  assert.equal(readArray("first"), "potential");
  const record = Object.assign(Object.create({ inherited: "potential" }), { own: "active" });
  assert.equal(recognizerFrom(record)("inherited"), "absurd");
  assert.equal(recognizerFrom(record)("own"), "active");
});

test("wire recognition coercion prioritizes defined value over settled truthiness", () => {
  for (const [input, expected] of [
    [true, "potential"], [false, "absurd"],
    ["absurd", "absurd"], ["potential", "potential"], ["active", "active"], ["stable", "stable"],
    [{ value: { value: "stable" } }, "stable"], [{ value: false, settled: true }, "absurd"],
    [{ value: undefined, settled: "nonempty" }, "potential"],
    [{ value: null, settled: true }, "absurd"], [{ settled: 0 }, "absurd"],
    [{ settled: [] }, "potential"], ["true", "absurd"], [undefined, "absurd"],
  ] as const) assert.equal(recognizerFrom(() => input)("x"), expected);
});

