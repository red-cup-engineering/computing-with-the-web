import test from "node:test";
import assert from "node:assert/strict";
import { archiveHtml, archivePage, buildTaxonomy, members, membersWithContested, taxonomyIndex } from "../dist/taxonomy/index.mjs";
import { taxonomyItemFromTraceEntry, taxonomyAlgebraFromTraceEntry, relationDocument } from "./fixtures/swarm-taxonomy-projection.mjs";

test("pinned SWARM pure projections preserve positive, negative, both and neither archives and relation.json", () => {
  const cases = [
    { label: "potential", value: [true, false], evidence: [["ada"], []], mark: "title", object: "compile" },
    { label: "active", value: [false, true], evidence: [[], ["bea"]], mark: "blocked", object: "route dispute" },
    { label: "stable", value: [true, true], evidence: [["ada"], ["bea"]], mark: "claim", object: "both" },
    { label: "absurd", value: [false, false], evidence: [[], []], mark: "unknown", object: "neither" },
  ];
  const entries = cases.map((c, i) => ({
    e: `stigmergy/fields/work-board/build/w${i + 1}`,
    a: { predicate: "swarm:stigmergy-mark", field: `work-board/build/w${i + 1}`, mark: c.mark, object: c.object },
    v: { value: c.value, evidence: c.evidence },
    t: { at: `2026-06-08T00:0${i}:00.000Z` },
  }));
  const options = { baseUrl: "https://swarm.example/" };
  const items = entries.map(entry => taxonomyItemFromTraceEntry(entry, options));
  const relation = buildTaxonomy(entries.map(taxonomyAlgebraFromTraceEntry), {
    predicates: ["charge", "subject", "predicate", "object", "field", "mark", "family", "witness"],
  });
  const index = taxonomyIndex(items);
  assert.equal(items.length, 4);
  assert.ok(index.schemes.includes("charge"));
  assert.ok(index.schemes.includes("predicate"));
  assert.ok(index.terms.some(term => term.scheme === "family" && term.term === "work-board"));
  for (const [i, c] of cases.entries()) {
    const item = items[i];
    assert.equal(relation.at(item.id, { predicate: "predicate", object: c.mark }), c.label);
    assert.equal(relation.at(item.id, { predicate: "charge", object: c.label }), "potential");
    const archive = archivePage(index, "charge", c.label, { ...options, pageSize: 1 });
    assert.ok(archive);
    assert.equal(archive.totalItems, 1);
    assert.equal(archive.pageSize, 1);
    assert.match(archiveHtml(archive), new RegExp(c.label + " " + c.mark + " " + c.object));
    assert.equal(archive.items[0].id, item.id);
  }
  const family = { predicate: "family", object: "work-board" };
  assert.deepEqual(members(relation, family), [items[0].id]);
  assert.deepEqual(membersWithContested(relation, family), [
    { subject: items[0].id, contested: false },
    { subject: items[2].id, contested: true },
  ]);
  // This is the actual pure document function behind the old relation.json route.
  const document = JSON.parse(JSON.stringify(relationDocument(relation)));
  assert.equal(document.cells.length, 4);
  assert.ok(document.cells.every(cell => cell.terms.every(term => term.value !== "absurd")));
  assert.ok(document.cells[1].terms.some(term => term.predicate === "predicate" && term.object === "blocked" && term.value === "active"));
  assert.ok(document.cells[2].terms.some(term => term.predicate === "predicate" && term.object === "claim" && term.value === "stable"));
  assert.deepEqual(document.cells[3].terms, [{ predicate: "charge", object: "absurd", value: "potential" }]);
});

