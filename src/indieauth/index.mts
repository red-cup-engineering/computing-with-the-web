import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { jsonRepr, readFormBody, wellKnown, type App, type Repr } from "@red-cup-engineering/computing-with-http/app";
import { parseLinkHeader } from "@red-cup-engineering/computing-with-http/codecs/http";
import { canonicalJson as canonical } from "@red-cup-engineering/json-services-section/canonical-json";
import { requireJsonValue } from "@red-cup-engineering/json-services-section/require-json-value";
import { authorizeBearer, bearerToken, type AuthDecision, type TokenPolicy } from "../sync-guard/index.mjs";

export type CodeChallengeMethod = "plain" | "S256";

export type IndieAuthMetadata = Readonly<{
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  introspection_endpoint?: string;
  scopes_supported?: readonly string[];
  response_types_supported: readonly ["code"];
  grant_types_supported: readonly ["authorization_code"];
  code_challenge_methods_supported: readonly CodeChallengeMethod[];
}>;

export type AuthorizationRequest = Readonly<{
  me: string;
  clientId: string;
  redirectUri: string;
  state?: string;
  scope: readonly string[];
  responseType: "code";
  codeChallenge: string;
  codeChallengeMethod: CodeChallengeMethod;
}>;

export type AuthorizationGrant = AuthorizationRequest & Readonly<{
  code: string;
  issuedAt: string;
  expiresAt?: string;
  approvedBy?: string;
}>;

export type TokenResponse = Readonly<{
  access_token: string;
  token_type: "Bearer";
  me: string;
  scope?: string;
  expires_in?: number;
}>;

export type IndieAuthStore = Readonly<{
  createCode: (request: AuthorizationRequest, auth: AuthDecision) => AuthorizationGrant | Promise<AuthorizationGrant>;
  consumeCode: (code: string) => AuthorizationGrant | null | undefined | Promise<AuthorizationGrant | null | undefined>;
  issueToken: (grant: AuthorizationGrant) => TokenResponse | Promise<TokenResponse>;
}>;

export type FetchLike = (url: string, init?: RequestInit) => Promise<ResponseLike>;

export type ResponseLike = Readonly<{
  url?: string;
  status: number;
  headers?: HeadersLike;
  text(): Promise<string>;
}>;

export type HeadersLike = Pick<Headers, "get"> | Record<string, string | string[] | undefined>;

export type RelLink = Readonly<{
  rels: readonly string[];
  href: string;
}>;

export type IndieAuthEndpoints = Readonly<{
  authorizationEndpoint: string | null;
  tokenEndpoint: string | null;
  metadataEndpoint: string | null;
}>;

export type UrlValidation = Readonly<{
  valid: boolean;
  url: string | null;
  reason: string | null;
}>;

export type TokenClaims = Readonly<{
  me: string;
  client_id: string;
  scope: string;
  iat: number;
  exp?: number;
  [claim: string]: unknown;
}>;

export type MintedToken = Readonly<{
  token: string;
  response: TokenResponse;
  claims: TokenClaims;
}>;

export type TokenVerification = Readonly<{
  valid: boolean;
  claims: TokenClaims | null;
  reason: string | null;
}>;

export type RelMeVerdict = Readonly<{
  verified: boolean;
  me: string;
  clientId: string;
  profileLinks: readonly string[];
  clientLinks: readonly string[];
  reason?: string;
}>;

export type IndieAuthAppOptions = Readonly<{
  issuer: string;
  store: IndieAuthStore;
  tokens?: TokenPolicy;
  fetchImpl?: FetchLike;
  verifyRelMe?: boolean;
  paths?: {
    authorization?: string;
    token?: string;
    metadata?: string;
  };
  scopes?: readonly string[];
}>;

const PKCE = /^[A-Za-z0-9._~-]{43,128}$/;

function absoluteHttpUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${field} must be an absolute URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError(`${field} must be http(s)`);
  return url.href;
}

export function canonicalizeProfileUrl(input: string): string | null {
  if (typeof input !== "string") return null;
  let value = input.trim();
  if (!value) return null;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    if (url.pathname === "") url.pathname = "/";
    return url.href;
  } catch {
    return null;
  }
}

