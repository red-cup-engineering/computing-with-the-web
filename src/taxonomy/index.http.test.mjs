// Seventh original source case, adapted to the genuine current HTTP engine.
// emsenn/web-taxonomy@3834b98d; test blob 26a3296340eb7dd4e212d9addb2a9c4c871993c7.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createWebServer } from "@red-cup-engineering/http-services-section/web-application";
import { handler } from "@red-cup-engineering/http-services-section/web-application-pipeline";
import { taxonomyApp } from "../../dist/taxonomy/index.mjs";

const items = [
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


test("taxonomyApp serves taxonomy index and negotiated archive resources", async () => {
  const app = taxonomyApp({
    baseUrl: "https://example.org/",
    items,
    pageSize: 1,
  });
  const byId = new Map((app.resources ?? []).map((resource) => [resource.id, resource]));
  assert.equal(byId.get("taxonomy.index")?.route, "/taxonomy.json");
  assert.equal(byId.get("taxonomy.archive")?.route, "/taxonomy/:scheme/:term");

  const server = createServer(handler(createWebServer(app)));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const index = await fetch(`${base}/taxonomy.json`, { headers: { accept: "application/json" } });
    assert.equal(index.status, 200);
    assert.match(index.headers.get("cache-control") ?? "", /public.*max-age=300/);
    assert.equal((await index.json()).terms?.length, 6);

    const html = await fetch(`${base}/taxonomy/tag/linked-data?page=2`, { headers: { accept: "text/html" } });
    assert.equal(html.status, 200);
    assert.match(await html.text(), /rel="prev"/);

    const json = await fetch(`${base}/taxonomy/tag/linked-data`, { headers: { accept: "application/json" } });
    assert.equal(json.status, 200);
    assert.equal((await json.json()).totalItems, 2);

    const rejected = await fetch(`${base}/taxonomy/tag/linked-data`, { headers: { accept: "application/xml" } });
    assert.equal(rejected.status, 406);

    const missing = await fetch(`${base}/taxonomy/tag/missing`, { headers: { accept: "text/html" } });
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), "Not Found");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});


