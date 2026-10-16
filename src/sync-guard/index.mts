import type { IncomingHttpHeaders } from "node:http";
import { readJsonBody, type App, type Context, type Repr, type RequestTrace } from "@red-cup-engineering/computing-with-http/app";
import { authAdmissionReport, type AuthAdmissionReport, type AuthEvidence } from "@red-cup-engineering/computer-web-server/edge/auth";
import { bearerToken as bearerTokenValue } from "@red-cup-engineering/computing-with-http/codecs/http";
import {
  assertAssertion,
  provenanceOf,
  recognizerFrom,
  type RecognitionInput,
  type Assertion,
  type AssertionTrace,
} from "./wire.mjs";

export type AuthDecision = {
  ok: boolean;
  status: 200 | 401 | 403;
  source?: string;
  token?: string;
  reason?: string;
};

export type SyncAuthReport = AuthDecision & Readonly<{
  report: AuthAdmissionReport;
}>;

export type SyncAuthTraceOptions = Readonly<{
  id?: string;
  now?: unknown;
}>;

export type TokenPolicy =
  | readonly string[]
  | ReadonlySet<string>
  | Record<string, string>
  | ((token: string) => boolean | string | undefined);

export type AssertionFault = {
  index: number;
  code:
    | "assertion-shape"
    | "assertion-empty-field"
    | "assertion-field-too-long"
    | "assertion-too-large"
    | "assertion-no-provenance"
    | "assertion-source-mismatch"
    | "assertion-source-unrecognized";
  reason: string;
};

export type AssertionValidationOptions = {
  maxAssertions?: number;
  maxAssertionBytes?: number;
  maxFieldLength?: number;
  requireProvenance?: boolean;
  expectedSource?: string;
  recognize?: RecognitionInput;
};

export type AssertionValidation = {
  ok: boolean;
  assertions: AssertionTrace;
  faults: readonly AssertionFault[];
};

export type RateLimitOptions = {
  limit: number;
  windowMs: number;
  now?: () => number;
};

export type RateLimitDecision = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
};

export type SyncGuardAppOptions = {
  exportAssertions: (subject?: string) => AssertionTrace | Promise<AssertionTrace>;
  importAssertions: (assertions: AssertionTrace) => number | Promise<number>;
  path?: string;
  tokens?: TokenPolicy;
  requireAuthFor?: readonly string[];
  recognize?: RecognitionInput;
  maxAssertions?: number;
  maxBodyBytes?: number;
  maxAssertionBytes?: number;
  maxFieldLength?: number;
  rateLimit?: RateLimitOptions;
  rateLimitKey?: (ctx: Context, auth: AuthDecision) => string;
};

// The instant the trace was taken: its entries carry it, so claims recorded from it share that moment.
function traceInstant(trace: RequestTrace): unknown {
  return trace.entries[0]?.t ?? String(Date.now());
}

export function bearerToken(headers: IncomingHttpHeaders): string | undefined {
  return bearerTokenValue(headers.authorization);
}

export function syncAuthTrace(headers: IncomingHttpHeaders, options: SyncAuthTraceOptions = {}): RequestTrace {
  const id = options.id ?? "sync-guard.auth";
  const t = options.now ?? String(Date.now());
  const entries = Object.freeze(Object.entries(headers).flatMap(([key, value]) => {
    if (value == null) return [];
    return [{
      e: id,
      a: `header.${key.toLowerCase()}`,
      v: Array.isArray(value) ? value.join(", ") : String(value),
      t,
    }];
  }));
  return Object.freeze({
    kind: "web-server.request-trace" as const,
    id,
    entries,
  });
}

function sourceForToken(token: string, policy: TokenPolicy): string | undefined {
  if (Array.isArray(policy)) return policy.includes(token) ? token : undefined;
  if (policy instanceof Set) return policy.has(token) ? token : undefined;
  if (typeof policy === "function") {
    const result = policy(token);
    if (result === true) return token;
    if (typeof result === "string" && result) return result;
    return undefined;
  }
  const sources = policy as Record<string, string>;
  if (Object.prototype.hasOwnProperty.call(sources, token)) return sources[token];
  return undefined;
}

export function authorizeBearer(headers: IncomingHttpHeaders, policy?: TokenPolicy): AuthDecision {
  const { report, ...decision } = authorizeBearerReport(headers, policy);
  return decision;
}

