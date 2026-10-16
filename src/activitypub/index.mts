import { createHash, createSign, createVerify } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { jsonRepr, readTextBody, type App, type Repr } from "@red-cup-engineering/computing-with-http/app";
import { httpDate } from "@red-cup-engineering/computing-with-http/codecs/http";
import { assertHttpUrl } from "@red-cup-engineering/uri-services-section/http-url";
import type { Assertion, AssertionTrace } from "../sync-guard/wire.mjs";
import {
  authorizeBearer,
  type AuthDecision,
  type TokenPolicy,
} from "../sync-guard/index.mjs";

export type JsonRecord = Record<string, unknown>;

export type ActorType = "Application" | "Group" | "Organization" | "Person" | "Service";
export type ActivityType = "Accept" | "Announce" | "Create" | "Delete" | "Follow" | "Like" | "Reject" | "Undo" | "Update";

export type ActivityAudience = string | readonly string[] | undefined;

export type ActivityPubActor = Readonly<{
  id: string;
  type: ActorType;
  preferredUsername: string;
  inbox: string;
  outbox: string;
  followers?: string;
  following?: string;
  name?: string;
  summary?: string;
  url?: string;
  icon?: JsonRecord;
  publicKey?: Readonly<{
    id: string;
    owner: string;
    publicKeyPem: string;
  }>;
}>;

export type ActivityObject = Readonly<{
  id: string;
  type: string;
  attributedTo?: string;
  name?: string;
  content?: string;
  summary?: string;
  url?: string;
  published?: string;
  updated?: string;
  to?: ActivityAudience;
  cc?: ActivityAudience;
  tag?: unknown;
  attachment?: unknown;
  source?: JsonRecord;
  properties?: JsonRecord;
}>;

export type ActivityCell = Readonly<{
  predicate: string;
  object: unknown;
  claimedBy?: string;
  contraryClaimedBy?: string;
}>;

// Bucket names are the dynamical charge values: `potential` cells are claimed
// and unspent, `active` cells are reached only by derivation, and `stable`
// cells carry held contradictions — rendered, never thrown.
export type ActivityFiniteAlgebra = Readonly<{
  potential?: readonly ActivityCell[];
  active?: readonly ActivityCell[];
  stable?: readonly ActivityCell[];
  t?: unknown;
}>;

export type Activity = Readonly<{
  id: string;
  type: ActivityType;
  actor: string;
  object?: string | ActivityObject | Activity;
  target?: string;
  to?: ActivityAudience;
  cc?: ActivityAudience;
  published?: string;
  summary?: string;
}>;

export type ActivityCollectionPage<T> = Readonly<{
  "@context": "https://www.w3.org/ns/activitystreams";
  id: string;
  type: "OrderedCollectionPage";
  partOf: string;
  totalItems: number;
  orderedItems: readonly T[];
  next?: string;
  prev?: string;
}>;

export type ActivityCollection<T> = Readonly<{
  "@context": "https://www.w3.org/ns/activitystreams";
  id: string;
  type: "OrderedCollection";
  totalItems: number;
  first: string | ActivityCollectionPage<T>;
}>;

export type ActivityPubStore = Readonly<{
  actor: (auth?: AuthDecision) => ActivityPubActor | Promise<ActivityPubActor>;
  inbox?: (activity: Activity, auth: AuthDecision) => ActivityPubStoreResult | Promise<ActivityPubStoreResult>;
  outbox?: (activity: Activity, auth: AuthDecision) => ActivityPubStoreResult | Promise<ActivityPubStoreResult>;
  outboxItems?: (auth?: AuthDecision) => readonly Activity[] | Promise<readonly Activity[]>;
  inboxItems?: (auth?: AuthDecision) => readonly Activity[] | Promise<readonly Activity[]>;
}>;

export type ActivityPubStoreResult = Readonly<{
  accepted: boolean;
  assertions?: AssertionTrace;
  id?: string;
}>;

export type ActivityPubAppOptions = Readonly<{
  store: ActivityPubStore;
  tokens?: TokenPolicy;
  httpSignatures?: HttpSignatureVerifier;
  webfinger?: (query: WebFingerQuery) => WebFingerAccount | null | undefined | Promise<WebFingerAccount | null | undefined>;
  nodeInfo?: NodeInfoFacts;
  paths?: {
    actor?: string;
    inbox?: string;
    outbox?: string;
    nodeInfo?: string;
  };
  baseUrl?: string;
  maxBodyBytes?: number;
  pageSize?: number;
}>;

export type WebFingerAccount = Readonly<{
  user: string;
  host: string;
  actorId: string;
  profileUrl?: string;
}>;

export type WebFingerQuery = Readonly<{
  resource: string;
  acct: Readonly<{ user: string; host: string }> | null;
  rels: readonly string[];
}>;

