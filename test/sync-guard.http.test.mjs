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
