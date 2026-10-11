import { readTextBody, type App, type Repr } from "@red-cup-engineering/computing-with-http/app";
import { parseLinkHeader } from "@red-cup-engineering/computing-with-http/codecs/http";

export type FetchLike = (url: string, init?: RequestInit) => Promise<ResponseLike>;

export type HeadersLike = Pick<Headers, "get"> | Record<string, string | string[] | undefined>;

export type ResponseLike = Readonly<{
  url?: string;
  status: number;
  headers?: HeadersLike;
  text(): Promise<string>;
}>;

export type StartTag = Readonly<{
  name: string;
  attrs: Readonly<Record<string, string>>;
  index: number;
}>;

export type LinkHit = Readonly<{
  tag: "a" | "link";
  mf2Props: readonly string[];
  index: number;
}>;

export type MentionType = "reply" | "like" | "repost" | "bookmark" | "mention";

export type DiscoveryResult = Readonly<{
  endpoint: string | null;
  via: "link-header" | "html" | null;
  status: number;
  finalUrl: string;
}>;

export type VerificationStatus = "verified" | "deleted" | "retracted" | "invalid" | "error";

export type Verdict = Readonly<{
  status: VerificationStatus;
  verified: boolean;
  retract: boolean;
  type: MentionType | null;
  linkCount: number;
  httpStatus: number;
  source: string;
  target: string;
  reason?: string;
}>;

export type MentionRequest = Readonly<{
  ok: boolean;
  status: number;
  source: string | null;
  target: string | null;
  vouch?: string | null;
  reason?: string;
}>;

export type ReceiveResult = Readonly<{
  accepted: boolean;
  status: number;
  request: MentionRequest;
  verdict?: Verdict;
  reason?: string;
}>;

export type SendResult = Readonly<{
  ok: boolean;
  status: "sent" | "no-endpoint" | "rejected" | "error";
  endpoint: string | null;
  httpStatus: number;
  location: string | null;
  source: string;
  target: string;
  reason?: string;
}>;

export type VouchVerdict = Readonly<{
  status: "verified" | "invalid" | "error";
  verified: boolean;
  vouch: string;
  source: string;
  target: string;
  linkCount: number;
  httpStatus: number;
  reason?: string;
}>;

export type ReceiverRecord = Readonly<{
  source: string;
  target: string;
  verdict: Verdict;
}>;

export type WebmentionReceiverOptions = Readonly<{
  baseUrl: string;
  path?: string;
  fetchImpl?: FetchLike;
  verify?: (source: string, target: string, opts?: { fetchImpl?: FetchLike }) => Promise<Verdict>;
  onMention?: (record: ReceiverRecord) => void | Promise<void>;
  maxBodyBytes?: number;
  allowFragmention?: boolean;
  requireVouch?: boolean;
}>;

export const TYPE_TABLE = Object.freeze([
  ["u-in-reply-to", "reply"],
  ["u-like-of", "like"],
  ["u-repost-of", "repost"],
  ["u-bookmark-of", "bookmark"],
] as const satisfies ReadonlyArray<readonly [string, MentionType]>);

const MF2_LINK_PROPS = Object.freeze(["in-reply-to", "like-of", "repost-of", "bookmark-of"] as const);

export function parseAttrs(attrText: string): Record<string, string> {
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    attrs[name] = value;
  }
  return attrs;
}

export function decodeEntities(value: string): string {
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

function relTokens(attrs: Readonly<Record<string, string>>): string[] {
  const rel = attrs["rel"];
  return rel ? decodeEntities(rel).trim().toLowerCase().split(/\s+/).filter(Boolean) : [];
}

export function scanStartTags(html: string): StartTag[] {
  const out: StartTag[] = [];
  let index = 0;
  while (index < html.length) {
    const lt = html.indexOf("<", index);
    if (lt === -1) break;
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt + 1);
      index = end === -1 ? html.length : end + 1;
      continue;
    }
    const gt = html.indexOf(">", lt);
    if (gt === -1) break;
    const isEnd = html[lt + 1] === "/";
    const inner = html.slice(lt + 1, gt);
    const nameMatch = /^\/?\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(inner);
    if (!nameMatch) {
      index = gt + 1;
      continue;
    }
    const name = nameMatch[1]!.toLowerCase();
    if (!isEnd) {
      const attrText = inner.slice(nameMatch[0].length).replace(/\/\s*$/, "");
      out.push({ name, attrs: parseAttrs(attrText), index: lt });
    }
    if (!isEnd && (name === "script" || name === "style" || name === "template")) {
      const close = new RegExp(`</${name}\\b`, "i").exec(html.slice(gt + 1));
      index = close ? gt + 1 + close.index : html.length;
      continue;
    }
    index = gt + 1;
  }
  return out;
}