export type WebFingerDecision = Readonly<{
  status: number;
  jrd?: JsonRecord;
  mediaType?: string;
  reason?: string;
}>;

export type NodeInfoFacts = Readonly<{
  baseUrl: string;
  software: Readonly<{
    name: string;
    version: string;
    repository?: string;
    homepage?: string;
  }>;
  protocols?: readonly string[];
  services?: Readonly<{
    inbound?: readonly string[];
    outbound?: readonly string[];
  }>;
  openRegistrations?: boolean;
  usage?: Readonly<{
    users?: Readonly<{
      total?: number;
      activeMonth?: number;
      activeHalfyear?: number;
    }>;
    localPosts?: number;
  }>;
  metadata?: JsonRecord;
  documentPath?: string;
}>;

export type NodeInfoDecision = Readonly<{
  status: number;
  body?: JsonRecord;
  reason?: string;
}>;

export type HttpSignatureVerifier = Readonly<{
  required?: boolean;
  publicKeyFor: (keyId: string) => string | undefined | Promise<string | undefined>;
}>;

export type HttpSignatureInput = Readonly<{
  method: string;
  url: string;
  headers: IncomingHttpHeaders | Record<string, string | readonly string[] | undefined>;
  body?: string | Buffer;
}>;

export type HttpSignatureParameters = Readonly<{
  keyId: string;
  algorithm: string;
  headers: readonly string[];
  signature: string;
}>;

export type SignHttpRequestOptions = Readonly<{
  keyId: string;
  privateKeyPem: string;
  headers?: readonly string[];
  algorithm?: "rsa-sha256";
  now?: () => Date;
}>;

const AS2 = "https://www.w3.org/ns/activitystreams";
const SECURITY = "https://w3id.org/security/v1";
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
const ACTIVITY_JSON = "application/activity+json; charset=utf-8";
const DEFAULT_SIGNED_HEADERS = Object.freeze(["(request-target)", "host", "date"]);
export const JRD_MEDIA_TYPE = "application/jrd+json";
export const WEBFINGER_PATH = "/.well-known/webfinger";
export const NODEINFO_2_1_REL = "http://nodeinfo.diaspora.software/ns/schema/2.1";
export const NODEINFO_WELL_KNOWN = "/.well-known/nodeinfo";
export const NODEINFO_2_1_PATH = "/nodeinfo/2.1";

