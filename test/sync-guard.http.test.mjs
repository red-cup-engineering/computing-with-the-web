// Original HTTP case; the owning Node-context adapter and no-import assertions.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { contextFor, nativeHttpHandler } from "@red-cup-engineering/computer-web-server/native-application";
import { syncGuardApp, validateSyncAssertions } from "../dist/sync-guard/index.mjs";
const assertions = [
    { e: "claims/alpha", a: "title", v: "Alpha", t: { by: "peer-a" } },
    { e: "claims/alpha", a: "status", v: "published", source: "peer-a" },
];
test("syncGuardApp retains the direct handler Repr contract", async () => {
    const app = syncGuardApp({ exportAssertions: () => assertions, importAssertions: () => 0 });
    const req = new IncomingMessage(new Socket());
    req.method = "GET";
    req.url = "/sync";
    req.headers.host = "localhost";
    const result = await app.resources[0].handler(contextFor(req, new ServerResponse(req), app));
    assert.deepEqual(result, {
        status: 200,
        type: "application/json; charset=utf-8",
        headers: {},
        cacheControl: { noStore: true },
        body: `${JSON.stringify({ assertions }, null, 2)}\n`,
    });
});
test("syncGuardApp refuses an entire mixed batch without calling importAssertions", async () => {
    const mixed = [assertions[0], { e: "claims/beta", a: "title", v: "Beta", source: "peer-b" }];
    const validation = validateSyncAssertions(mixed, { expectedSource: "peer-a", recognize: ["peer-a"] });
    assert.equal(validation.ok, false);
    assert.equal(validation.assertions.length, 1, "the pure validator retains accepted entries beside faults");
    assert.ok(validation.faults.length > 0);
    let importCalls = 0;
    const app = syncGuardApp({
        exportAssertions: () => assertions,
        importAssertions: () => { importCalls += 1; return 0; },
        tokens: { secret: "peer-a" },
        recognize: ["peer-a"],
    });
    const server = createServer(nativeHttpHandler(app));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    try {
        const response = await fetch(`http://127.0.0.1:${address.port}/sync`, {
            method: "POST",
            headers: { accept: "application/json", authorization: "Bearer secret", "content-type": "application/json" },
            body: JSON.stringify({ assertions: mixed }),
        });
        assert.equal(response.status, 400);
        assert.match(await response.text(), /assertion-source-mismatch/);
        assert.equal(importCalls, 0, "a valid entry must not be imported from a refused mixed batch");
    } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});
test("syncGuardApp serves GET assertion traces and guarded POST imports", async () => {
    const imported = [];
    const app = syncGuardApp({
        exportAssertions: () => assertions,
        importAssertions: (accepted) => {
            imported.push(...accepted);
            return accepted.length;
        },
        tokens: { secret: "peer-a" },
        recognize: ["peer-a"],
        rateLimit: { limit: 2, windowMs: 60_000 },
    });
    const resource = app.resources?.[0];
    assert.ok(resource);
    assert.equal(resource.route, "/sync");
    assert.equal(resource.id, "sync-guard.sync");
    assert.equal(resource.name, "Sync Guard");
    const server = createServer(nativeHttpHandler(app));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    try {
        const delta = await fetch(`${base}/sync`, { headers: { accept: "application/json" } });
        assert.equal(delta.status, 200);
        assert.equal((await delta.json()).assertions?.length, 2);
        const unauthorized = await fetch(`${base}/sync`, {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({ assertions }),
        });
        assert.equal(unauthorized.status, 401);
        const accepted = await fetch(`${base}/sync`, {
            method: "POST",
            headers: {
                accept: "application/json",
                authorization: "Bearer secret",
                "content-type": "application/json",
            },
            body: JSON.stringify({ assertions }),
        });
        assert.equal(accepted.status, 200);
        assert.equal(accepted.headers.get("ratelimit-limit"), "2");
        assert.equal(accepted.headers.get("ratelimit-remaining"), "1");
        assert.equal((await accepted.json()).imported, 2);
        assert.equal(imported.length, 2);
        const rejected = await fetch(`${base}/sync`, {
            method: "POST",
            headers: {
                accept: "application/json",
                authorization: "Bearer secret",
                "content-type": "application/json",
            },
            body: JSON.stringify({ assertions: [{ e: "claims/beta", a: "title", v: "Beta", source: "peer-b" }] }),
        });
        assert.equal(rejected.status, 400);
        assert.equal(rejected.headers.get("ratelimit-limit"), "2");
        assert.equal(rejected.headers.get("ratelimit-remaining"), "0");
        assert.match(await rejected.text(), /assertion-source-mismatch/);
        assert.equal(imported.length, 2, "refusal must not import");
        const limited = await fetch(`${base}/sync`, {
            method: "POST",
            headers: {
                accept: "application/json",
                authorization: "Bearer secret",
                "content-type": "application/json",
            },
            body: JSON.stringify({ assertions }),
        });
        assert.equal(limited.status, 429);
        assert.equal(limited.headers.get("ratelimit-limit"), "2");
        assert.equal(limited.headers.get("ratelimit-remaining"), "0");
        assert.ok(limited.headers.get("retry-after"));
        assert.equal(imported.length, 2, "rate refusal must not import");
    }
    finally {
        await new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
    }
});

