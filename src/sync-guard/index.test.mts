// Original five pure cases received from emsenn/web-sync-guard@137409ccd9.
import test from "node:test";
import assert from "node:assert/strict";


import {
  authorizeBearer,
  authorizeBearerReport,
  bearerToken,
  createRateLimiter,
  syncAuthTrace,
  validateSyncAssertions,
  type AssertionFault,
} from "./index.mjs";

const assertions = [
  { e: "claims/alpha", a: "title", v: "Alpha", t: { by: "peer-a" } },
  { e: "claims/alpha", a: "status", v: "published", source: "peer-a" },
];

test("bearerToken and authorizeBearer bind tokens to sources", () => {
  assert.equal(bearerToken({ authorization: "Bearer secret" }), "secret");
  assert.deepEqual(authorizeBearer({}, { secret: "peer-a" }), {
    ok: false,
    status: 401,
    reason: "missing bearer token",
  });
  assert.deepEqual(authorizeBearer({ authorization: "Bearer secret" }, { secret: "peer-a" }), {
    ok: true,
    status: 200,
    token: "secret",
    source: "peer-a",
  });
  assert.equal(authorizeBearer({ authorization: "Bearer nope" }, { secret: "peer-a" }).status, 403);
});

test("authorizeBearerReport exposes MEMETICS admission evidence while preserving decisions", () => {
  const trace = syncAuthTrace({ authorization: "Bearer secret" }, { id: "req-sync-auth", now: "1" });
  assert.equal(trace.kind, "web-server.request-trace");
  assert.equal(trace.id, "req-sync-auth");
  assert.deepEqual(trace.entries.map((entry) => [entry.e, entry.a, entry.v, entry.t]), [
    ["req-sync-auth", "header.authorization", "[redacted]", "1"],
  ]);

  const open = authorizeBearerReport({}, undefined);
  assert.equal(open.ok, true);
  assert.equal(open.report.value, "potential");

  const missing = authorizeBearerReport({}, { secret: "peer-a" });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 401);
  assert.equal(missing.report.value, "active");
  assert.deepEqual(missing.report.judgments.map((judgment) => [judgment.name, judgment.value]), [["auth", "active"]]);

  const accepted = authorizeBearerReport({ authorization: "Bearer secret" }, { secret: "peer-a" }, trace);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.source, "peer-a");
  assert.equal(accepted.report.trace.id, "req-sync-auth");
  assert.equal(accepted.report.value, "potential");
  assert.deepEqual(accepted.report.claims, { source: "peer-a" });
  // The current HTTP owner carries the same judgment in utterances, not legacy datoms.
  const utterances = accepted.report.settled.utterances;
  const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
  assert.ok(Array.isArray(utterances));
  assert.equal(utterances.some((value: unknown) => record(value)
    && record(value.token) && record(value.token.mark) && record(value.token.mark.value)
    && value.token.mark.value.subject === "req-sync-auth"
    && record(value.claim) && record(value.claim.mark)
    && value.claim.mark.value === "judgment:auth"), true);

  const denied = authorizeBearerReport({ authorization: "Bearer nope" }, { secret: "peer-a" });
  assert.equal(denied.status, 403);
  assert.equal(denied.reason, "bearer token is not authorized");
  assert.equal(denied.report.value, "active");
});

test("validateSyncAssertions rejects malformed, unprovenanced, or unauthorized assertions", () => {
  const malformed = validateSyncAssertions([{ e: "x" }]);
  const noProvenance = validateSyncAssertions([{ e: "x", a: "p", v: 1 }]);
  const wrongSource = validateSyncAssertions(assertions, { expectedSource: "peer-b" });
  const unrecognized = validateSyncAssertions(assertions, { recognize: ["peer-b"] });

  assert.equal(malformed.ok, false);
  assert.equal((malformed.faults[0] as AssertionFault | undefined)?.code, "assertion-shape");
  assert.equal(noProvenance.ok, false);
  assert.equal(noProvenance.faults[0]?.code, "assertion-no-provenance");
  assert.equal(wrongSource.faults[0]?.code, "assertion-source-mismatch");
  assert.equal(unrecognized.faults[0]?.code, "assertion-source-unrecognized");
});

test("validateSyncAssertions accepts recognized provenanced assertions", () => {
  const validation = validateSyncAssertions(assertions, {
    expectedSource: "peer-a",
    recognize: new Set(["peer-a"]),
  });

  assert.equal(validation.ok, true);
  assert.equal(validation.assertions.length, 2);
});

test("createRateLimiter admits only a bounded number of calls per window", () => {
  let now = 1000;
  const check = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now });

  assert.equal(check("peer-a").ok, true);
  assert.equal(check("peer-a").remaining, 0);
  assert.equal(check("peer-a").ok, false);
  now = 2500;
  assert.equal(check("peer-a").ok, true);
});