function optionalArray(value: ActivityAudience): readonly string[] | undefined {
  if (value === undefined) return undefined;
  return Object.freeze((Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string" && item.length > 0));
}

function headerValue(headers: HttpSignatureInput["headers"], name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.join(", ");
    return undefined;
  }
  return undefined;
}

function bodyBuffer(body: string | Buffer | undefined): Buffer {
  if (body === undefined) return Buffer.alloc(0);
  return Buffer.isBuffer(body) ? body : Buffer.from(body);
}

export function activityDigest(body: string | Buffer): string {
  return `SHA-256=${createHash("sha256").update(bodyBuffer(body)).digest("base64")}`;
}

function requestTarget(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

export function httpSigningString(input: HttpSignatureInput, signedHeaders: readonly string[]): string {
  return signedHeaders.map((name) => {
    const lower = name.toLowerCase();
    if (lower === "(request-target)") return `(request-target): ${input.method.toLowerCase()} ${requestTarget(input.url)}`;
    if (lower === "digest" && input.body !== undefined) return `digest: ${headerValue(input.headers, "digest") ?? activityDigest(input.body)}`;
    const value = headerValue(input.headers, lower);
    if (value === undefined) throw new TypeError(`missing signed header: ${lower}`);
    return `${lower}: ${value}`;
  }).join("\n");
}

export function parseSignatureHeader(value: string | undefined): HttpSignatureParameters | null {
  if (!value) return null;
  const params = new Map<string, string>();
  for (const part of value.split(",")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    const key = rawKey?.trim();
    const joined = rawValue.join("=").trim();
    if (!key || !joined.startsWith("\"") || !joined.endsWith("\"")) continue;
    params.set(key, joined.slice(1, -1));
  }
  const keyId = params.get("keyId");
  const algorithm = params.get("algorithm") ?? "rsa-sha256";
  const signature = params.get("signature");
  if (!keyId || !signature) return null;
  return Object.freeze({
    keyId,
    algorithm,
    signature,
    headers: Object.freeze((params.get("headers") ?? "(request-target) host date").split(/\s+/).filter(Boolean)),
  });
}

function signatureHeader(parameters: HttpSignatureParameters): string {
  return [
    `keyId="${parameters.keyId}"`,
    `algorithm="${parameters.algorithm}"`,
    `headers="${parameters.headers.join(" ")}"`,
    `signature="${parameters.signature}"`,
  ].join(",");
}

export function signHttpRequest(input: HttpSignatureInput, options: SignHttpRequestOptions): Record<string, string> {
  const date = headerValue(input.headers, "date") ?? httpDate(options.now?.() ?? new Date());
  const host = headerValue(input.headers, "host") ?? new URL(input.url).host;
  const digest = input.body !== undefined ? activityDigest(input.body) : undefined;
  const headers = {
    ...Object.fromEntries(Object.entries(input.headers).filter(([, value]) => typeof value === "string")) as Record<string, string>,
    host,
    date,
    ...(digest ? { digest } : {}),
  };
  const signedHeaders = options.headers ?? (digest ? [...DEFAULT_SIGNED_HEADERS, "digest"] : DEFAULT_SIGNED_HEADERS);
  const signingString = httpSigningString({ ...input, headers }, signedHeaders);
  const signature = createSign("RSA-SHA256").update(signingString).sign(options.privateKeyPem, "base64");
  return {
    Date: date,
    Host: host,
    ...(digest ? { Digest: digest } : {}),
    Signature: signatureHeader({
      keyId: options.keyId,
      algorithm: options.algorithm ?? "rsa-sha256",
      headers: signedHeaders,
      signature,
    }),
  };
}

export function verifyHttpSignature(input: HttpSignatureInput, publicKeyPem: string): HttpSignatureParameters | null {
  const parameters = parseSignatureHeader(headerValue(input.headers, "signature"));
  if (!parameters) return null;
  if (parameters.algorithm.toLowerCase() !== "rsa-sha256") return null;
  const digest = headerValue(input.headers, "digest");
  if (digest !== undefined && input.body !== undefined && digest !== activityDigest(input.body)) return null;
  const signingString = httpSigningString(input, parameters.headers);
  const valid = createVerify("RSA-SHA256").update(signingString).verify(publicKeyPem, parameters.signature, "base64");
  return valid ? parameters : null;
}

function withContext<T extends JsonRecord>(document: T): T & { "@context": string } {
  return { "@context": AS2, ...document };
}

export function actorDocument(actor: ActivityPubActor): JsonRecord {
  assertHttpUrl(actor.id, "actor.id");
  assertHttpUrl(actor.inbox, "actor.inbox");
  assertHttpUrl(actor.outbox, "actor.outbox");
  const document = {
    id: actor.id,
    type: actor.type,
    preferredUsername: actor.preferredUsername,
    inbox: actor.inbox,
    outbox: actor.outbox,
    ...(actor.followers ? { followers: actor.followers } : {}),
    ...(actor.following ? { following: actor.following } : {}),
    ...(actor.name ? { name: actor.name } : {}),
    ...(actor.summary ? { summary: actor.summary } : {}),
    ...(actor.url ? { url: actor.url } : {}),
    ...(actor.icon ? { icon: actor.icon } : {}),
    ...(actor.publicKey ? { publicKey: actor.publicKey } : {}),
  };
  return actor.publicKey
    ? { "@context": [AS2, SECURITY], ...document }
    : withContext(document);
}

export function noteObject(input: {
  id: string;
  attributedTo: string;
  content: string;
  name?: string;
  summary?: string;
  url?: string;
  published?: string;
  to?: ActivityAudience;
  cc?: ActivityAudience;
  tag?: unknown;
}): ActivityObject {
  assertHttpUrl(input.id, "object.id");
  assertHttpUrl(input.attributedTo, "object.attributedTo");
  const to = optionalArray(input.to ?? PUBLIC);
  const cc = optionalArray(input.cc);
  return Object.freeze({
    id: input.id,
    type: "Note",
    attributedTo: input.attributedTo,
    content: input.content,
    ...(input.name ? { name: input.name } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.url ? { url: input.url } : {}),
    ...(input.published ? { published: input.published } : {}),
    ...(to ? { to } : {}),
    ...(cc ? { cc } : {}),
    ...(input.tag ? { tag: input.tag } : {}),
  });
}

export function articleObject(input: {
  id: string;
  attributedTo: string;
  name: string;
  content: string;
  summary?: string;
  url?: string;
  published?: string;
  updated?: string;
  to?: ActivityAudience;
  cc?: ActivityAudience;
  tag?: unknown;
}): ActivityObject {
  assertHttpUrl(input.id, "object.id");
  assertHttpUrl(input.attributedTo, "object.attributedTo");
  const to = optionalArray(input.to ?? PUBLIC);
  const cc = optionalArray(input.cc);
  return Object.freeze({
    id: input.id,
    type: "Article",
    attributedTo: input.attributedTo,
    name: input.name,
    content: input.content,
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.url ? { url: input.url } : {}),
    ...(input.published ? { published: input.published } : {}),
    ...(input.updated ? { updated: input.updated } : {}),
    ...(to ? { to } : {}),
    ...(cc ? { cc } : {}),
    ...(input.tag ? { tag: input.tag } : {}),
  });
}

export function createActivity(input: {
  id: string;
  actor: string;
  object: ActivityObject;
  published?: string;
  to?: ActivityAudience;
  cc?: ActivityAudience;
}): Activity {
  assertHttpUrl(input.id, "activity.id");
  assertHttpUrl(input.actor, "activity.actor");
  return Object.freeze({
    id: input.id,
    type: "Create",
    actor: input.actor,
    object: input.object,
    ...(input.published ? { published: input.published } : {}),
    ...(optionalArray(input.to ?? input.object.to) ? { to: optionalArray(input.to ?? input.object.to) } : {}),
    ...(optionalArray(input.cc ?? input.object.cc) ? { cc: optionalArray(input.cc ?? input.object.cc) } : {}),
  });
}

export function activityDocument(activity: Activity): JsonRecord {
  assertHttpUrl(activity.id, "activity.id");
  assertHttpUrl(activity.actor, "activity.actor");
  return withContext({
    id: activity.id,
    type: activity.type,
    actor: activity.actor,
    ...(activity.object !== undefined ? { object: activity.object } : {}),
    ...(activity.target ? { target: activity.target } : {}),
    ...(activity.to ? { to: optionalArray(activity.to) } : {}),
    ...(activity.cc ? { cc: optionalArray(activity.cc) } : {}),
    ...(activity.published ? { published: activity.published } : {}),
    ...(activity.summary ? { summary: activity.summary } : {}),
  });
}

export function parseAcct(resource: string): { user: string; host: string } | null {
  if (typeof resource !== "string") return null;
  const bare = resource.startsWith("acct:") ? resource.slice("acct:".length) : resource;
  if (/^[a-z][a-z0-9+.-]*:/i.test(bare)) return null;
  const at = bare.lastIndexOf("@");
  if (at <= 0 || at === bare.length - 1) return null;
  return { user: bare.slice(0, at), host: bare.slice(at + 1) };
}

export function selfLink(actorId: string): JsonRecord {
  assertHttpUrl(actorId, "actorId");
  return { rel: "self", type: "application/activity+json", href: actorId };
}

export function jrd(fields: {
  subject: string;
  aliases?: readonly string[];
  properties?: JsonRecord;
  links?: readonly JsonRecord[];
}, rels: readonly string[] = []): JsonRecord {
  const wanted = new Set(rels.filter(Boolean));
  const links = wanted.size > 0
    ? (fields.links ?? []).filter((link) => typeof link.rel === "string" && wanted.has(link.rel))
    : [...(fields.links ?? [])];
  return {
    subject: fields.subject,
    ...(fields.aliases?.length ? { aliases: [...fields.aliases] } : {}),
    ...(fields.properties && Object.keys(fields.properties).length > 0 ? { properties: fields.properties } : {}),
    links,
  };
}

export function accountJrd(account: WebFingerAccount, rels: readonly string[] = []): JsonRecord {
  const subject = `acct:${account.user}@${account.host}`;
  const aliases = [account.actorId, ...(account.profileUrl ? [account.profileUrl] : [])];
  const links = [
    selfLink(account.actorId),
    ...(account.profileUrl ? [{ rel: "http://webfinger.net/rel/profile-page", type: "text/html", href: account.profileUrl }] : []),
  ];
  return jrd({ subject, aliases, links }, rels);
}

export async function webfinger(requestUrl: string, resolver: (query: WebFingerQuery) => WebFingerAccount | null | undefined | Promise<WebFingerAccount | null | undefined>): Promise<WebFingerDecision> {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return { status: 400, reason: "unparseable request URL" };
  }
  const resource = url.searchParams.get("resource");
  if (!resource) return { status: 400, reason: "missing required resource parameter" };
  const rels = Object.freeze(url.searchParams.getAll("rel"));
  const account = await resolver({ resource, acct: parseAcct(resource), rels });
  if (!account) return { status: 404, reason: "unknown resource" };
  return { status: 200, jrd: accountJrd(account, rels), mediaType: JRD_MEDIA_TYPE };
}

