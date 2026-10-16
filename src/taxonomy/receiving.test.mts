import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  archiveHtml, archivePage, buildTaxonomy, members, membersWithContested,
  related, relatedItems, taxonomyIndex, termsOf, termsByPredicate,
  type FiniteAlgebra, type TaxonomyCellValue, type TaxonomyItem,
} from "./index.mjs";
import { joinKnowledgeReadings } from "./four.mjs";

const names: readonly TaxonomyCellValue[] = ["absurd", "potential", "active", "stable"];
const expected: Readonly<Record<TaxonomyCellValue, Readonly<Record<TaxonomyCellValue, TaxonomyCellValue>>>> = {
  absurd: { absurd: "absurd", potential: "potential", active: "active", stable: "stable" },
  potential: { absurd: "potential", potential: "potential", active: "stable", stable: "stable" },
  active: { absurd: "active", potential: "stable", active: "active", stable: "stable" },
  stable: { absurd: "stable", potential: "stable", active: "stable", stable: "stable" },
};
const term = { predicate: "tag", object: "Web" };
function input(value: TaxonomyCellValue): FiniteAlgebra {
  return value === "absurd" ? { subject: "s" } : { subject: "s", [value]: [term] };
}

test("all 16 joins use the real Data provider and preserve opposite-order and repeated evidence", () => {
  const data: unknown = createRequire(import.meta.url)("@red-cup-engineering/computer-data-engineering-services-section/four");
  assert.ok(data !== null && typeof data === "object" && "knowledgeJoinReading" in data);
  assert.equal(typeof data.knowledgeJoinReading, "function");
  if (typeof data.knowledgeJoinReading !== "function") throw new TypeError("missing genuine Data join");
  for (const left of names) for (const right of names) {
    const joined = expected[left][right];
    assert.equal(data.knowledgeJoinReading(left, right), joined);
    assert.equal(joinKnowledgeReadings(left, right), joined);
    assert.equal(buildTaxonomy([input(left), input(right)]).at("s", term), joined);
    assert.equal(buildTaxonomy([input(right), input(left)]).at("s", term), joined);
    assert.equal(buildTaxonomy([input(left), input(right), input(left), input(right)]).at("s", term), joined);
  }
  for (const value of names) assert.equal(joinKnowledgeReadings(value, value), value);
});

test("knowledge family refuses truth/told/extremal names and remains a static boundary", () => {
  for (const alien of ["true", "told true", "held", "unknown", null]) {
    assert.throws(() => Reflect.apply(joinKnowledgeReadings, undefined, [alien, "potential"]), /knowledge reading family/);
    assert.throws(() => Reflect.apply(joinKnowledgeReadings, undefined, ["potential", alien]), /knowledge reading family/);
  }
  function staticBoundary(): void {
    // @ts-expect-error Truth names are not knowledge-family readings.
    const cell: TaxonomyCellValue = "true";
    // @ts-expect-error The checked boundary does not accept extremal names.
    joinKnowledgeReadings("held", "potential");
    void cell;
  }
  void staticBoundary;
});

test("absent, denied, affirmed and contested membership stay distinct with custom predicates", () => {
  const custom = { predicate: "field", object: "work-board" };
  const relation = buildTaxonomy([
    { subject: "z", potential: [custom, custom, { predicate: "ignored", object: "x" }] },
    { subject: "a", active: [custom] },
    { subject: "c", potential: [custom], active: [custom] },
    { subject: "n" },
    { subject: "b", potential: [custom] },
  ], { predicates: ["field"] });
  assert.deepEqual(relation.subjects, ["z", "a", "c", "n", "b"]);
  assert.deepEqual(relation.terms, [custom]);
  assert.equal(relation.at("n", custom), "absurd");
  assert.equal(relation.at("missing", custom), "absurd");
  assert.equal(relation.at("z", { predicate: "ignored", object: "x" }), "absurd");
  assert.deepEqual(members(relation, custom), ["z", "b"]);
  assert.deepEqual(membersWithContested(relation, custom), [
    { subject: "z", contested: false }, { subject: "c", contested: true }, { subject: "b", contested: false },
  ]);
  assert.deepEqual(termsOf(relation, "c"), []);
  assert.deepEqual(termsOf(relation, "z"), [custom]);
  assert.deepEqual(related(relation, "z"), [{ subject: "b", shared: 1 }]);
  assert.deepEqual([...termsByPredicate(relation)], [["field", [custom]]]);
  assert.deepEqual(buildTaxonomy([input("potential")], { predicates: [] }).terms, [term]);
});

test("term ordering and related subject ties are deterministic", () => {
  const relation = buildTaxonomy([
    { subject: "z", potential: [{ predicate: "tag", object: "z" }, term] },
    { subject: "c", potential: [term] },
    { subject: "b", potential: [term] },
  ]);
  assert.deepEqual(relation.terms, [term, { predicate: "tag", object: "z" }]);
  assert.deepEqual(related(relation, "z"), [{ subject: "b", shared: 1 }, { subject: "c", shared: 1 }]);
});

test("archives preserve date/title sorting, encoded paths, clamps and page-size errors", () => {
  const items: TaxonomyItem[] = [
    { id: "b", url: "https://example.org/b", title: "Beta", published: "2026-01-01", terms: { "a/b": ["A/B"] } },
    { id: "c", url: "https://example.org/c", title: "Gamma", updated: "2026-02-01", terms: { "a/b": ["A/B"] } },
    { id: "a", url: "https://example.org/a", title: "Alpha", published: "2026-01-01", terms: { "a/b": ["A/B"] } },
  ];
  const index = taxonomyIndex(items);
  assert.deepEqual(index.terms[0]?.items.map(item => item.id), ["c", "a", "b"]);
  const first = archivePage(index, "a/b", "A/B", { baseUrl: "https://example.org/", archivePath: "/topics/:scheme/:term", pageSize: 1, page: -1 });
  assert.ok(first);
  assert.equal(first.page, 1);
  assert.equal(first.links.self, "https://example.org/topics/a%2Fb/a%252Fb?page=1");
  const last = archivePage(index, "a/b", "A/B", { baseUrl: "https://example.org/", pageSize: 1, page: 99 });
  assert.ok(last);
  assert.equal(last.page, 3);
  assert.equal(last.links.next, undefined);
  assert.equal(archivePage(index, "missing", "A/B", { baseUrl: "https://example.org/" }), null);
  assert.throws(() => archivePage(index, "a/b", "A/B", { baseUrl: "https://example.org/", pageSize: 0 }), /pageSize/);
  const target = items[0];
  assert.ok(target);
  assert.deepEqual(relatedItems(target, items).map(item => item.id), ["a", "c"]);
});

test("shared HTML codec escapes text, attributes, URLs and dates", () => {
  const unsafe = `<&>"'`;
  const item: TaxonomyItem = { id: "x", url: "https://example.org/?x=<tag>&a=\"b\"", title: unsafe, summary: unsafe, published: "2026-01-01", terms: { tag: [unsafe] } };
  const page = archivePage(taxonomyIndex([item]), "tag", unsafe, { baseUrl: "https://example.org/" });
  assert.ok(page);
  const html = archiveHtml(page);
  assert.ok(html.includes("&lt;&amp;&gt;&quot;&#39;"));
  assert.ok(!html.includes("<tag>"));
  assert.match(html, /x=&lt;tag&gt;&amp;a=&quot;b&quot;/);
});