// Useful operation uses the published Data journal, not an in-memory import spy.
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEavtEntries } from "@red-cup-engineering/eavt-services-section/append-eavt-entries";
import { readEavtEntries } from "@red-cup-engineering/eavt-services-section/read-eavt-entries";
import { journalPath } from "@red-cup-engineering/eavt-services-section/journal-path";
import { identifyContentAddressedRow } from "@red-cup-engineering/eavt-services-section/identify-content-addressed-row";

async function serve(app, operation) {
  const server = createServer(nativeHttpHandler(app));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await operation(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test("guarded HTTP exchanges canonical journal rows and replay preserves content identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "sync-guard-journal-"));
  const at = "2026-10-18T19:30:00Z", feed = "sync-guard";
  const original = { e: "work/sync-guard", a: "status", v: "qualified", t: { by: "peer-a", at } };
  const received = { ...original, v: "received" };
  const path = journalPath({ root, feed, at });
  appendEavtEntries({ root, feed, at, entries: [original] });
  let imports = 0, exports = 0;
  const app = syncGuardApp({
    tokens: { "journal-token": "peer-a" }, recognize: ["peer-a"], requireAuthFor: ["GET", "POST"],
    exportAssertions: (subject) => { exports++; return readEavtEntries({ path }, { strict: true }).filter((row) => !subject || row.e === subject); },
    importAssertions: (entries) => { imports++; return appendEavtEntries({ root, feed, at, entries }).appended; },
  });
  const headers = { authorization: "Bearer journal-token", "content-type": "application/json" };
  try {
    await serve(app, async (base) => {
      const get = await fetch(`${base}/sync?subject=work%2Fsync-guard`, { headers });
      assert.equal(get.status, 200);
      assert.deepEqual((await get.json()).assertions, [original]);
      for (const expected of [1, 0]) {
        const post = await fetch(`${base}/sync`, { method: "POST", headers, body: JSON.stringify({ assertions: [received] }) });
        assert.equal(post.status, 200);
        assert.deepEqual(await post.json(), { imported: expected, accepted: 1 });
      }
      const rows = readEavtEntries({ path }, { strict: true });
      assert.deepEqual(rows, [original, received]);
      assert.deepEqual(identifyContentAddressedRow({ row: rows[1] }), identifyContentAddressedRow({ row: received }));
      const before = await readFile(path);
      for (const body of ["null", "42", "true", '"text"', "[]", "{}", "{", JSON.stringify({ assertions: [received, { ...received, t: { by: "peer-b", at } }] })]) {
        const rejected = await fetch(`${base}/sync`, { method: "POST", headers, body });
        assert.equal(rejected.status, 400, body);
        await rejected.arrayBuffer();
      }
      for (const authorization of [undefined, "Bearer wrong"]) {
        const response = await fetch(`${base}/sync`, { headers: authorization ? { authorization } : {} });
        assert.equal(response.status, authorization ? 403 : 401);
        await response.arrayBuffer();
      }
      assert.equal(imports, 2);
      assert.equal(exports, 1, "refused GETs cannot export");
      assert.deepEqual(await readFile(path), before, "every refused request leaves the existing journal unchanged");
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("guard preserves optional auth/custom path/wider wire, refuses actual UTF8 byte overflow", async () => {
  const wider = { e: "legacy/subject", a: "title", source: "peer-a" };
  const accepted = [];
  const app = syncGuardApp({ path: "/exchange", tokens: { secret: "peer-a" }, requireAuthFor: [],
    maxBodyBytes: 160, exportAssertions: () => [wider],
    importAssertions: (rows) => { accepted.push(...rows); return rows.length; } });
  await serve(app, async (base) => {
    const response = await fetch(`${base}/exchange`, { method: "POST", body: JSON.stringify({ assertions: [wider] }) });
    assert.equal(response.status, 200);
    assert.deepEqual(accepted, [wider]);
    assert.equal(Object.hasOwn(accepted[0], "v"), false);
    const oversized = JSON.stringify({ assertions: [{ ...wider, v: "é".repeat(60) }] });
    assert.ok(oversized.length <= 160 && Buffer.byteLength(oversized) > 160);
    const refused = await fetch(`${base}/exchange`, { method: "POST", body: oversized });
    assert.equal(refused.status, 413);
    await refused.arrayBuffer();
    assert.equal(accepted.length, 1);
  });
  const guarded = syncGuardApp({ path: "/exchange", tokens: { secret: "peer-a" }, recognize: ["peer-a"],
    exportAssertions: () => [wider], importAssertions: (rows) => { accepted.push(...rows); return rows.length; } });
  await serve(guarded, async (base) => {
    for (const [token, status] of [["wrong", 403], ["secret", 200]]) {
      const response = await fetch(`${base}/exchange`, { method: "POST", headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ assertions: [wider] }) });
      assert.equal(response.status, status);
      await response.arrayBuffer();
      assert.equal(accepted.length, status === 403 ? 1 : 2);
    }
    assert.deepEqual(accepted, [wider, wider]);
    assert.equal(Object.hasOwn(accepted[1], "v"), false);
  });
});

test("unsafe configuration is refused before callbacks; zero remains an explicit bound", async () => {
  let effects = 0;
  const operations = { exportAssertions: () => { effects++; return []; }, importAssertions: () => { effects++; return 0; } };
  for (const name of ["maxAssertions", "maxAssertionBytes", "maxFieldLength", "maxBodyBytes"])
    for (const value of [-1, NaN, Infinity, .5, Number.MAX_SAFE_INTEGER + 1])
      assert.throws(() => syncGuardApp({ ...operations, [name]: value }), RangeError);
  const app = syncGuardApp({ ...operations, maxBodyBytes: 0 });
  await serve(app, async (base) => {
    const response = await fetch(`${base}/sync`, { method: "POST", body: "{}" });
    assert.equal(response.status, 413);
    await response.arrayBuffer();
  });
  assert.equal(effects, 0);
});

import { micropubApp } from "../dist/micropub/index.mjs";
import { microsubApp } from "../dist/microsub/index.mjs";
import { activityPubApp } from "../dist/activitypub/index.mjs";
import { indieAuthApp, createAuthorizationGrant } from "../dist/indieauth/index.mjs";

test("shared bearer consumers retain native credential decisions and refusal before service effects", async () => {
  for (const tokens of [{ "consumer-secret": "peer-a" }, ["consumer-secret"]]) {
    const decisions = [];
    const expectedSource = Array.isArray(tokens) ? "consumer-secret" : "peer-a";
    const families = [
      [micropubApp({ tokens, write: () => { throw new Error("unrequested write"); },
        source: (_url, auth) => { decisions.push(auth); return { type: ["h-entry"], properties: { name: ["Received"] } }; } }),
        "/micropub?q=source&url=https%3A%2F%2Fpeer.example%2Fentry", "GET", undefined, 200],
      [microsubApp({ tokens, store: { channels: (auth) => { decisions.push(auth); return []; } } }),
        "/microsub?q=channels", "GET", undefined, 200],
      [activityPubApp({ tokens, store: { actor: () => ({ id: "https://peer.example/actor", type: "Person" }),
        inbox: (_activity, auth) => { decisions.push(auth); return { accepted: true }; } } }),
        "/inbox", "POST", JSON.stringify({ id: "https://peer.example/activity/1", type: "Create", actor: "https://peer.example/actor" }), 202],
      [indieAuthApp({ issuer: "https://peer.example/", tokens, store: {
        createCode: (request, auth) => { decisions.push(auth); return createAuthorizationGrant(request, { code: "fixture-code" }); },
      } }), "/indieauth/authorize?me=https%3A%2F%2Fpeer.example%2F&client_id=https%3A%2F%2Fclient.example%2F&redirect_uri=https%3A%2F%2Fclient.example%2F&state=fixture&response_type=code&code_challenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "POST", undefined, 201],
    ];
    for (const [app, path, method, body, expected] of families) {
      await serve(app, async (base) => {
        const before = decisions.length;
        for (const authorization of [undefined, "Bearer unauthorized"]) {
          const response = await fetch(base + path, { method, headers: { ...(authorization ? { authorization } : {}),
            "content-type": "application/json", accept: "application/json" }, ...(body === undefined ? {} : { body }) });
          assert.equal(response.status, authorization ? 403 : 401, path);
          await response.arrayBuffer();
        }
        assert.equal(decisions.length, before);
        const response = await fetch(base + path, { method, headers: { authorization: "Bearer consumer-secret",
          "content-type": "application/json", accept: "application/json" }, ...(body === undefined ? {} : { body }) });
        assert.equal(response.status, expected, path + ": " + await response.text());
        assert.deepEqual(decisions.at(-1), { ok: true, status: 200, token: "consumer-secret", source: expectedSource });
      });
    }
  }
});