export function nodeInfoDiscovery(baseUrl: string, documentPath = NODEINFO_2_1_PATH): JsonRecord {
  assertHttpUrl(baseUrl, "baseUrl");
  return {
    links: [
      { rel: NODEINFO_2_1_REL, href: new URL(documentPath, baseUrl).href },
    ],
  };
}

export function nodeInfoDocument(facts: Omit<NodeInfoFacts, "baseUrl" | "documentPath">): JsonRecord {
  return {
    version: "2.1",
    software: {
      name: facts.software.name,
      version: facts.software.version,
      ...(facts.software.repository ? { repository: facts.software.repository } : {}),
      ...(facts.software.homepage ? { homepage: facts.software.homepage } : {}),
    },
    protocols: [...(facts.protocols ?? ["activitypub"])],
    services: {
      inbound: [...(facts.services?.inbound ?? [])],
      outbound: [...(facts.services?.outbound ?? [])],
    },
    openRegistrations: facts.openRegistrations === true,
    usage: {
      users: {
        total: facts.usage?.users?.total ?? 0,
        ...(facts.usage?.users?.activeMonth !== undefined ? { activeMonth: facts.usage.users.activeMonth } : {}),
        ...(facts.usage?.users?.activeHalfyear !== undefined ? { activeHalfyear: facts.usage.users.activeHalfyear } : {}),
      },
      ...(facts.usage?.localPosts !== undefined ? { localPosts: facts.usage.localPosts } : {}),
    },
    metadata: facts.metadata ?? {},
  };
}