export function documentBase(html: string, fallbackUrl: string): string {
  for (const tag of scanStartTags(html)) {
    if (tag.name === "base" && tag.attrs["href"] !== undefined) {
      try {
        return new URL(decodeEntities(tag.attrs["href"]!), fallbackUrl).href;
      } catch {
        return fallbackUrl;
      }
    }
  }
  return fallbackUrl;
}

export function webmentionEndpointsInHtml(html: string, baseUrl: string): string[] {
  const base = documentBase(html, baseUrl);
  const found: string[] = [];
  for (const tag of scanStartTags(html)) {
    if (tag.name !== "link" && tag.name !== "a") continue;
    if (!relTokens(tag.attrs).includes("webmention")) continue;
    const href = tag.attrs["href"];
    if (href === undefined) continue;
    try {
      found.push(new URL(decodeEntities(href), base).href);
    } catch {
      // Skip unparseable endpoints.
    }
  }
  return found;
}

export function linksToTarget(html: string, baseUrl: string, target: string): LinkHit[] {
  const base = documentBase(html, baseUrl);
  return linksToTargets(html, baseUrl, [target, ...fragmentionFallbacks(target, base)]);
}

function linksToTargets(html: string, baseUrl: string, targets: readonly string[]): LinkHit[] {
  const base = documentBase(html, baseUrl);
  const targetHrefs = new Set<string>();
  for (const target of targets) {
    try {
      targetHrefs.add(new URL(target, base).href);
    } catch {
      // Ignore invalid fallback targets.
    }
  }
  if (targetHrefs.size === 0) return [];
  let targetHref: string;
  try {
    targetHref = new URL(targets[0] ?? "", base).href;
  } catch {
    return [];
  }
  void targetHref;
  const hits: LinkHit[] = [];
  for (const tag of scanStartTags(html)) {
    if (tag.name !== "a" && tag.name !== "link") continue;
    const href = tag.attrs["href"];
    if (href === undefined) continue;
    let resolved: string;
    try {
      resolved = new URL(decodeEntities(href), base).href;
    } catch {
      continue;
    }
    if (!targetHrefs.has(resolved)) continue;
    const classes = (tag.attrs["class"] ? decodeEntities(tag.attrs["class"]) : "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const mf2Props = MF2_LINK_PROPS
      .filter((prop) => classes.includes(`u-${prop}`))
      .map((prop) => `u-${prop}`);
    hits.push({ tag: tag.name, mf2Props, index: tag.index });
  }
  return hits;
}

export function fragmentionFallbacks(target: string, baseUrl = target): readonly string[] {
  try {
    const url = new URL(target, baseUrl);
    if (!url.hash) return [];
    url.hash = "";
    return Object.freeze([url.href]);
  } catch {
    return [];
  }
}

export function outboundLinks(html: string, baseUrl: string): readonly string[] {
  const base = documentBase(html, baseUrl);
  const found = new Set<string>();
  for (const tag of scanStartTags(html)) {
    if (tag.name !== "a" && tag.name !== "link") continue;
    const href = tag.attrs["href"];
    if (href === undefined) continue;
    try {
      const resolved = new URL(decodeEntities(href), base);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") found.add(resolved.href);
    } catch {
      // Skip unparseable links.
    }
  }
  return Object.freeze([...found].sort());
}

export function webmentionEndpointsInLinkHeader(linkHeader: string | null | undefined, responseUrl: string): string[] {
  const out: string[] = [];
  for (const link of parseLinkHeader(linkHeader ?? "")) {
    const rel = (link.params["rel"] ?? "").toLowerCase().split(/\s+/);
    if (!rel.includes("webmention")) continue;
    try {
      out.push(new URL(link.href, responseUrl).href);
    } catch {
      // Skip unparseable endpoints.
    }
  }
  return out;
}

export function headerValue(headers: HeadersLike | undefined, name: string): string | null {
  if (!headers) return null;
  if (typeof (headers as Pick<Headers, "get">).get === "function") {
    return (headers as Pick<Headers, "get">).get(name) ?? null;
  }
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== lower) continue;
    const value = (headers as Record<string, string | string[] | undefined>)[key];
    return Array.isArray(value) ? value.join(", ") : value === undefined ? null : String(value);
  }
  return null;
}