export function isIpHost(hostname: string): boolean {
  return hostname.startsWith("[") && hostname.endsWith("]")
    || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

function rawPathSegments(rawInput: string): string[] {
  let value = rawInput.trim();
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) value = `https://${value}`;
  const match = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*([^?#]*)/.exec(value);
  return (match?.[1] ?? "").split("/");
}

function urlCommonProblem(url: URL, rawInput: string): string | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "scheme must be http or https";
  if (!url.hostname) return "missing host";
  if (url.hash) return "must not contain a fragment";
  if (url.username || url.password) return "must not contain user:password";
  if (rawPathSegments(rawInput).some((segment) => segment === "." || segment === "..")) return "must not contain . or .. path segments";
  return null;
}

export function isValidProfileUrl(input: string): UrlValidation {
  const canonical = canonicalizeProfileUrl(input);
  if (canonical === null) return Object.freeze({ valid: false, url: null, reason: "unparseable URL" });
  const url = new URL(canonical);
  const problem = urlCommonProblem(url, input);
  if (problem) return Object.freeze({ valid: false, url: canonical, reason: problem });
  if (url.port) return Object.freeze({ valid: false, url: canonical, reason: "profile URL must not contain a port" });
  if (isIpHost(url.hostname)) return Object.freeze({ valid: false, url: canonical, reason: "profile URL must be a domain, not an IP" });
  return Object.freeze({ valid: true, url: canonical, reason: null });
}

export function isValidClientId(input: string): UrlValidation {
  const canonical = canonicalizeProfileUrl(input);
  if (canonical === null) return Object.freeze({ valid: false, url: null, reason: "unparseable URL" });
  const url = new URL(canonical);
  const problem = urlCommonProblem(url, input);
  return problem
    ? Object.freeze({ valid: false, url: canonical, reason: problem })
    : Object.freeze({ valid: true, url: canonical, reason: null });
}

export function sameProfile(left: string, right: string): boolean {
  const a = canonicalizeProfileUrl(left);
  const b = canonicalizeProfileUrl(right);
  return a !== null && a === b;
}

function optional(value: string | null): string | undefined {
  return value === null || value === "" ? undefined : value;
}

function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (whole, body: string) => {
    switch (body) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default: {
        const code = body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
    }
  });
}

function parseAttrs(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s/=>"']+)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attrText)) !== null) {
    const name = match[1]!.toLowerCase();
    let value = match[2];
    if (value === undefined) {
      attrs[name] = "";
      continue;
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

function relTokens(attrs: Readonly<Record<string, string>>): readonly string[] {
  return Object.freeze((attrs["rel"] ?? "").toLowerCase().split(/\s+/).filter(Boolean));
}

function documentBase(html: string, fallbackUrl: string): string {
  const tagRe = /<base\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    const attrs = parseAttrs(match[1] ?? "");
    const href = attrs["href"];
    try {
      return href ? new URL(href, fallbackUrl).href : fallbackUrl;
    } catch {
      return fallbackUrl;
    }
  }
  return fallbackUrl;
}

export function relLinks(html: string, baseUrl: string): readonly RelLink[] {
  const base = documentBase(html, baseUrl);
  const found: RelLink[] = [];
  const tagRe = /<(a|link)\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    const attrs = parseAttrs(match[2] ?? "");
    const rels = relTokens(attrs);
    if (rels.length === 0) continue;
    const href = attrs["href"];
    if (href === undefined) continue;
    try {
      found.push(Object.freeze({ rels, href: new URL(href, base).href }));
    } catch {
      // Ignore malformed links.
    }
  }
  return Object.freeze(found);
}

export function allRelLinks(linkHeader: string | null | undefined, html: string, baseUrl: string): readonly RelLink[] {
  const found: RelLink[] = [];
  for (const link of parseLinkHeader(linkHeader ?? "")) {
    const rel = link.params["rel"];
    if (!rel) continue;
    try {
      found.push(Object.freeze({
        rels: Object.freeze(rel.trim().toLowerCase().split(/\s+/).filter(Boolean)),
        href: new URL(link.href, baseUrl).href,
      }));
    } catch {
      // Ignore malformed Link header targets.
    }
  }
  found.push(...relLinks(html, baseUrl));
  return Object.freeze(found);
}