export function nodeinfo(requestPath: string, facts: NodeInfoFacts): NodeInfoDecision {
  const documentPath = facts.documentPath ?? NODEINFO_2_1_PATH;
  if (requestPath === NODEINFO_WELL_KNOWN) return { status: 200, body: nodeInfoDiscovery(facts.baseUrl, documentPath) };
  if (requestPath === documentPath) return { status: 200, body: nodeInfoDocument(facts) };
  return { status: 404, reason: "not a NodeInfo path" };
}

export function cellsToObject(subject: string, cells: readonly ActivityCell[]): JsonRecord {
  const fields: JsonRecord = {};
  for (const cell of cells) {
    if (cell.predicate === "type") continue;
    const existing = fields[cell.predicate];
    fields[cell.predicate] = existing === undefined ? cell.object : Array.isArray(existing) ? [...existing, cell.object] : [existing, cell.object];
  }
  const type = cells.find((cell) => cell.predicate === "type")?.object;
  return {
    id: subject,
    type: typeof type === "string" ? type : "Note",
    ...fields,
  };
}

export function objectForAlgebra(subject: string, algebra: ActivityFiniteAlgebra, opts: { attributedTo?: string } = {}): ActivityObject {
  const raw = cellsToObject(subject, algebra.potential ?? []);
  const attributedTo = opts.attributedTo ?? (typeof raw.attributedTo === "string" ? raw.attributedTo : subject);
  if (raw.type === "Article") {
    return articleObject({
      id: subject,
      attributedTo,
      name: String(raw.name ?? ""),
      content: String(raw.content ?? ""),
      ...(typeof raw.summary === "string" ? { summary: raw.summary } : {}),
      ...(typeof raw.url === "string" ? { url: raw.url } : {}),
      ...(typeof raw.published === "string" ? { published: raw.published } : {}),
      ...(typeof raw.updated === "string" ? { updated: raw.updated } : {}),
      ...(raw.tag !== undefined ? { tag: raw.tag } : {}),
    });
  }
  if (raw.type === "Note") {
    return noteObject({
      id: subject,
      attributedTo,
      content: String(raw.content ?? ""),
      ...(typeof raw.summary === "string" ? { summary: raw.summary } : {}),
      ...(typeof raw.url === "string" ? { url: raw.url } : {}),
      ...(typeof raw.published === "string" ? { published: raw.published } : {}),
      ...(raw.tag !== undefined ? { tag: raw.tag } : {}),
    });
  }
  return Object.freeze({
    ...raw,
    attributedTo,
  }) as ActivityObject;
}

export function activityForAlgebra(subject: string, algebra: ActivityFiniteAlgebra, opts: {
  actor: string;
  mintActivityId?: (subject: string) => string;
}): Activity & JsonRecord {
  const object = objectForAlgebra(subject, algebra, { attributedTo: opts.actor });
  const activity = {
    ...createActivity({
    id: opts.mintActivityId?.(subject) ?? `${subject}#create`,
    actor: opts.actor,
    object,
    ...(typeof object.published === "string" ? { published: object.published } : {}),
    to: PUBLIC,
    }),
  } as Activity & JsonRecord;
  const contradictions = algebra.stable ?? [];
  if (contradictions.length > 0) {
    activity._contested = true;
    activity._contradictions = contradictions.map((cell) => ({
      predicate: cell.predicate,
      object: cell.object,
      ...(cell.claimedBy ? { claimedBy: cell.claimedBy } : {}),
      ...(cell.contraryClaimedBy ? { contraryClaimedBy: cell.contraryClaimedBy } : {}),
    }));
  }
  return Object.freeze(activity);
}

export function outboxFromAlgebras(params: {
  id: string;
  actor: string;
  subjects: readonly string[];
  settle: (subject: string) => ActivityFiniteAlgebra;
  mintActivityId?: (subject: string) => string;
}): ActivityCollection<Activity & JsonRecord> {
  const items = params.subjects.map((subject) => {
    const algebra = params.settle(subject);
    const activityOptions = {
      actor: params.actor,
      ...(params.mintActivityId ? { mintActivityId: params.mintActivityId } : {}),
    };
    return { item: activityForAlgebra(subject, algebra, activityOptions), stamp: algebra.t };
  });
  items.sort((a, b) => String(b.stamp ?? "").localeCompare(String(a.stamp ?? "")));
  return orderedCollection(params.id, items.map(({ item }) => item)) as ActivityCollection<Activity & JsonRecord>;
}