export function authorizeBearerReport(
  headers: IncomingHttpHeaders,
  policy?: TokenPolicy,
  trace: RequestTrace = syncAuthTrace(headers),
): SyncAuthReport {
  if (!policy) {
    const report = authAdmissionReport({
      trace,
      evidence: [{ source: "verify", admitted: true }],
      now: traceInstant(trace),
    });
    return { ok: true, status: 200, report };
  }
  const token = bearerToken(headers);
  if (!token) {
    const evidence: readonly AuthEvidence[] = [{ source: "missing", admitted: false, reason: "missing bearer token" }];
    const report = authAdmissionReport({ trace, evidence, now: traceInstant(trace) });
    return { ok: false, status: 401, reason: report.reason, report };
  }
  const source = sourceForToken(token, policy);
  if (!source) {
    const evidence: readonly AuthEvidence[] = [{ source: "api-key", admitted: false, reason: "bearer token is not authorized" }];
    const report = authAdmissionReport({ trace, evidence, now: traceInstant(trace) });
    return { ok: false, status: 403, token, reason: report.reason, report };
  }
  const evidence: readonly AuthEvidence[] = [{ source: "api-key", admitted: true, claims: { token, source } }];
  const report = authAdmissionReport({ trace, evidence, now: traceInstant(trace) });
  return { ok: true, status: 200, token, source, report };
}

function assertionFault(index: number, code: AssertionFault["code"], reason: string): AssertionFault {
  return { index, code, reason };
}

function assertionSize(assertion: unknown): number {
  return Buffer.byteLength(JSON.stringify(assertion) ?? "null", "utf8");
}

export function validateSyncAssertions(input: unknown, options: AssertionValidationOptions = {}): AssertionValidation {
  const maxAssertions = options.maxAssertions ?? 1000;
  const maxAssertionBytes = options.maxAssertionBytes ?? 32_768;
  const maxFieldLength = options.maxFieldLength ?? 512;
  const requireProvenance = options.requireProvenance ?? true;
  const assertions = Array.isArray(input) ? input : [];
  const faults: AssertionFault[] = [];
  const accepted: Assertion[] = [];
  const recognizes = options.recognize !== undefined ? recognizerFrom(options.recognize) : undefined;

  if (!Array.isArray(input)) {
    return {
      ok: false,
      assertions: [],
      faults: [assertionFault(-1, "assertion-shape", "assertions must be an array")],
    };
  }
  if (assertions.length > maxAssertions) {
    return {
      ok: false,
      assertions: [],
      faults: [assertionFault(-1, "assertion-shape", `assertions exceeds maxAssertions ${maxAssertions}`)],
    };
  }

  assertions.forEach((candidate, index) => {
    let assertion: Assertion;
    try {
      assertion = assertAssertion(candidate as Assertion);
    } catch (error) {
      faults.push(assertionFault(index, "assertion-shape", error instanceof Error ? error.message : String(error)));
      return;
    }
    if (!assertion.e || !assertion.a) {
      faults.push(assertionFault(index, "assertion-empty-field", "assertion.e and assertion.a must be non-empty strings"));
      return;
    }
    if (assertion.e.length > maxFieldLength || assertion.a.length > maxFieldLength) {
      faults.push(assertionFault(index, "assertion-field-too-long", `assertion.e and assertion.a must be at most ${maxFieldLength} characters`));
      return;
    }
    if (assertionSize(assertion) > maxAssertionBytes) {
      faults.push(assertionFault(index, "assertion-too-large", `assertion exceeds maxAssertionBytes ${maxAssertionBytes}`));
      return;
    }
    const provenance = provenanceOf(assertion);
    if (requireProvenance && !provenance) {
      faults.push(assertionFault(index, "assertion-no-provenance", "assertion must carry source, signature.by, or t.by provenance"));
      return;
    }
    if (options.expectedSource && provenance?.source !== options.expectedSource) {
      faults.push(assertionFault(index, "assertion-source-mismatch", `assertion source must match authenticated source '${options.expectedSource}'`));
      return;
    }
    if (recognizes && provenance) {
      const standing = recognizes(provenance.source);
      if (standing !== "potential" && standing !== "stable") {
        faults.push(assertionFault(index, "assertion-source-unrecognized", `assertion source '${provenance.source}' is not recognized (${standing})`));
        return;
      }
    }
    accepted.push(assertion);
  });

  return {
    ok: faults.length === 0,
    assertions: accepted,
    faults,
  };
}

