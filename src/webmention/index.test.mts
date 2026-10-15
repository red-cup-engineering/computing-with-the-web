// Received from emsenn/web-webmention src/index.test.mts @ d3a9d916,
// blob 5b0286115682b24b119adab28889add853ebad35.
// Test the original endpoint, verification, vouch, retraction, and sending
// contracts against their existing Red Cup webmention owner.
import test from "node:test";
import assert from "node:assert/strict";


import {
  acceptsTarget,
  classifyProps,
  decodeEntities,
  discoverEndpoint,
  documentBase,
  fragmentionFallbacks,
  headerValue,
  linksToTarget,
  outboundLinks,
  parseAttrs,
  parseMentionRequest,
  receiveMention,
  send,
  sendAll,
  sendSalmentions,
  validatePair,
  verifyMention,
  verifyVouch,
  webmentionEndpointsInHtml,
  webmentionEndpointsInLinkHeader,
  webmentionReceiverApp,
  type FetchLike,
  type ResponseLike,
} from "./index.mjs";

type Route = {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  finalUrl?: string;
};

type FetchLog = {
  url: string;
  method: string;
  body?: BodyInit | null;
  headers?: HeadersInit;
};

function fakeFetch(routes: Record<string, Route>, log: FetchLog[] = []): FetchLike {
  return async (url, init = {}) => {
    log.push({
      url,
      method: init.method ?? "GET",
      ...(init.body === undefined ? {} : { body: init.body }),
      ...(init.headers === undefined ? {} : { headers: init.headers }),
    });
    const route = routes[url];
    if (!route) throw new Error(`no route for ${url}`);
    const headers = new Map(Object.entries(route.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    return {
      url: route.finalUrl ?? url,
      status: route.status ?? 200,
      headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
      async text() { return route.body ?? ""; },
    } satisfies ResponseLike;
  };
}

test("HTML helpers parse attributes, entities, base, and rel=webmention endpoints", () => {
  assert.deepEqual(parseAttrs(`rel="webmention" href='/wm' class=u-like-of hidden`), {
    rel: "webmention",
    href: "/wm",
    class: "u-like-of",
    hidden: "",
  });
  assert.equal(decodeEntities("a&amp;b &#65;&#x42;"), "a&b AB");
  assert.equal(documentBase(`<base href="/root/">`, "https://example.org/post"), "https://example.org/root/");
  assert.deepEqual(
    webmentionEndpointsInHtml(`<a href="/first" rel="other webmention"></a><link rel="webmention" href="">`, "https://example.org/post"),
    ["https://example.org/first", "https://example.org/post"],
  );
  assert.deepEqual(webmentionEndpointsInHtml(`<script><a rel="webmention" href="/bad"></script><link rel="webmention" href="/ok">`, "https://e.test/"), [
    "https://e.test/ok",
  ]);
});

test("Link header discovery is parsed and preferred over HTML", async () => {
  assert.deepEqual(webmentionEndpointsInLinkHeader(`</wm>; rel="other webmention"`, "https://target.example/post"), [
    "https://target.example/wm",
  ]);
  assert.equal(headerValue({ Link: "</wm>; rel=webmention" }, "link"), "</wm>; rel=webmention");

  const result = await discoverEndpoint("https://target.example/post", {
    fetchImpl: fakeFetch({
      "https://target.example/post": {
        headers: { link: "</header-wm>; rel=\"webmention\"", "content-type": "text/html" },
        body: `<link rel="webmention" href="/html-wm">`,
      },
    }),
  });
  assert.equal(result.endpoint, "https://target.example/header-wm");
  assert.equal(result.via, "link-header");
});

test("HTML discovery resolves base-relative endpoints when no Link header exists", async () => {
  const result = await discoverEndpoint("https://target.example/post", {
    fetchImpl: fakeFetch({
      "https://target.example/post": {
        headers: { "content-type": "text/html; charset=utf-8" },
        body: `<base href="https://target.example/wm-root/"><a rel="webmention" href="endpoint">`,
      },
    }),
  });
  assert.equal(result.endpoint, "https://target.example/wm-root/endpoint");
  assert.equal(result.via, "html");
});

test("verification requires exact target links and classifies mf2 response types", async () => {
  const target = "https://me.example/article";
  const html = `<a href="${target}" class="u-in-reply-to">reply</a><a href="https://me.example/other">near miss</a>`;

  const hits = linksToTarget(html, "https://them.example/post", target);
  assert.equal(hits.length, 1);
  assert.equal(classifyProps(hits[0]!.mf2Props), "reply");
  assert.equal(validatePair("https://same.example/a", "https://same.example/a"), "source and target must differ");

  const verdict = await verifyMention("https://them.example/post", target, {
    fetchImpl: fakeFetch({
      "https://them.example/post": {
        headers: { "content-type": "text/html" },
        body: html,
      },
    }),
  });
  assert.equal(verdict.status, "verified");
  assert.equal(verdict.verified, true);
  assert.equal(verdict.type, "reply");
  assert.equal(verdict.linkCount, 1);
});

test("fragmention fallback matches canonical targets without the fragment", () => {
  const html = `<a href="https://me.example/article">quoted section</a>`;
  const hits = linksToTarget(html, "https://them.example/post", "https://me.example/article#quoted-section");

  assert.deepEqual(fragmentionFallbacks("https://me.example/article#quoted-section"), ["https://me.example/article"]);
  assert.equal(hits.length, 1);
});

test("verification covers delete and update retraction semantics", async () => {
  const target = "https://me.example/article";
  const deleted = await verifyMention("https://them.example/post", target, {
    fetchImpl: fakeFetch({ "https://them.example/post": { status: 410 } }),
  });
  assert.equal(deleted.status, "deleted");
  assert.equal(deleted.retract, true);

  const retracted = await verifyMention("https://them.example/post", target, {
    fetchImpl: fakeFetch({
      "https://them.example/post": { headers: { "content-type": "text/html" }, body: `<a href="https://elsewhere.example/">gone</a>` },
    }),
  });
  assert.equal(retracted.status, "retracted");
  assert.equal(retracted.retract, true);
});

test("receiver parses form and JSON bodies, rejects off-site targets, and verifies accepted pairs", async () => {
  const form = parseMentionRequest("source=https%3A%2F%2Fthem.example%2Fp&target=https%3A%2F%2Fme.example%2Fa");
  assert.equal(form.ok, true);
  assert.equal(parseMentionRequest("source=https%3A%2F%2Fthem.example%2Fp&target=https%3A%2F%2Fme.example%2Fa&vouch=https%3A%2F%2Fvouch.example%2Fp").vouch, "https://vouch.example/p");
  assert.equal(parseMentionRequest("source=x").status, 400);
  assert.equal(parseMentionRequest("{", "application/json").reason, "invalid JSON body");
  assert.equal(acceptsTarget("https://me.example/a", "https://me.example/"), true);
  assert.equal(acceptsTarget("https://other.example/a", "https://me.example/"), false);

  const result = await receiveMention("source=https%3A%2F%2Fthem.example%2Fp&target=https%3A%2F%2Fme.example%2Fa", {
    baseUrl: "https://me.example/",
    verify: async (source, target) => ({
      status: "verified",
      verified: true,
      retract: false,
      type: "mention",
      linkCount: 1,
      httpStatus: 200,
      source,
      target,
    }),
  });
  assert.equal(result.accepted, true);
  assert.equal(result.status, 202);
  assert.equal(result.verdict?.status, "verified");
});

test("vouch verification requires a third-party page linking to source and target", async () => {
  const source = "https://them.example/post";
  const target = "https://me.example/article";
  const vouch = "https://vouch.example/friend";
  const verdict = await verifyVouch(vouch, source, target, {
    fetchImpl: fakeFetch({
      [vouch]: {
        headers: { "content-type": "text/html" },
        body: `<a href="${source}">source</a><a href="${target}">target</a>`,
      },
    }),
  });
  const invalid = await verifyVouch(vouch, source, target, {
    fetchImpl: fakeFetch({
      [vouch]: {
        headers: { "content-type": "text/html" },
        body: `<a href="${source}">source only</a>`,
      },
    }),
  });

  assert.equal(verdict.verified, true);
  assert.equal(verdict.linkCount, 2);
  assert.equal(invalid.status, "invalid");
});

test("receiver can require a verified vouch", async () => {
  const result = await receiveMention("source=https%3A%2F%2Fthem.example%2Fp&target=https%3A%2F%2Fme.example%2Fa&vouch=https%3A%2F%2Fvouch.example%2Fp", {
    baseUrl: "https://me.example/",
    requireVouch: true,
    verifyVouch: async (vouch, source, target) => ({
      status: "verified",
      verified: true,
      vouch,
      source,
      target,
      linkCount: 2,
      httpStatus: 200,
    }),
    verify: async (source, target) => ({
      status: "verified",
      verified: true,
      retract: false,
      type: "mention",
      linkCount: 1,
      httpStatus: 200,
      source,
      target,
    }),
  });
  const rejected = await receiveMention("source=https%3A%2F%2Fthem.example%2Fp&target=https%3A%2F%2Fme.example%2Fa", {
    baseUrl: "https://me.example/",
    requireVouch: true,
  });

  assert.equal(result.accepted, true);
  assert.equal(rejected.status, 400);
  assert.equal(rejected.reason, "vouch is required");
});

test("sender discovers endpoints and posts the exact form body", async () => {
  const log: FetchLog[] = [];
  const fetchImpl = fakeFetch({
    "https://target.example/post": {
      headers: { link: "</wm>; rel=\"webmention\"" },
    },
    "https://target.example/wm": {
      status: 202,
      headers: { location: "https://target.example/wm/status/1" },
    },
  }, log);

  const result = await send("https://me.example/source", "https://target.example/post", { fetchImpl });
  assert.equal(result.status, "sent");
  assert.equal(result.endpoint, "https://target.example/wm");
  assert.equal(result.location, "https://target.example/wm/status/1");
  assert.equal(log[1]?.method, "POST");
  assert.equal(log[1]?.body, "source=https%3A%2F%2Fme.example%2Fsource&target=https%3A%2F%2Ftarget.example%2Fpost");

  const vouched = await send("https://me.example/source", "https://target.example/post", {
    fetchImpl,
    endpoint: "https://target.example/wm",
    vouch: "https://vouch.example/friend",
  });
  assert.equal(vouched.status, "sent");
  assert.equal(log[2]?.body, "source=https%3A%2F%2Fme.example%2Fsource&target=https%3A%2F%2Ftarget.example%2Fpost&vouch=https%3A%2F%2Fvouch.example%2Ffriend");

  const all = await sendAll("https://me.example/source", ["https://target.example/post"], { fetchImpl });
  assert.equal(all.length, 1);
  assert.equal(all[0]?.status, "sent");
});

test("Salmention extracts third-party links and sends Webmentions onward", async () => {
  const log: FetchLog[] = [];
  const source = "https://me.example/source";
  const html = [
    `<a href="${source}">self</a>`,
    `<a href="https://target.example/a">a</a>`,
    `<a href="https://target.example/b">b</a>`,
  ].join("");
  const fetchImpl = fakeFetch({
    "https://target.example/a": { headers: { link: "</wm>; rel=\"webmention\"" } },
    "https://target.example/wm": { status: 202 },
    "https://target.example/b": { headers: { link: "</wm>; rel=\"webmention\"" } },
  }, log);

  assert.deepEqual(outboundLinks(html, source), [
    "https://me.example/source",
    "https://target.example/a",
    "https://target.example/b",
  ]);
  const sent = await sendSalmentions(source, html, { fetchImpl });
  assert.deepEqual(sent.map((result) => result.target), ["https://target.example/a", "https://target.example/b"]);
  assert.deepEqual(sent.map((result) => result.status), ["sent", "sent"]);
});

test("Webmention receiver exposes the owning HTTP app resource", () => {
  const app = webmentionReceiverApp({ baseUrl: "https://me.example/" });
  const resource = app.resources?.[0];
  assert.ok(resource);
  assert.equal(resource.route, "/webmention");
  assert.equal(resource.id, "webmention.receiver");
  assert.equal(resource.name, "Webmention Receiver");
});