function objectId(object: Activity["object"]): string | undefined {
  if (typeof object === "string") return object;
  if (object && typeof object === "object" && "id" in object && typeof object.id === "string") return object.id;
  return undefined;
}

export function isAS2(value: unknown): value is Activity | ActivityObject {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record["type"] === "string"
    && (record["@context"] === undefined
      || record["@context"] === AS2
      || (Array.isArray(record["@context"]) && record["@context"].includes(AS2)));
}

export function subjectOf(activity: Activity): string | null {
  return objectId(activity.object) ?? activity.target ?? null;
}

export function citationOf(activity: Activity): string {
  if (activity.id) return activity.id;
  return `${activity.actor}@${activity.published ?? "unstamped"}`;
}

function objectFields(object: Activity["object"]): Readonly<Record<string, unknown>> {
  if (!object || typeof object === "string") return Object.freeze({});
  if ("object" in object && "type" in object && typeof object.type === "string") return Object.freeze({ activity: object.type, id: object.id });
  const entries = Object.entries(object).filter(([key]) => !["@context", "id"].includes(key));
  return Object.freeze(Object.fromEntries(entries));
}

export function objectToClaims(object: Activity["object"]): Record<string, unknown> {
  if (!object || typeof object === "string") return {};
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => !["@context", "id"].includes(key) && value !== undefined));
}

// Evidence enters only as claims uttered at a subject's cell. There is no
// polarity: a Delete is its own claim of the contrary predicate `deleted`,
// and an Undo is its own claim of the contrary predicate `retracted`, each
// read at its own cell. The citation is provenance carried beside the claim,
// never kernel structure.
export function activityToClaims(activity: Activity): {
  subject: string;
  claims: Record<string, unknown>;
  citation: string;
  activityType: ActivityType;
} | null {
  if (!isAS2(activity)) return null;
  const citation = citationOf(activity);

  if (activity.type === "Follow") {
    const target = objectId(activity.object) ?? activity.target;
    if (!target) return null;
    return { subject: activity.actor, claims: { follows: target }, citation, activityType: activity.type };
  }
  if (activity.type === "Accept") {
    const accepted = objectId(activity.object) ?? activity.target;
    if (!accepted) return null;
    return { subject: activity.actor, claims: { accepted }, citation, activityType: activity.type };
  }
  if (activity.type === "Undo") {
    const inner = activity.object && typeof activity.object === "object" && "type" in activity.object ? activity.object as Activity : null;
    if (!inner) return null;
    const subject = subjectOf(inner);
    if (!subject) return null;
    if (inner.type === "Delete") {
      // Undoing a delete re-utters the object's own claims.
      const innerClaims = objectToClaims(inner.object);
      const claims = Object.keys(innerClaims).length > 0 ? innerClaims : { exists: true };
      return { subject, claims, citation, activityType: activity.type };
    }
    // Undoing anything else claims the contrary predicate `retracted`,
    // naming the activity it retracts.
    return { subject, claims: { retracted: citationOf(inner) }, citation, activityType: activity.type };
  }

  const subject = subjectOf(activity);
  if (!subject) return null;
  const claims = objectToClaims(activity.object);
  if (activity.type === "Create" || activity.type === "Update") {
    return { subject, claims, citation, activityType: activity.type };
  }
  if (activity.type === "Delete") {
    // A delete is its own claim of the contrary predicate `deleted`.
    return { subject, claims: { deleted: true }, citation, activityType: activity.type };
  }
  return null;
}

export function witnessActivity(activity: Activity, ctx: {
  root: string;
  utter: (root: string, subject: string, claims: Record<string, unknown>, opts: { citation: string }) => unknown;
}): {
  applied: boolean;
  subject?: string;
  citation?: string;
  claims?: Record<string, unknown>;
  reason?: string;
} {
  const mapped = activityToClaims(activity);
  if (!mapped) return { applied: false, reason: "untranslatable or malformed activity" };
  ctx.utter(ctx.root, mapped.subject, mapped.claims, { citation: mapped.citation });
  return {
    applied: true,
    subject: mapped.subject,
    citation: mapped.citation,
    claims: mapped.claims,
  };
}

function pushAssertion(assertions: Assertion[], subject: string, predicate: string, object: unknown, t: unknown): void {
  assertions.push(Object.freeze({ e: subject, a: predicate, v: object, t }));
}