export function createRateLimiter(options: RateLimitOptions): (key: string) => RateLimitDecision {
  if (!Number.isSafeInteger(options.limit) || options.limit <= 0) throw new RangeError("rate limit must be a positive integer");
  if (!Number.isSafeInteger(options.windowMs) || options.windowMs <= 0) throw new RangeError("rate windowMs must be a positive integer");
  const now = options.now ?? (() => Date.now());
  const windows = new Map<string, { count: number; resetAt: number }>();
  return (key: string): RateLimitDecision => {
    const current = now();
    const existing = windows.get(key);
    const window = existing && current < existing.resetAt
      ? existing
      : { count: 0, resetAt: current + options.windowMs };
    window.count += 1;
    windows.set(key, window);
    const remaining = Math.max(0, options.limit - window.count);
    if (window.count > options.limit) {
      const retryAfter = Math.max(1, Math.ceil((window.resetAt - current) / 1000));
      return { ok: false, limit: options.limit, remaining: 0, resetAt: window.resetAt, retryAfter };
    }
    return { ok: true, limit: options.limit, remaining, resetAt: window.resetAt };
  };
}

function repr(status: number, body: unknown, headers: Record<string, string> = {}): Repr {
  return {
    status,
    type: "application/json; charset=utf-8",
    headers,
    cacheControl: { noStore: true },
    body: `${JSON.stringify(body, null, 2)}\n`,
  };
}

function methodRequiresAuth(method: string, methods: readonly string[]): boolean {
  return methods.map((item) => item.toUpperCase()).includes(method.toUpperCase());
}

function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  return {
    "RateLimit-Limit": String(decision.limit),
    "RateLimit-Remaining": String(decision.remaining),
    "RateLimit-Reset": String(Math.ceil(decision.resetAt / 1000)),
    ...(decision.retryAfter !== undefined ? { "Retry-After": String(decision.retryAfter) } : {}),
  };
}

export function syncGuardApp(options: SyncGuardAppOptions): App {
  const path = options.path ?? "/sync";
  const requireAuthFor = options.requireAuthFor ?? ["POST"];
  const limiter = options.rateLimit ? createRateLimiter(options.rateLimit) : undefined;
  const maxBodyBytes = options.maxBodyBytes ?? 1_048_576;
  return {
    resources: [
      {
        id: "sync-guard.sync",
        name: "Sync Guard",
        route: path,
        match: path,
        methods: ["GET", "POST"],
        produces: ["application/json"],
        handler: async (ctx) => {
          const auth: AuthDecision = methodRequiresAuth(ctx.req.method ?? "GET", requireAuthFor)
            ? authorizeBearerReport(ctx.req.headers, options.tokens, ctx.trace)
            : { ok: true, status: 200 } satisfies AuthDecision;
          if (!auth.ok) {
            const headers = auth.status === 401 ? { "WWW-Authenticate": "Bearer" } : {};
            return repr(auth.status, { error: auth.reason }, headers);
          }

          let headers: Record<string, string> = {};
          if (limiter) {
            const key = options.rateLimitKey?.(ctx, auth)
              ?? auth.source
              ?? ctx.req.socket.remoteAddress
              ?? "anonymous";
            const decision = limiter(key);
            headers = rateLimitHeaders(decision);
            if (!decision.ok) {
              return repr(429, { error: "rate limit exceeded" }, headers);
            }
          }

          if (ctx.req.method === "GET" || ctx.req.method === "HEAD") {
            const subject = ctx.url.searchParams.get("subject") ?? undefined;
            const assertions = await options.exportAssertions(subject);
            return repr(200, { assertions }, headers);
          }

          const body = await readJsonBody(ctx.req, { maxBytes: maxBodyBytes, empty: {} }) as { assertions?: unknown };
          const validationOptions: AssertionValidationOptions = {
            ...(options.maxAssertions !== undefined ? { maxAssertions: options.maxAssertions } : {}),
            ...(options.maxAssertionBytes !== undefined ? { maxAssertionBytes: options.maxAssertionBytes } : {}),
            ...(options.maxFieldLength !== undefined ? { maxFieldLength: options.maxFieldLength } : {}),
            ...(auth.source ? { expectedSource: auth.source } : {}),
            ...(options.recognize !== undefined ? { recognize: options.recognize } : {}),
          };
          const validation = validateSyncAssertions(body.assertions, validationOptions);
          if (!validation.ok) {
            return repr(400, { error: "invalid sync assertions", faults: validation.faults }, headers);
          }
          const imported = await options.importAssertions(validation.assertions);
          return repr(200, { imported, accepted: validation.assertions.length }, headers);
        },
      },
    ],
  };
}

export { assertAssertion, provenanceOf, recognizerFrom } from "./wire.mjs";
export type { Assertion, AssertionTrace, Provenance, Recognizer, RecognitionInput } from "./wire.mjs";
