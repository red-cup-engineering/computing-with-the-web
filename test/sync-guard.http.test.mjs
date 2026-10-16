// Original HTTP case; current owning HTTP engine and explicit no-import assertions.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createWebServer } from "@red-cup-engineering/http-services-section/web-application";
import { handler } from "@red-cup-engineering/http-services-section/web-application-pipeline";
import { syncGuardApp } from "../dist/sync-guard/index.mjs";
const assertions = [
    { e: "claims/alpha", a: "title", v: "Alpha", t: { by: "peer-a" } },
    { e: "claims/alpha", a: "status", v: "published", source: "peer-a" },
];
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
    const server = createServer(handler(createWebServer(app)));
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