export function activityAssertions(activity: Activity, opts: { source?: string; now?: () => string } = {}): AssertionTrace {
  const subject = objectId(activity.object) ?? activity.target ?? activity.id;
  const source = opts.source ?? activity.actor;
  const at = opts.now?.() ?? new Date().toISOString();
  const baseWitness = { by: source, at, activity: activity.id, activityType: activity.type };
  const assertions: Assertion[] = [];
  pushAssertion(assertions, subject, "activity", activity.type, { ...baseWitness, phase: "meta" });
  pushAssertion(assertions, subject, "activity-actor", activity.actor, { ...baseWitness, phase: "meta" });

  if (activity.type === "Delete") {
    pushAssertion(assertions, subject, "deleted", true, { ...baseWitness, phase: "delete" });
    return Object.freeze(assertions);
  }
  if (activity.type === "Undo") {
    const undone = objectId(activity.object) ?? activity.target;
    if (undone) pushAssertion(assertions, subject, "undone-activity", undone, { ...baseWitness, phase: "undo" });
    return Object.freeze(assertions);
  }

  for (const [predicate, object] of Object.entries(objectFields(activity.object))) {
    pushAssertion(assertions, subject, predicate, object, { ...baseWitness, phase: activity.type.toLowerCase() });
  }
  if (activity.target) pushAssertion(assertions, subject, "target", activity.target, { ...baseWitness, phase: "target" });
  return Object.freeze(assertions);
}

export function orderedCollection<T>(id: string, items: readonly T[], opts: { page?: boolean; pageSize?: number } = {}): ActivityCollection<T> | ActivityCollectionPage<T> {
  assertHttpUrl(id, "collection.id");
  const pageSize = opts.pageSize ?? 20;
  if (opts.page) {
    const orderedItems = Object.freeze([...items].slice(0, pageSize));
    const page: {
      "@context": "https://www.w3.org/ns/activitystreams";
      id: string;
      type: "OrderedCollectionPage";
      partOf: string;
      totalItems: number;
      orderedItems: readonly T[];
      next?: string;
    } = {
      "@context": AS2,
      id: `${id}?page=true`,
      type: "OrderedCollectionPage",
      partOf: id,
      totalItems: items.length,
      orderedItems,
    };
    if (items.length > pageSize) page.next = `${id}?page=true&after=${encodeURIComponent(String(pageSize))}`;
    return Object.freeze(page);
  }
  return Object.freeze({
    "@context": AS2,
    id,
    type: "OrderedCollection",
    totalItems: items.length,
    first: `${id}?page=true`,
  });
}

function repr(status: number, body: unknown, type = ACTIVITY_JSON, headers: Record<string, string> = {}): Repr {
  return jsonRepr(body, { status, type, headers, cacheControl: { noStore: status >= 400 }, pretty: true });
}

function parseActivityBody(body: string): Activity {
  const parsed = JSON.parse(body || "{}") as Activity;
  if (!parsed.id || !parsed.type || !parsed.actor) throw new TypeError("activity requires id, type, and actor");
  return parsed;
}

async function readActivity(req: Parameters<NonNullable<App["resources"]>[number]["handler"]>[0]["req"], maxBodyBytes: number): Promise<Activity> {
  return parseActivityBody(await readTextBody(req, { maxBytes: maxBodyBytes }));
}

async function authorizeActivityRequest(
  input: HttpSignatureInput,
  options: Pick<ActivityPubAppOptions, "tokens" | "httpSignatures">,
): Promise<AuthDecision> {
  const bearer = authorizeBearer(input.headers as IncomingHttpHeaders, options.tokens);
  if (bearer.ok || !options.httpSignatures) return bearer;
  const parsed = parseSignatureHeader(headerValue(input.headers, "signature"));
  if (!parsed) return options.httpSignatures.required ? { ok: false, status: 401, reason: "missing HTTP Signature" } : bearer;
  const publicKey = await options.httpSignatures.publicKeyFor(parsed.keyId);
  if (!publicKey) return { ok: false, status: 403, reason: "unknown HTTP Signature keyId" };
  const verified = verifyHttpSignature(input, publicKey);
  if (!verified) return { ok: false, status: 403, reason: "invalid HTTP Signature" };
  return { ok: true, status: 200, source: verified.keyId };
}

