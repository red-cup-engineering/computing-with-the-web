// Original six pure cases from emsenn/web-taxonomy@3834b98d, test blob
// 26a3296340eb7dd4e212d9addb2a9c4c871993c7; seventh case is index.http.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";


import {
  archiveHtml,
  archivePage,
  buildTaxonomy,
  members,
  membersWithContested,
  related,
  relatedItems,
  slugTerm,
  taxonomyIndex,
  termsByPredicate,
  termsOf,
  type TaxonomyItem,
} from "./index.mjs";

const items: TaxonomyItem[] = [
  {
    id: "a",
    url: "https://example.org/a",
    title: "Alpha",
    summary: "First",
    published: "2026-06-01T00:00:00Z",
    terms: { tag: ["Web"], category: ["Notes"], author: ["Avery"] },
  },
  {
    id: "b",
    url: "https://example.org/b",
    title: "Beta",
    summary: "Second",
    published: "2026-06-02T00:00:00Z",
    terms: { tag: ["web", "linked data"], category: ["Notes"], author: ["Blair"] },
  },
  {
    id: "c",
    url: "https://example.org/c",
    title: "Gamma",
    published: "2026-06-03T00:00:00Z",
    terms: { tag: ["linked data"], category: ["Reports"], author: ["Avery"] },
  },
];

test("slugTerm creates stable lowercase URL tokens", () => {
  assert.equal(slugTerm("Linked Data"), "linked-data");
  assert.equal(slugTerm("a/b"), "a%2Fb");
});

test("taxonomyIndex groups items by scheme and term", () => {
  const index = taxonomyIndex(items);
  const web = index.terms.find((term) => term.scheme === "tag" && term.slug === "web");
  const notes = index.terms.find((term) => term.scheme === "category" && term.slug === "notes");

  assert.deepEqual(index.schemes, ["author", "category", "tag"]);
  assert.equal(web?.count, 2);
  assert.deepEqual(web?.items.map((item) => item.id), ["b", "a"]);
  assert.equal(notes?.count, 2);
});

test("archivePage slices a taxonomy archive with rel navigation links", () => {
  const page = archivePage(taxonomyIndex(items), "tag", "linked-data", {
    baseUrl: "https://example.org/",
    pageSize: 1,
    page: 1,
  });

  assert.ok(page);
  assert.equal(page.totalItems, 2);
  assert.equal(page.totalPages, 2);
  assert.equal(page.items[0]?.id, "c");
  assert.equal(page.links.self, "https://example.org/taxonomy/tag/linked-data?page=1");
  assert.equal(page.links.next, "https://example.org/taxonomy/tag/linked-data?page=2");
  assert.equal(page.links.last, "https://example.org/taxonomy/tag/linked-data?page=2");
});

test("relatedItems ranks by shared taxonomy terms", () => {
  const related = relatedItems(items[0]!, items);

  assert.deepEqual(related.map((item) => item.id), ["b", "c"]);
});

test("buildTaxonomy preserves four-valued relation reads from finite algebras", () => {
  const taxonomy = buildTaxonomy([
    {
      subject: "post-a",
      potential: [
        { predicate: "tag", object: "web" },
        { predicate: "category", object: "notes" },
      ],
    },
    {
      subject: "post-b",
      potential: [
        { predicate: "tag", object: "web" },
        { predicate: "author", object: "avery" },
      ],
      active: [{ predicate: "category", object: "notes" }],
    },
    {
      subject: "post-c",
      stable: [{ predicate: "tag", object: "web" }],
      potential: [{ predicate: "author", object: "avery" }],
    },
  ]);

  assert.deepEqual(taxonomy.subjects, ["post-a", "post-b", "post-c"]);
  assert.equal(taxonomy.at("post-b", { predicate: "category", object: "notes" }), "active");
  assert.equal(taxonomy.at("post-c", { predicate: "tag", object: "web" }), "stable");
  assert.equal(taxonomy.at("post-c", { predicate: "category", object: "notes" }), "absurd");
  assert.deepEqual(members(taxonomy, { predicate: "tag", object: "web" }), ["post-a", "post-b"]);
  assert.deepEqual(membersWithContested(taxonomy, { predicate: "tag", object: "web" }), [
    { subject: "post-a", contested: false },
    { subject: "post-b", contested: false },
    { subject: "post-c", contested: true },
  ]);
  assert.deepEqual(termsOf(taxonomy, "post-b"), [
    { predicate: "author", object: "avery" },
    { predicate: "tag", object: "web" },
  ]);
  assert.deepEqual(termsByPredicate(taxonomy).get("tag"), [{ predicate: "tag", object: "web" }]);
  assert.deepEqual(related(taxonomy, "post-b"), [
    { subject: "post-a", shared: 1 },
    { subject: "post-c", shared: 1 },
  ]);
});

test("archiveHtml emits archive and pagination markup", () => {
  const page = archivePage(taxonomyIndex(items), "tag", "web", {
    baseUrl: "https://example.org/",
    pageSize: 10,
  });
  assert.ok(page);
  const html = archiveHtml(page);

  assert.match(html, /class="taxonomy-archive"/);
  assert.match(html, /data-scheme="tag"/);
  assert.match(html, /data-term="Web"/);
  assert.match(html, /rel="first"/);
  assert.match(html, /Alpha/);
});