export function discoverRel(linkHeader: string | null | undefined, html: string, baseUrl: string, rel: string): string[] {
  const wanted = rel.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const link of allRelLinks(linkHeader, html, baseUrl)) {
    if (!link.rels.includes(wanted) || seen.has(link.href)) continue;
    seen.add(link.href);
    out.push(link.href);
  }
  return out;
}

export function relMeLinks(html: string, baseUrl: string, linkHeader?: string | null): readonly string[] {
  return Object.freeze(discoverRel(linkHeader, html, baseUrl, "me"));
}

export function discoverEndpoints(linkHeader: string | null | undefined, html: string, baseUrl: string): IndieAuthEndpoints {
  const first = (rel: string): string | null => discoverRel(linkHeader, html, baseUrl, rel)[0] ?? null;
  return Object.freeze({
    authorizationEndpoint: first("authorization_endpoint"),
    tokenEndpoint: first("token_endpoint"),
    metadataEndpoint: first("indieauth-metadata"),
  });
}

async function fetchRelMeLinks(url: string, fetchImpl: FetchLike): Promise<readonly string[]> {
  const res = await fetchImpl(url, {
    method: "GET",
    redirect: "follow",
    headers: { accept: "text/html, */*;q=0.8" },
  });
  if (res.status < 200 || res.status >= 300) throw new TypeError(`rel=me fetch returned HTTP ${res.status}`);
  return relMeLinks(await res.text(), res.url ?? url);
}