export async function discoverEndpoint(targetUrl: string, opts: { fetchImpl?: FetchLike } = {}): Promise<DiscoveryResult> {
  const doFetch = opts.fetchImpl ?? globalFetch("discoverEndpoint");
  const res = await doFetch(targetUrl, {
    method: "GET",
    redirect: "follow",
    headers: { accept: "text/html, */*;q=0.8" },
  });
  const finalUrl = res.url || targetUrl;
  const status = res.status;
  const headerEndpoints = webmentionEndpointsInLinkHeader(headerValue(res.headers, "link"), finalUrl);
  if (headerEndpoints.length > 0) {
    return { endpoint: headerEndpoints[0]!, via: "link-header", status, finalUrl };
  }
  const contentType = (headerValue(res.headers, "content-type") ?? "").toLowerCase();
  if (contentType.includes("html") || contentType === "") {
    const body = await res.text();
    const htmlEndpoints = webmentionEndpointsInHtml(body, finalUrl);
    if (htmlEndpoints.length > 0) {
      return { endpoint: htmlEndpoints[0]!, via: "html", status, finalUrl };
    }
  }
  return { endpoint: null, via: null, status, finalUrl };
}

export function classifyProps(mf2Props: readonly string[]): MentionType {
  const set = new Set(mf2Props);
  for (const [prop, type] of TYPE_TABLE) {
    if (set.has(prop)) return type;
  }
  return "mention";
}

export function classifyMention(hits: readonly Readonly<{ mf2Props: readonly string[] }>[]): MentionType {
  const all = new Set<string>();
  for (const hit of hits) for (const prop of hit.mf2Props) all.add(prop);
  for (const [prop, type] of TYPE_TABLE) {
    if (all.has(prop)) return type;
  }
  return "mention";
}

export function validatePair(source: string, target: string): string | null {
  if (typeof source !== "string" || typeof target !== "string") return "source and target must both be strings";
  let s: URL;
  let t: URL;
  try { s = new URL(source); } catch { return "source is not a valid URL"; }
  try { t = new URL(target); } catch { return "target is not a valid URL"; }
  if (s.protocol !== "http:" && s.protocol !== "https:") return "source scheme must be http/https";
  if (t.protocol !== "http:" && t.protocol !== "https:") return "target scheme must be http/https";
  if (s.href === t.href) return "source and target must differ";
  return null;
}

export async function verifyMention(source: string, target: string, opts: { fetchImpl?: FetchLike } = {}): Promise<Verdict> {
  const base = {
    verified: false,
    retract: false,
    type: null,
    linkCount: 0,
    httpStatus: 0,
    source,
    target,
  } satisfies Omit<Verdict, "status" | "reason">;
  const badPair = validatePair(source, target);
  if (badPair) return { ...base, status: "invalid", reason: badPair };
  const doFetch = opts.fetchImpl ?? globalFetch("verifyMention");

  let res: ResponseLike;
  try {
    res = await doFetch(source, {
      method: "GET",
      redirect: "follow",
      headers: { accept: "text/html, */*;q=0.8" },
    });
  } catch (err) {
    return { ...base, status: "error", reason: String((err as Error | undefined)?.message ?? err) };
  }

  const httpStatus = res.status;
  const finalUrl = res.url || source;
  if (httpStatus === 410) {
    return { ...base, status: "deleted", retract: true, httpStatus, reason: "source returned 410 Gone" };
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    return { ...base, status: "invalid", httpStatus, reason: `source returned HTTP ${httpStatus}` };
  }

  let body: string;
  try {
    body = await res.text();
  } catch (err) {
    return { ...base, status: "error", httpStatus, reason: String((err as Error | undefined)?.message ?? err) };
  }
  const contentType = (headerValue(res.headers, "content-type") ?? "").toLowerCase();
  const couldBeHtml = contentType.includes("html") || contentType.includes("xml") || contentType === "";
  const hits = couldBeHtml ? linksToTarget(body, finalUrl, target) : [];
  if (hits.length === 0) {
    return { ...base, status: "retracted", retract: true, httpStatus, reason: "source no longer links to target" };
  }
  return {
    ...base,
    status: "verified",
    verified: true,
    type: classifyMention(hits),
    linkCount: hits.length,
    httpStatus,
  };
}

