// Source of TPF filtering, Hydra and Turtle contracts: emsenn/web-triple-pattern-fragments
// src/index.test.mts @14a3ac30, blob fe5ebcf8dcc50cbb8de8f4eb565f4442788f66d0.
import test from "node:test";
import assert from "node:assert/strict";
import {
  allTriples, tripleMatches, queryTriples, fragmentJson, fragmentJsonLd, fragmentTurtle, tpfApp,
  type FoldedEvidence,
} from "./index.mjs";

const folds: readonly FoldedEvidence[] = [{
  entity: "news:example",
  fiber: [
    { predicate: "title", object: "Example", value: { evidence: [["origin:one"], []] } },
    { predicate: "approved", object: true, value: { evidence: [[], ["critic:one"]] } },
    { predicate: "ranking", object: 7, value: { evidence: [["editor"], ["critic"]] } },
    { predicate: "unknown", object: false, value: { evidence: [[], []] } },
  ],
}];

test("EAVT fold preserves distinct for/against witnesses without promoting unknowns", () => {
  const rows = allTriples(folds);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.state).sort(), ["active", "potential", "stable"]);
  const contested = rows.find(row => row.predicate === "ranking");
  assert.equal(contested?.state, "stable");
  assert.deepEqual(contested?.claimedBy, "editor");
  assert.deepEqual(contested?.contraryClaimedBy, "critic");
  assert.equal(rows.some(row => row.predicate === "unknown"), false);
  assert.equal(tripleMatches(contested!, { witness: "critic" }), true);
});

test("filtered witnessed TPF pages retain count, stable order and Hydra page links", () => {
  const result = queryTriples(folds, {}, { base: "https://example.org/", path: "/query", limit: 1, page: 2 });
  assert.equal(result.totalItems, 3);
  assert.equal(result.totalPages, 3);
  assert.equal(result.triples.length, 1);
  assert.match(result.links.self, /page=2/);
  assert.match(result.links.previous!, /page=1/);
  assert.match(result.links.next!, /page=3/);
  assert.equal(fragmentJson(result).count, 1);
  assert.equal(queryTriples(folds, { witness: "critic" }).totalItems, 1);
});

test("JSON-LD retains Hydra controls and documentary state and witness", () => {
  const page = queryTriples(folds, { p: "ranking" }, { base: "https://example.org/" });
  const doc = fragmentJsonLd(page, { base: "https://example.org/" });
  assert.equal(doc["hydra:totalItems"], 1);
  assert.equal(doc["void:triples"], 1);
  assert.ok(doc["hydra:search"]);
  const member = (doc["hydra:member"] as Record<string, unknown>[])[0]!;
  assert.equal(member.state, "stable");
  assert.deepEqual(member.witness, ["editor", "critic"]);
});

test("Turtle delegates reified testimony to the owning RDF service", () => {
  const doc = fragmentTurtle(queryTriples(folds), { base: "https://example.org/" });
  assert.match(doc, /hydra:Collection/);
  assert.match(doc, /rdf:Statement/);
  assert.match(doc, /ContestedClaim/);
  assert.match(doc, /OpposedClaim/);
});

test("web resource mounts TPF at one negotiated HTTP endpoint", () => {
  const app = tpfApp({ source: folds, base: "https://example.org/" });
  const resource = app.resources?.[0];
  assert.ok(resource);
  assert.equal(resource.id, "triple-pattern-fragments.query");
  assert.equal(resource.route, "/query");
  assert.deepEqual(resource.methods, ["GET"]);
  assert.deepEqual(resource.produces, ["application/ld+json", "application/json", "text/turtle"]);
});

test("configured maximum bounds implicit and explicit page sizes and refuses invalid maxima", () => {
  for (const limit of [undefined, 0, -1, NaN, Infinity, 1000]) {
    const page = queryTriples(folds, {}, { ...(limit === undefined ? {} : { limit }), maxLimit: 2 });
    assert.equal(page.limit, 2);
    assert.equal(page.triples.length, 2);
    assert.equal(page.totalPages, 2);
    assert.match(page.links.next!, /limit=2/);
  }
  assert.equal(queryTriples(folds, {}, { limit: 1, maxLimit: 2 }).limit, 1);
  for (const maxLimit of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => queryTriples(folds, {}, { maxLimit }), /maxLimit must be a positive safe integer/);
  }
});