export async function verifyRelMe(me: string, clientId: string, opts: { fetchImpl?: FetchLike } = {}): Promise<RelMeVerdict> {
  const profile = absoluteHttpUrl(me, "me");
  const client = absoluteHttpUrl(clientId, "client_id");
  const fetchImpl = opts.fetchImpl ?? globalFetch("verifyRelMe");
  try {
    const profileLinks = await fetchRelMeLinks(profile, fetchImpl);
    const clientLinks = await fetchRelMeLinks(client, fetchImpl);
    const verified = profileLinks.includes(client) && clientLinks.includes(profile);
    return Object.freeze({
      verified,
      me: profile,
      clientId: client,
      profileLinks,
      clientLinks,
      ...(verified ? {} : { reason: "profile and client_id must link to each other with rel=me" }),
    });
  } catch (error) {
    return Object.freeze({
      verified: false,
      me: profile,
      clientId: client,
      profileLinks: [],
      clientLinks: [],
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function scopes(value: string | null): readonly string[] {
  return Object.freeze((value ?? "").split(/\s+/).filter(Boolean).sort());
}

function challengeMethod(value: string | null): CodeChallengeMethod {
  if (value === null || value === "") return "plain";
  if (value === "plain" || value === "S256") return value;
  throw new TypeError("code_challenge_method must be plain or S256");
}

export function validateAuthorizationRequest(params: URLSearchParams, opts: { expectedMe?: string } = {}): AuthorizationRequest {
  const responseType = params.get("response_type");
  if (responseType !== "code") throw new TypeError("response_type must be code");
  const me = absoluteHttpUrl(params.get("me") ?? "", "me");
  if (opts.expectedMe && me !== absoluteHttpUrl(opts.expectedMe, "expectedMe")) throw new TypeError("me does not match expected profile URL");
  const clientId = absoluteHttpUrl(params.get("client_id") ?? "", "client_id");
  const redirectUri = absoluteHttpUrl(params.get("redirect_uri") ?? "", "redirect_uri");
  const codeChallenge = params.get("code_challenge") ?? "";
  if (!PKCE.test(codeChallenge)) throw new TypeError("code_challenge must be a 43-128 character PKCE verifier value");
  const method = challengeMethod(params.get("code_challenge_method"));
  const out: {
    me: string;
    clientId: string;
    redirectUri: string;
    state?: string;
    scope: readonly string[];
    responseType: "code";
    codeChallenge: string;
    codeChallengeMethod: CodeChallengeMethod;
  } = {
    me,
    clientId,
    redirectUri,
    scope: scopes(params.get("scope")),
    responseType: "code",
    codeChallenge,
    codeChallengeMethod: method,
  };
  const state = optional(params.get("state"));
  if (state !== undefined) out.state = state;
  return Object.freeze(out);
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function canonicalJson(value: unknown): string {
  return canonical(requireJsonValue(value, "token part"));
}

function encodeTokenPart(value: unknown): string {
  return base64url(Buffer.from(canonicalJson(value), "utf8"));
}

function decodeTokenPart(part: string): unknown {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
}

export function normalizeScope(scope: string | readonly string[] | null | undefined): string {
  const tokens = Array.isArray(scope) ? scope : String(scope ?? "").split(/\s+/);
  return tokens.filter(Boolean).join(" ");
}

export function mintToken(params: {
  me: string;
  client_id: string;
  scope?: string | readonly string[];
  expiresIn?: number;
  now?: number;
  extra?: Record<string, unknown>;
}, secret: string | Buffer): MintedToken {
  if (!params.me) throw new TypeError("mintToken: me is required");
  if (!params.client_id) throw new TypeError("mintToken: client_id is required");
  if (!secret || (typeof secret !== "string" && !Buffer.isBuffer(secret))) throw new TypeError("mintToken: secret is required");
  const iat = Math.floor((params.now ?? Date.now()) / 1000);
  const claims: TokenClaims = Object.freeze({
    me: params.me,
    client_id: params.client_id,
    scope: normalizeScope(params.scope),
    iat,
    ...(params.expiresIn && params.expiresIn > 0 ? { exp: iat + Math.floor(params.expiresIn) } : {}),
    ...(params.extra ?? {}),
  });
  const header = encodeTokenPart({ alg: "HS256", typ: "indieauth+hmac" });
  const payload = encodeTokenPart(claims);
  const signingInput = `${header}.${payload}`;
  const signature = base64url(createHmac("sha256", secret).update(signingInput).digest());
  const token = `${signingInput}.${signature}`;
  return Object.freeze({
    token,
    response: Object.freeze({
      access_token: token,
      token_type: "Bearer",
      me: params.me,
      ...(claims.scope ? { scope: claims.scope } : {}),
      ...(params.expiresIn ? { expires_in: Math.floor(params.expiresIn) } : {}),
    }),
    claims,
  });
}

export function verifyToken(token: string, secret: string | Buffer, opts: { now?: number } = {}): TokenVerification {
  if (typeof token !== "string") return Object.freeze({ valid: false, claims: null, reason: "token is not a string" });
  if (!secret || (typeof secret !== "string" && !Buffer.isBuffer(secret))) return Object.freeze({ valid: false, claims: null, reason: "secret is required" });
  const parts = token.split(".");
  if (parts.length !== 3) return Object.freeze({ valid: false, claims: null, reason: "malformed token" });
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const signingInput = `${headerPart}.${payloadPart}`;
  const expected = base64url(createHmac("sha256", secret).update(signingInput).digest());
  if (!sameString(signaturePart, expected)) return Object.freeze({ valid: false, claims: null, reason: "signature mismatch" });
  try {
    const header = decodeTokenPart(headerPart) as Record<string, unknown>;
    const claims = decodeTokenPart(payloadPart) as TokenClaims;
    if (header["alg"] !== "HS256" || header["typ"] !== "indieauth+hmac") {
      return Object.freeze({ valid: false, claims: null, reason: "unexpected token header" });
    }
    if (!claims || typeof claims.me !== "string" || typeof claims.client_id !== "string") {
      return Object.freeze({ valid: false, claims: null, reason: "missing token claims" });
    }
    const now = Math.floor((opts.now ?? Date.now()) / 1000);
    if (typeof claims.exp === "number" && now >= claims.exp) return Object.freeze({ valid: false, claims: null, reason: "token expired" });
    return Object.freeze({ valid: true, claims: Object.freeze(claims), reason: null });
  } catch {
    return Object.freeze({ valid: false, claims: null, reason: "undecodable token body" });
  }
}

export function bearerFromHeader(authorization: string | null | undefined): string | null {
  return bearerToken({ authorization: (authorization ?? "").trim() }) ?? null;
}

export function tokenHasScope(claims: Pick<TokenClaims, "scope"> | null | undefined, required: string): boolean {
  return typeof claims?.scope === "string" && claims.scope.split(/\s+/).includes(required);
}

function sameString(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function pkceChallenge(verifier: string, method: CodeChallengeMethod): string {
  if (!PKCE.test(verifier)) throw new TypeError("code_verifier must be 43-128 PKCE characters");
  if (method === "plain") return verifier;
  return base64url(createHash("sha256").update(verifier).digest());
}

export function verifyPkce(verifier: string, challenge: string, method: CodeChallengeMethod): boolean {
  return sameString(pkceChallenge(verifier, method), challenge);
}

export function authorizationRedirect(grant: AuthorizationGrant): string {
  const url = new URL(grant.redirectUri);
  url.searchParams.set("code", grant.code);
  url.searchParams.set("me", grant.me);
  if (grant.state) url.searchParams.set("state", grant.state);
  return url.href;
}

export function createAuthorizationGrant(request: AuthorizationRequest, opts: {
  code?: string;
  now?: () => string;
  ttlSeconds?: number;
  approvedBy?: string;
} = {}): AuthorizationGrant {
  const issuedAt = opts.now?.() ?? new Date().toISOString();
  const out: {
    code: string;
    issuedAt: string;
    expiresAt?: string;
    approvedBy?: string;
    me: string;
    clientId: string;
    redirectUri: string;
    state?: string;
    scope: readonly string[];
    responseType: "code";
    codeChallenge: string;
    codeChallengeMethod: CodeChallengeMethod;
  } = {
    ...request,
    code: opts.code ?? base64url(randomBytes(32)),
    issuedAt,
  };
  if (opts.ttlSeconds !== undefined) out.expiresAt = new Date(Date.parse(issuedAt) + opts.ttlSeconds * 1000).toISOString();
  if (opts.approvedBy !== undefined) out.approvedBy = opts.approvedBy;
  return Object.freeze(out);
}

export function validateTokenExchange(form: URLSearchParams, grant: AuthorizationGrant): void {
  if (form.get("grant_type") !== "authorization_code") throw new TypeError("grant_type must be authorization_code");
  if (form.get("code") !== grant.code) throw new TypeError("authorization code mismatch");
  if (absoluteHttpUrl(form.get("redirect_uri") ?? "", "redirect_uri") !== grant.redirectUri) throw new TypeError("redirect_uri mismatch");
  const clientId = form.get("client_id");
  if (clientId !== null && absoluteHttpUrl(clientId, "client_id") !== grant.clientId) throw new TypeError("client_id mismatch");
  const verifier = form.get("code_verifier") ?? "";
  if (!verifyPkce(verifier, grant.codeChallenge, grant.codeChallengeMethod)) throw new TypeError("PKCE verification failed");
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) throw new TypeError("authorization code expired");
}

export function indieAuthMetadata(opts: {
  issuer: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  introspectionEndpoint?: string;
  scopes?: readonly string[];
}): IndieAuthMetadata {
  const issuer = absoluteHttpUrl(opts.issuer, "issuer");
  const metadata: {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    introspection_endpoint?: string;
    scopes_supported?: readonly string[];
    response_types_supported: readonly ["code"];
    grant_types_supported: readonly ["authorization_code"];
    code_challenge_methods_supported: readonly CodeChallengeMethod[];
  } = {
    issuer,
    authorization_endpoint: absoluteHttpUrl(opts.authorizationEndpoint ?? new URL("/indieauth/authorize", issuer).href, "authorizationEndpoint"),
    token_endpoint: absoluteHttpUrl(opts.tokenEndpoint ?? new URL("/indieauth/token", issuer).href, "tokenEndpoint"),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["plain", "S256"],
  };
  if (opts.introspectionEndpoint !== undefined) metadata.introspection_endpoint = absoluteHttpUrl(opts.introspectionEndpoint, "introspectionEndpoint");
  if (opts.scopes !== undefined) metadata.scopes_supported = Object.freeze([...opts.scopes]);
  return Object.freeze(metadata);
}

function repr(status: number, body: unknown, headers: Record<string, string> = {}): Repr {
  return jsonRepr(body, { status, headers, pretty: true, cacheControl: { noStore: true } });
}

async function tokenBody(ctx: Parameters<NonNullable<App["resources"]>[number]["handler"]>[0]): Promise<URLSearchParams> {
  return readFormBody(ctx.req, { maxBytes: 64_000 });
}

function errorBody(error: unknown): Record<string, string> {
  return { error: error instanceof Error ? error.message : String(error) };
}

export function indieAuthApp(options: IndieAuthAppOptions): App {
  const paths = {
    authorization: "/indieauth/authorize",
    token: "/indieauth/token",
    metadata: "/.well-known/oauth-authorization-server",
    ...(options.paths ?? {}),
  };
  const issuer = absoluteHttpUrl(options.issuer, "issuer");
  const metadata = indieAuthMetadata({
    issuer,
    authorizationEndpoint: new URL(paths.authorization, issuer).href,
    tokenEndpoint: new URL(paths.token, issuer).href,
    ...(options.scopes !== undefined ? { scopes: options.scopes } : {}),
  });
  const metadataApp = wellKnown([{
    name: "oauth-authorization-server",
    methods: ["GET", "HEAD"],
    produces: ["application/json"],
    repr: repr(200, metadata),
  }]);
  const metadataResources = (metadataApp.resources ?? []).map((resource) => ({
    ...resource,
    id: resource.id ?? "indieauth.metadata",
    name: resource.name ?? "IndieAuth Metadata",
    route: resource.route ?? paths.metadata,
  }));
  return {
    resources: [
      ...metadataResources,
      {
        id: "indieauth.authorization",
        name: "IndieAuth Authorization",
        route: paths.authorization,
        match: paths.authorization,
        methods: ["GET", "POST"],
        produces: ["application/json"],
        handler: async (ctx) => {
          try {
            const request = validateAuthorizationRequest(ctx.url.searchParams);
            if (ctx.req.method === "GET") {
              return repr(200, { request });
            }
            const auth = authorizeBearer(ctx.req.headers, options.tokens);
            if (!auth.ok) {
              return repr(auth.status, { error: auth.reason }, auth.status === 401 ? { "WWW-Authenticate": "Bearer" } : {});
            }
            if (options.verifyRelMe) {
              const relMe = await verifyRelMe(request.me, request.clientId, options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl });
              if (!relMe.verified) {
                return repr(400, { error: relMe.reason ?? "rel=me verification failed", relMe });
              }
            }
            const grant = await options.store.createCode(request, auth);
            return repr(201, { code: grant.code, redirect: authorizationRedirect(grant) });
          } catch (error) {
            return repr(400, errorBody(error));
          }
        },
      },
      {
        id: "indieauth.token",
        name: "IndieAuth Token",
        route: paths.token,
        match: paths.token,
        methods: ["POST"],
        produces: ["application/json"],
        handler: async (ctx) => {
          try {
            const form = await tokenBody(ctx);
            const code = form.get("code") ?? "";
            const grant = await options.store.consumeCode(code);
            if (!grant) {
              return repr(400, { error: "invalid authorization code" });
            }
            validateTokenExchange(form, grant);
            const token = await options.store.issueToken(grant);
            return repr(200, token);
          } catch (error) {
            return repr(400, errorBody(error));
          }
        },
      },
    ],
  };
}

function globalFetch(label: string): FetchLike {
  if (typeof globalThis.fetch !== "function") throw new TypeError(`${label}: no fetch implementation (pass opts.fetchImpl)`);
  return globalThis.fetch as unknown as FetchLike;
}