export async function verifyVouch(vouch: string, source: string, target: string, opts: { fetchImpl?: FetchLike } = {}): Promise<VouchVerdict> {
  const base = {
    verified: false,
    vouch,
    source,
    target,
    linkCount: 0,
    httpStatus: 0,
  } satisfies Omit<VouchVerdict, "status" | "reason">;
  const badSourcePair = validatePair(vouch, source);
  const badTargetPair = validatePair(vouch, target);
  if (badSourcePair && badTargetPair) return { ...base, status: "invalid", reason: "vouch must be a valid third-party URL" };
  const doFetch = opts.fetchImpl ?? globalFetch("verifyVouch");
  let res: ResponseLike;
  try {
    res = await doFetch(vouch, {
      method: "GET",
      redirect: "follow",
      headers: { accept: "text/html, */*;q=0.8" },
    });
  } catch (err) {
    return { ...base, status: "error", reason: String((err as Error | undefined)?.message ?? err) };
  }
  const httpStatus = res.status;
  if (httpStatus < 200 || httpStatus >= 300) return { ...base, status: "invalid", httpStatus, reason: `vouch returned HTTP ${httpStatus}` };
  try {
    const body = await res.text();
    const finalUrl = res.url || vouch;
    const sourceHits = linksToTarget(body, finalUrl, source);
    const targetHits = linksToTarget(body, finalUrl, target);
    const linkCount = sourceHits.length + targetHits.length;
    return linkCount >= 2
      ? { ...base, status: "verified", verified: true, linkCount, httpStatus }
      : { ...base, status: "invalid", linkCount, httpStatus, reason: "vouch page must link to both source and target" };
  } catch (err) {
    return { ...base, status: "error", httpStatus, reason: String((err as Error | undefined)?.message ?? err) };
  }
}

export function parseMentionRequest(rawBody: string, contentType = "application/x-www-form-urlencoded"): MentionRequest {
  let source: string | null = null;
  let target: string | null = null;
  let vouch: string | null = null;
  const ct = contentType.toLowerCase();
  if (ct.includes("application/json")) {
    try {
      const obj = JSON.parse(rawBody || "{}") as Record<string, unknown>;
      source = typeof obj["source"] === "string" ? obj["source"] : null;
      target = typeof obj["target"] === "string" ? obj["target"] : null;
      vouch = typeof obj["vouch"] === "string" ? obj["vouch"] : null;
    } catch {
      return { ok: false, status: 400, source: null, target: null, reason: "invalid JSON body" };
    }
  } else {
    const params = new URLSearchParams(rawBody || "");
    source = params.get("source");
    target = params.get("target");
    vouch = params.get("vouch");
  }

  if (!source || !target) return { ok: false, status: 400, source, target, reason: "source and target are required" };
  const badPair = validatePair(source, target);
  return badPair
    ? { ok: false, status: 400, source, target, ...(vouch === null ? {} : { vouch }), reason: badPair }
    : { ok: true, status: 202, source, target, ...(vouch === null ? {} : { vouch }) };
}

export function acceptsTarget(target: string, baseUrl: string): boolean {
  let targetUrl: URL;
  let base: URL;
  try { targetUrl = new URL(target); } catch { return false; }
  try { base = new URL(baseUrl); } catch { return false; }
  if (targetUrl.host !== base.host) return false;
  if (targetUrl.protocol !== base.protocol && !(base.protocol === "http:" && targetUrl.protocol === "https:")) return false;
  const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  if (basePath === "/") return true;
  return targetUrl.pathname === base.pathname || targetUrl.pathname.startsWith(basePath);
}

export async function receiveMention(rawBody: string, opts: {
  contentType?: string;
  baseUrl?: string;
  verify?: (source: string, target: string, opts?: { fetchImpl?: FetchLike }) => Promise<Verdict>;
  fetchImpl?: FetchLike;
  requireVouch?: boolean;
  verifyVouch?: (vouch: string, source: string, target: string, opts?: { fetchImpl?: FetchLike }) => Promise<VouchVerdict>;
} = {}): Promise<ReceiveResult> {
  const request = parseMentionRequest(rawBody, opts.contentType);
  if (!request.ok) {
    return {
      accepted: false,
      status: request.status,
      request,
      ...(request.reason === undefined ? {} : { reason: request.reason }),
    };
  }
  if (opts.baseUrl && !acceptsTarget(request.target!, opts.baseUrl)) {
    return { accepted: false, status: 400, request, reason: "target is not a resource on this site" };
  }
  if (opts.requireVouch || request.vouch) {
    if (!request.vouch) return { accepted: false, status: 400, request, reason: "vouch is required" };
    const verifyVouchFn = opts.verifyVouch ?? verifyVouch;
    const vouchVerdict = await verifyVouchFn(
      request.vouch,
      request.source!,
      request.target!,
      opts.fetchImpl === undefined ? {} : { fetchImpl: opts.fetchImpl },
    );
    if (!vouchVerdict.verified) return { accepted: false, status: 400, request, reason: vouchVerdict.reason ?? "vouch did not verify" };
  }
  const verify = opts.verify ?? verifyMention;
  const verdict = await verify(
    request.source!,
    request.target!,
    opts.fetchImpl === undefined ? {} : { fetchImpl: opts.fetchImpl },
  );
  return { accepted: true, status: 202, request, verdict };
}