test("sync validator preserves permissive shape, bounds, source precedence and classification", () => {
  const permissive={e:"x",a:"p",source:"peer-a",signature:{by:"ignored"},t:{by:"also-ignored"},extra:()=>1};
  const allowed=validateSyncAssertions([permissive],{expectedSource:"peer-a",recognize:{ "peer-a":"stable" }});
  assert.equal(allowed.ok,true);
  assert.equal(allowed.assertions[0],permissive);
  assert.equal(validateSyncAssertions([{e:"x",a:"p"}],{requireProvenance:false}).ok,true);
  for(const [input,options,code] of [
    [null,{},"assertion-shape"],
    [[permissive],{maxAssertions:0},"assertion-shape"],
    [[{...permissive,e:""}],{},"assertion-empty-field"],
    [[permissive],{maxFieldLength:0},"assertion-field-too-long"],
    [[permissive],{maxAssertionBytes:0},"assertion-too-large"],
    [[permissive],{expectedSource:"ignored"},"assertion-source-mismatch"],
    [[{e:"x",a:"p"}],{},"assertion-no-provenance"],
  ] as const) assert.equal(validateSyncAssertions(input,options).faults[0]?.code,code);
  for(const standing of ["absurd","potential","active","stable"] as const){
    const result=validateSyncAssertions([permissive],{recognize:()=>standing});
    assert.equal(result.ok,standing==="potential"||standing==="stable");
  }
  const bytes=Buffer.byteLength(JSON.stringify(permissive),"utf8");
  assert.equal(validateSyncAssertions([permissive],{maxAssertionBytes:bytes}).ok,true);
  assert.equal(validateSyncAssertions([permissive],{maxAssertionBytes:bytes-1}).faults[0]?.code,"assertion-too-large");
  const mixed=validateSyncAssertions([permissive,{e:"x"}]);
  assert.equal(mixed.ok,false);
  assert.deepEqual(mixed.assertions,[permissive]);
  assert.equal(mixed.faults[0]?.index,1);
});


test("authentication diagnostics redact credentials while explicit decisions retain them", () => {
  const headers = { authorization: "Bearer private-bearer", cookie: "session=private-cookie",
    "x-api-key": "private-api", referer: "https://user:private-user@peer.example/?token=private-query" };
  const trace = syncAuthTrace(headers, { id: "auth-test", now: "clock" });
  for (const policy of [{ "private-bearer": "peer-a" }, ["private-bearer"],
    new Set(["private-bearer"]), () => true] as const) {
    const value = authorizeBearerReport(headers, policy, { ...trace, entries: [
      ...trace.entries, { e: trace.id, a: "url", v: "/sync?token=private-url", t: "clock" },
      { e: trace.id, a: "header.authorization", v: "Bearer private-bearer", t: "clock" },
      { e: trace.id, a: "header.Authorization", v: "Bearer private-bearer", t: "other-clock" }] });
    assert.equal(value.token, "private-bearer");
    assert.equal(value.source, Array.isArray(policy) || policy instanceof Set || typeof policy === "function"
      ? "private-bearer" : "peer-a");
    const diagnostics = JSON.stringify(value.report);
    for (const secret of ["private-bearer", "private-cookie", "private-api", "private-user", "private-query", "private-url"])
      assert.equal(diagnostics.includes(secret), false, secret);
    assert.equal(value.report.trace.entries.length, trace.entries.length + 3);
    assert.equal(value.report.trace.entries.at(-1)?.a, "header.Authorization");
    assert.equal(value.report.trace.entries.at(-1)?.t, "other-clock");
    assert.equal(value.report.value, "potential");
  }
});

test("sync validation refuses unsafe caps and unserializable rows without losing partial results", () => {
  for (const name of ["maxAssertions", "maxAssertionBytes", "maxFieldLength"] as const)
    for (const value of [-1, NaN, Infinity, .5, Number.MAX_SAFE_INTEGER + 1])
      assert.throws(() => validateSyncAssertions(assertions, { [name]: value }), RangeError);
  assert.equal(validateSyncAssertions([], { maxAssertions: 0 }).ok, true);
  const cycle: Record<string, unknown> = { e: "x", a: "p", source: "peer-a" };
  cycle.v = cycle;
  for (const invalid of [cycle, { e: "x", a: "p", v: 1n, source: "peer-a" }]) {
    const result = validateSyncAssertions([assertions[0], invalid]);
    assert.equal(result.ok, false);
    assert.equal(result.faults[0]?.code, "assertion-shape");
    assert.equal(result.assertions[0], assertions[0]);
  }
});
