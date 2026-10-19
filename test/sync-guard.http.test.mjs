// Retained protocol consumers of the shared bearer helpers.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { nativeHttpHandler } from "@red-cup-engineering/computer-web-server/native-application";
import { micropubApp } from "../dist/micropub/index.mjs";
import { microsubApp } from "../dist/microsub/index.mjs";
import { activityPubApp } from "../dist/activitypub/index.mjs";
import { indieAuthApp, createAuthorizationGrant } from "../dist/indieauth/index.mjs";

async function serve(app, operation) {
  const server = createServer(nativeHttpHandler(app));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await operation(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

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