export async function send(source: string, target: string, opts: {
  fetchImpl?: FetchLike;
  endpoint?: string;
  vouch?: string;
} = {}): Promise<SendResult> {
  const doFetch = opts.fetchImpl ?? globalFetch("send");
  const base = { ok: false, endpoint: null, httpStatus: 0, location: null, source, target };
  let endpoint = opts.endpoint ?? null;
  if (!endpoint) {
    try {
      endpoint = (await discoverEndpoint(target, { fetchImpl: doFetch })).endpoint;
    } catch (err) {
      return { ...base, status: "error", reason: `discovery failed: ${String((err as Error | undefined)?.message ?? err)}` };
    }
  }
  if (!endpoint) return { ...base, status: "no-endpoint", reason: "target advertises no Webmention endpoint" };

  const params = new URLSearchParams({ source, target });
  if (opts.vouch) params.set("vouch", opts.vouch);
  const body = params.toString();
  let res: ResponseLike;
  try {
    res = await doFetch(endpoint, {
      method: "POST",
      redirect: "follow",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body,
    });
  } catch (err) {
    return { ...base, endpoint, status: "error", reason: `POST failed: ${String((err as Error | undefined)?.message ?? err)}` };
  }
  const httpStatus = res.status;
  const location = headerValue(res.headers, "location");
  const ok = httpStatus >= 200 && httpStatus < 300;
  return {
    ...base,
    endpoint,
    httpStatus,
    location,
    ok,
    status: ok ? "sent" : "rejected",
    ...(ok ? {} : { reason: `receiver returned HTTP ${httpStatus}` }),
  };
}

export async function sendAll(source: string, targets: readonly string[], opts: {
  fetchImpl?: FetchLike;
  endpoint?: string;
  vouch?: string;
} = {}): Promise<SendResult[]> {
  const results: SendResult[] = [];
  for (const target of targets) results.push(await send(source, target, opts));
  return results;
}

export async function sendSalmentions(source: string, sourceHtml: string, opts: {
  fetchImpl?: FetchLike;
  exclude?: readonly string[];
  vouch?: string;
} = {}): Promise<SendResult[]> {
  const exclude = new Set([source, ...(opts.exclude ?? [])]);
  const targets = outboundLinks(sourceHtml, source).filter((target) => !exclude.has(target));
  return sendAll(source, targets, opts);
}

function receiverRepr(status: number, body: unknown): Repr {
  return {
    status,
    type: "application/json; charset=utf-8",
    body: `${JSON.stringify(body)}\n`,
  };
}

export function webmentionReceiverApp(opts: WebmentionReceiverOptions): App {
  const path = opts.path ?? "/webmention";
  const maxBodyBytes = opts.maxBodyBytes ?? 1024 * 1024;
  return {
    resources: [
      {
        id: "webmention.receiver",
        name: "Webmention Receiver",
        route: path,
        match: path,
        methods: ["POST"],
        produces: ["application/json"],
        handler: async (ctx) => {
          let raw = "";
          try {
            raw = await readTextBody(ctx.req, { maxBytes: maxBodyBytes });
          } catch {
            return receiverRepr(413, { error: "request body too large" });
          }
          const result = await receiveMention(raw, {
            baseUrl: opts.baseUrl,
            ...(opts.requireVouch === undefined ? {} : { requireVouch: opts.requireVouch }),
            ...(headerValue(ctx.req.headers, "content-type") === null ? {} : { contentType: headerValue(ctx.req.headers, "content-type")! }),
            ...(opts.fetchImpl === undefined ? {} : { fetchImpl: opts.fetchImpl }),
            ...(opts.verify === undefined ? {} : { verify: opts.verify }),
          });
          if (result.accepted && result.verdict) {
            await opts.onMention?.({ source: result.request.source!, target: result.request.target!, verdict: result.verdict });
          }
          return receiverRepr(result.status, result);
        },
      },
    ],
  };
}

function globalFetch(label: string): FetchLike {
  if (typeof globalThis.fetch !== "function") throw new TypeError(`${label}: no fetch implementation (pass opts.fetchImpl)`);
  return globalThis.fetch as unknown as FetchLike;
}