export function activityPubApp(options: ActivityPubAppOptions): App {
  const paths = {
    actor: "/actor",
    inbox: "/inbox",
    outbox: "/outbox",
    nodeInfo: NODEINFO_2_1_PATH,
    ...(options.paths ?? {}),
  };
  const maxBodyBytes = options.maxBodyBytes ?? 262_144;
  const pageSize = options.pageSize ?? 20;
  const resources: NonNullable<App["resources"]> = [
    ...(options.webfinger ? [{
      id: "activitypub.webfinger",
      name: "ActivityPub WebFinger",
      route: WEBFINGER_PATH,
      match: WEBFINGER_PATH,
      methods: ["GET"],
      produces: [JRD_MEDIA_TYPE, "application/json"],
      handler: async (ctx) => {
        const decision = await webfinger(ctx.url.href, options.webfinger!);
        return repr(decision.status, decision.jrd ?? { error: decision.reason }, decision.mediaType ? `${decision.mediaType}; charset=utf-8` : "application/json; charset=utf-8");
      },
    }] satisfies NonNullable<App["resources"]> : []),
    ...(options.nodeInfo ? [
      {
        id: "activitypub.nodeinfo.well-known",
        name: "ActivityPub NodeInfo Discovery",
        route: NODEINFO_WELL_KNOWN,
        match: NODEINFO_WELL_KNOWN,
        methods: ["GET"],
        produces: ["application/json"],
        handler: async (ctx) => {
          const facts = { ...options.nodeInfo!, documentPath: paths.nodeInfo };
          const decision = nodeinfo(ctx.url.pathname, facts);
          return repr(decision.status, decision.body ?? { error: decision.reason }, "application/json; charset=utf-8");
        },
      },
      {
        id: "activitypub.nodeinfo.document",
        name: "ActivityPub NodeInfo Document",
        route: paths.nodeInfo,
        match: paths.nodeInfo,
        methods: ["GET"],
        produces: ["application/json"],
        handler: async (ctx) => {
          const facts = { ...options.nodeInfo!, documentPath: paths.nodeInfo };
          const decision = nodeinfo(ctx.url.pathname, facts);
          return repr(decision.status, decision.body ?? { error: decision.reason }, "application/json; charset=utf-8");
        },
      },
    ] satisfies NonNullable<App["resources"]> : []),
      {
        id: "activitypub.actor",
        name: "ActivityPub Actor",
        route: paths.actor,
        match: paths.actor,
        methods: ["GET"],
        produces: ["application/activity+json", "application/ld+json", "application/json"],
        handler: async () => repr(200, actorDocument(await options.store.actor())),
      },
      {
        id: "activitypub.inbox",
        name: "ActivityPub Inbox",
        route: paths.inbox,
        match: paths.inbox,
        methods: ["GET", "POST"],
        produces: ["application/activity+json", "application/ld+json", "application/json"],
        handler: async (ctx) => {
          if (ctx.req.method === "GET") {
            const actor = await options.store.actor();
            const items = await options.store.inboxItems?.();
            return repr(200, orderedCollection(new URL(paths.inbox, actor.id).href, items ?? [], { page: ctx.url.searchParams.get("page") === "true", pageSize }));
          }
          const body = await readTextBody(ctx.req, { maxBytes: maxBodyBytes });
          const auth = await authorizeActivityRequest({
            method: ctx.req.method ?? "POST",
            url: ctx.url.href,
            headers: ctx.req.headers,
            body,
          }, options);
          if (!auth.ok) {
            return repr(auth.status, { error: auth.reason }, "application/json; charset=utf-8", auth.status === 401 ? { "WWW-Authenticate": "Bearer" } : {});
          }
          const activity = parseActivityBody(body);
          const result = await options.store.inbox?.(activity, auth) ?? { accepted: true, assertions: activityAssertions(activity, auth.source ? { source: auth.source } : {}) };
          return repr(result.accepted ? 202 : 400, { accepted: result.accepted, id: result.id ?? activity.id, assertionCount: result.assertions?.length }, "application/json; charset=utf-8");
        },
      },
      {
        id: "activitypub.outbox",
        name: "ActivityPub Outbox",
        route: paths.outbox,
        match: paths.outbox,
        methods: ["GET", "POST"],
        produces: ["application/activity+json", "application/ld+json", "application/json"],
        handler: async (ctx) => {
          if (ctx.req.method === "GET") {
            const actor = await options.store.actor();
            const items = await options.store.outboxItems?.();
            return repr(200, orderedCollection(new URL(paths.outbox, actor.id).href, items ?? [], { page: ctx.url.searchParams.get("page") === "true", pageSize }));
          }
          const body = await readTextBody(ctx.req, { maxBytes: maxBodyBytes });
          const auth = await authorizeActivityRequest({
            method: ctx.req.method ?? "POST",
            url: ctx.url.href,
            headers: ctx.req.headers,
            body,
          }, options);
          if (!auth.ok) {
            return repr(auth.status, { error: auth.reason }, "application/json; charset=utf-8", auth.status === 401 ? { "WWW-Authenticate": "Bearer" } : {});
          }
          const activity = parseActivityBody(body);
          const result = await options.store.outbox?.(activity, auth) ?? { accepted: true, assertions: activityAssertions(activity, auth.source ? { source: auth.source } : {}) };
          return repr(result.accepted ? 201 : 400, { accepted: result.accepted, id: result.id ?? activity.id, assertionCount: result.assertions?.length }, "application/json; charset=utf-8", result.accepted ? { Location: result.id ?? activity.id } : {});
        },
      },
    ];
  return {
    resources,
  };
}
