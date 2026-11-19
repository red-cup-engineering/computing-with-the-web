import { jsonRepr, readFormBody, readJsonBody, readMultipartBody, type App, type Repr } from "@red-cup-engineering/computing-with-http/app";
import type { MultipartPart } from "@red-cup-engineering/computing-with-http/codecs/multipart";
import { parseContentType } from "@red-cup-engineering/computing-with-http/codecs/http";
import type { Assertion, AssertionTrace } from "../sync-guard/wire.mjs";
import {
  authorizeBearer,
  bearerToken,
  type AuthDecision,
  type TokenPolicy,
} from "../sync-guard/index.mjs";

export type MicropubAction = "create" | "update" | "delete" | "undelete";

export type MicropubCommand = Readonly<{
  action: MicropubAction;
  url?: string;
  type: readonly string[];
  properties: Readonly<Record<string, readonly unknown[]>>;
  replace: Readonly<Record<string, readonly unknown[]>>;
  add: Readonly<Record<string, readonly unknown[]>>;
  delete: Readonly<Record<string, readonly unknown[] | true>>;
}>;

export type MicropubConfig = Readonly<{
  "media-endpoint"?: string;
  "syndicate-to"?: readonly MicropubSyndicationTarget[];
  "post-types"?: readonly MicropubPostType[];
}>;

export type MicropubSyndicationTarget = Readonly<{
  uid: string;
  name: string;
  service?: string;
}>;

export type MicropubPostType = Readonly<{
  type: string;
  name: string;
  properties?: readonly string[];
}>;

export type MicropubWriteResult = Readonly<{
  url?: string;
  assertions?: AssertionTrace;
}>;

export type MicropubWriter = (command: MicropubCommand, auth: AuthDecision) => MicropubWriteResult | Promise<MicropubWriteResult>;

export type MicropubMediaInput = Readonly<{
  field: string;
  filename?: string;
  contentType?: string;
  data: Buffer;
  fields: URLSearchParams;
  part: MultipartPart;
}>;

export type MicropubMediaResult = Readonly<{
  url: string;
  assertions?: AssertionTrace;
}>;

export type MicropubMediaWriter = (input: MicropubMediaInput, auth: AuthDecision) => MicropubMediaResult | Promise<MicropubMediaResult>;

export type MicropubTokenClaims = Readonly<{
  me?: string;
  client_id?: string;
  scope?: string | readonly string[];
  [claim: string]: unknown;
}>;

export type MicropubTokenVerifier = (token: string) => MicropubTokenClaims | null | false | undefined | Promise<MicropubTokenClaims | null | false | undefined>;

export type MicropubAuthorization =
  | Readonly<{ ok: true; token: string; claims: MicropubTokenClaims; source?: string }>
  | Readonly<{ ok: false; status: 400 | 401 | 403; error: string; description?: string; token?: string }>;

export type ClaimCell = Readonly<{
  predicate: string;
  object: unknown;
}>;

export type ClaimWrite = Readonly<{
  op: "affirm" | "deny";
  predicate: string;
  object: unknown;
}>;

export type MicropubSource = Readonly<{
  type: readonly string[];
  properties: Readonly<Record<string, readonly unknown[]>>;
}>;

export type MicropubSourceReader = (url: string, auth: AuthDecision) => MicropubSource | null | undefined | Promise<MicropubSource | null | undefined>;

export type MicropubAppOptions = Readonly<{
  write: MicropubWriter;
  source?: MicropubSourceReader;
  media?: MicropubMediaWriter;
  path?: string;
  mediaPath?: string;
  tokens?: TokenPolicy;
  verifyToken?: MicropubTokenVerifier;
  config?: MicropubConfig;
  maxBodyBytes?: number;
  maxMediaBytes?: number;
}>;

const DEFAULT_TYPE = Object.freeze(["h-entry"]);

export const REQUIRED_SCOPE = Object.freeze({
  create: Object.freeze(["create", "post"]),
  update: Object.freeze(["update"]),
  delete: Object.freeze(["delete"]),
  undelete: Object.freeze(["delete"]),
} satisfies Record<MicropubAction, readonly string[]>);

export const MEDIA_SCOPE = Object.freeze(["create", "media"]);
const CONTENT_PROPERTY_DENYLIST = new Set(["access_token"]);

function toArray(value: unknown): readonly unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? Object.freeze([...value]) : Object.freeze([value]);
}

function propertyBag(input: unknown): Readonly<Record<string, readonly unknown[]>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return Object.freeze({});
  const out: Record<string, readonly unknown[]> = {};
  for (const [key, value] of Object.entries(input)) out[key] = toArray(value);
  return Object.freeze(out);
}

function deleteBag(input: unknown): Readonly<Record<string, readonly unknown[] | true>> {
  if (Array.isArray(input)) {
    const out: Record<string, true> = {};
    for (const item of input) if (typeof item === "string" && item) out[item] = true;
    return Object.freeze(out);
  }
  if (!input || typeof input !== "object") return Object.freeze({});
  const out: Record<string, readonly unknown[] | true> = {};
  for (const [key, value] of Object.entries(input)) out[key] = value === null ? true : toArray(value);
  return Object.freeze(out);
}

function strings(value: readonly unknown[] | undefined): readonly string[] {
  return Object.freeze((value ?? []).filter((item): item is string => typeof item === "string" && item.length > 0));
}

function firstString(value: readonly unknown[] | undefined): string | undefined {
  return strings(value)[0];
}

function headerValue(headers: Record<string, string | string[] | undefined> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

function normalizeAction(value: string | undefined): MicropubAction {
  if (value === "update" || value === "delete" || value === "undelete") return value;
  return "create";
}

export function parseMicropubJson(input: unknown): MicropubCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Micropub JSON body must be an object");
  const body = input as Record<string, unknown>;
  const properties = propertyBag(body.properties);
  const replace = propertyBag(body.replace);
  const add = propertyBag(body.add);
  const deleted = deleteBag(body.delete);
  const action = normalizeAction(typeof body.action === "string" ? body.action : undefined);
  const url = typeof body.url === "string" && body.url ? body.url : undefined;
  const type = strings(toArray(body.type));
  return Object.freeze({
    action,
    ...(url ? { url } : {}),
    type: type.length ? type : DEFAULT_TYPE,
    properties,
    replace,
    add,
    delete: deleted,
  });
}

function appendFormValue(out: Record<string, unknown[]>, key: string, value: unknown): void {
  out[key] = [...(out[key] ?? []), value];
}

export function parseMicropubForm(form: URLSearchParams): MicropubCommand {
  const properties: Record<string, unknown[]> = {};
  const replace: Record<string, unknown[]> = {};
  const add: Record<string, unknown[]> = {};
  const deleted: Record<string, readonly unknown[] | true> = {};
  let action: MicropubAction = "create";
  let url: string | undefined;
  const type: string[] = [];

  for (const [key, value] of form) {
    if (key === "action") action = normalizeAction(value);
    else if (key === "url" && value) url = value;
    else if (key === "h") type.push(`h-${value}`);
    else if (key.startsWith("replace[")) appendFormValue(replace, key.slice(8, -1), value);
    else if (key.startsWith("add[")) appendFormValue(add, key.slice(4, -1), value);
    else if (key.startsWith("delete[")) appendFormValue(deleted as Record<string, unknown[]>, key.slice(7, -1), value);
    else if (key === "delete") deleted[value] = true;
    else if (key === "access_token") continue;
    else appendFormValue(properties, key, value);
  }

  return Object.freeze({
    action,
    ...(url ? { url } : {}),
    type: Object.freeze(type.length ? type : [...DEFAULT_TYPE]),
    properties: propertyBag(properties),
    replace: propertyBag(replace),
    add: propertyBag(add),
    delete: Object.freeze(deleted),
  });
}

export function scopeSet(scope: string | readonly string[] | null | undefined): ReadonlySet<string> {
  if (Array.isArray(scope)) return new Set(scope.filter(Boolean));
  if (typeof scope !== "string") return new Set();
  return new Set(scope.split(/\s+/).filter(Boolean));
}

export function scopeAllows(action: MicropubAction, scope: string | readonly string[] | null | undefined): boolean {
  const granted = scopeSet(scope);
  return REQUIRED_SCOPE[action].some((required) => granted.has(required));
}

export function scopeAllowsMedia(scope: string | readonly string[] | null | undefined): boolean {
  const granted = scopeSet(scope);
  return MEDIA_SCOPE.some((required) => granted.has(required));
}

export function extractAccessToken(input: {
  headers?: Record<string, string | string[] | undefined>;
  form?: URLSearchParams;
}): string | null {
  const authorization = headerValue(input.headers, "authorization");
  const fromHeader = bearerToken({ authorization }) ?? null;
  const fromForm = input.form?.get("access_token") || null;
  if (fromHeader && fromForm) {
    throw new TypeError("Micropub access token supplied by more than one method");
  }
  return fromHeader ?? fromForm;
}

export async function authorizeMicropubAction(
  action: MicropubAction,
  input: { headers?: Record<string, string | string[] | undefined>; form?: URLSearchParams },
  verify: MicropubTokenVerifier,
): Promise<MicropubAuthorization> {
  let token: string | null;
  try {
    token = extractAccessToken(input);
  } catch (error) {
    return {
      ok: false,
      status: 400,
      error: "invalid_request",
      description: error instanceof Error ? error.message : String(error),
    };
  }
  if (!token) return { ok: false, status: 401, error: "unauthorized", description: "no bearer token" };
  let claims: MicropubTokenClaims | null | false | undefined;
  try {
    claims = await verify(token);
  } catch {
    claims = null;
  }
  if (!claims) return { ok: false, status: 403, error: "invalid_token", description: "token verification failed", token };
  if (!scopeAllows(action, claims.scope)) {
    return {
      ok: false,
      status: 403,
      error: "insufficient_scope",
      description: `action "${action}" requires scope ${REQUIRED_SCOPE[action].join(" or ")}`,
      token,
    };
  }
  const source = typeof claims.me === "string" && claims.me ? claims.me : typeof claims.client_id === "string" && claims.client_id ? claims.client_id : undefined;
  return {
    ok: true,
    token,
    claims,
    ...(source ? { source } : {}),
  };
}

export async function authorizeMicropubMedia(
  input: { headers?: Record<string, string | string[] | undefined>; form?: URLSearchParams },
  verify: MicropubTokenVerifier,
): Promise<MicropubAuthorization> {
  let token: string | null;
  try {
    token = extractAccessToken(input);
  } catch (error) {
    return {
      ok: false,
      status: 400,
      error: "invalid_request",
      description: error instanceof Error ? error.message : String(error),
    };
  }
  if (!token) return { ok: false, status: 401, error: "unauthorized", description: "no bearer token" };
  let claims: MicropubTokenClaims | null | false | undefined;
  try {
    claims = await verify(token);
  } catch {
    claims = null;
  }
  if (!claims) return { ok: false, status: 403, error: "invalid_token", description: "token verification failed", token };
  if (!scopeAllowsMedia(claims.scope)) {
    return {
      ok: false,
      status: 403,
      error: "insufficient_scope",
      description: `media endpoint requires scope ${MEDIA_SCOPE.join(" or ")}`,
      token,
    };
  }
  const source = typeof claims.me === "string" && claims.me ? claims.me : typeof claims.client_id === "string" && claims.client_id ? claims.client_id : undefined;
  return {
    ok: true,
    token,
    claims,
    ...(source ? { source } : {}),
  };
}

export function cellsFromProperties(properties: Readonly<Record<string, readonly unknown[]>>): readonly ClaimCell[] {
  const cells: ClaimCell[] = [];
  for (const [predicate, values] of Object.entries(properties)) {
    if (CONTENT_PROPERTY_DENYLIST.has(predicate)) continue;
    for (const object of values) cells.push(Object.freeze({ predicate, object }));
  }
  return Object.freeze(cells);
}

export function cellsForCreate(command: MicropubCommand): readonly ClaimCell[] {
  return Object.freeze([
    ...command.type.map((object) => Object.freeze({ predicate: "type", object })),
    ...cellsFromProperties(command.properties),
  ]);
}

export function planUpdate(command: MicropubCommand, currentObjects: (subject: string, predicate: string) => readonly unknown[]): readonly ClaimWrite[] {
  if (command.action !== "update") throw new TypeError("planUpdate requires an update command");
  if (!command.url) throw new TypeError("planUpdate requires command.url");
  const writes: ClaimWrite[] = [];
  for (const [predicate, values] of Object.entries(command.replace)) {
    for (const object of currentObjects(command.url, predicate)) writes.push(Object.freeze({ op: "deny", predicate, object }));
    for (const object of values) writes.push(Object.freeze({ op: "affirm", predicate, object }));
  }
  for (const [predicate, values] of Object.entries(command.add)) {
    for (const object of values) writes.push(Object.freeze({ op: "affirm", predicate, object }));
  }
  for (const [predicate, values] of Object.entries(command.delete)) {
    if (values === true) {
      for (const object of currentObjects(command.url, predicate)) writes.push(Object.freeze({ op: "deny", predicate, object }));
    } else {
      for (const object of values) writes.push(Object.freeze({ op: "deny", predicate, object }));
    }
  }
  return Object.freeze(writes);
}

export function planDelete(currentCells: readonly ClaimCell[]): readonly ClaimWrite[] {
  return Object.freeze(currentCells.map(({ predicate, object }) => Object.freeze({ op: "deny" as const, predicate, object })));
}

export function planUndelete(cells: readonly ClaimCell[]): readonly ClaimWrite[] {
  return Object.freeze(cells.map(({ predicate, object }) => Object.freeze({ op: "affirm" as const, predicate, object })));
}

export function commandAssertions(command: MicropubCommand, opts: { subject?: string; source?: string; now?: () => string } = {}): AssertionTrace {
  const subject = opts.subject ?? command.url ?? firstString(command.properties.uid) ?? firstString(command.properties.slug);
  if (!subject) throw new TypeError("Micropub command needs a subject URL, uid, or slug");
  const now = opts.now ?? (() => new Date().toISOString());
  const t = { by: opts.source ?? "micropub", at: now(), action: command.action };
  const assertions: Assertion[] = [];
  const push = (predicate: string, object: unknown, phase = "set") => {
    assertions.push(Object.freeze({ e: subject, a: predicate, v: object, t: { ...t, phase } }));
  };

  push("micropub-action", command.action, "meta");
  for (const value of command.type) push("type", value, "meta");
  for (const [predicate, values] of Object.entries(command.properties)) {
    if (CONTENT_PROPERTY_DENYLIST.has(predicate)) continue;
    for (const value of values) push(predicate, value);
  }
  for (const [predicate, values] of Object.entries(command.replace)) for (const value of values) push(predicate, value, "replace");
  for (const [predicate, values] of Object.entries(command.add)) for (const value of values) push(predicate, value, "add");
  for (const [predicate, values] of Object.entries(command.delete)) {
    if (values === true) push(predicate, { not: "*" }, "delete");
    else for (const value of values) push(predicate, { not: value }, "delete");
  }
  return Object.freeze(assertions);
}

export function mediaAssertions(input: MicropubMediaInput, result: MicropubMediaResult, opts: { source?: string; now?: () => string } = {}): AssertionTrace {
  const now = opts.now ?? (() => new Date().toISOString());
  const t = { by: opts.source ?? "micropub-media", at: now(), action: "media" };
  const assertions: Assertion[] = [];
  const push = (predicate: string, object: unknown, phase = "set") => {
    assertions.push(Object.freeze({ e: result.url, a: predicate, v: object, t: { ...t, phase } }));
  };
  push("micropub-media", true, "meta");
  push("field", input.field, "meta");
  push("byte-length", input.data.length, "meta");
  if (input.filename) push("filename", input.filename, "meta");
  if (input.contentType) push("content-type", input.contentType, "meta");
  for (const [key, value] of input.fields) {
    if (key !== "access_token") push(key, value);
  }
  return Object.freeze(assertions);
}

function repr(status: number, body: unknown, headers: Record<string, string> = {}): Repr {
  return jsonRepr(body, { status, headers, pretty: true, cacheControl: { noStore: true } });
}

function configResponse(config: MicropubConfig = {}): MicropubConfig {
  return Object.freeze({
    "post-types": Object.freeze([
      { type: "note", name: "Note", properties: ["content", "category"] },
      { type: "article", name: "Article", properties: ["name", "content", "category"] },
      ...(config["post-types"] ?? []),
    ]),
    ...(config["media-endpoint"] ? { "media-endpoint": config["media-endpoint"] } : {}),
    ...(config["syndicate-to"] ? { "syndicate-to": config["syndicate-to"] } : {}),
  });
}

function sourceResponse(source: MicropubSource, requestedProperties: readonly string[]): MicropubSource {
  if (requestedProperties.length === 0) return source;
  const properties: Record<string, readonly unknown[]> = {};
  for (const property of requestedProperties) {
    if (source.properties[property] !== undefined) properties[property] = source.properties[property]!;
  }
  return Object.freeze({
    type: source.type,
    properties: Object.freeze(properties),
  });
}

function requestedSourceProperties(params: URLSearchParams): readonly string[] {
  return Object.freeze([
    ...params.getAll("properties[]"),
    ...params.getAll("properties"),
    ...params.getAll("property"),
  ].filter(Boolean).sort());
}

async function readCommand(ctx: Parameters<NonNullable<App["resources"]>[number]["handler"]>[0], maxBodyBytes: number): Promise<MicropubCommand> {
  const type = parseContentType(ctx.req.headers["content-type"]);
  if (type?.type === "application/json") return parseMicropubJson(await readJsonBody(ctx.req, { maxBytes: maxBodyBytes, empty: {} }));
  return parseMicropubForm(await readFormBody(ctx.req, { maxBytes: maxBodyBytes }));
}

async function readCommandBody(ctx: Parameters<NonNullable<App["resources"]>[number]["handler"]>[0], maxBodyBytes: number): Promise<{
  command: MicropubCommand;
  form?: URLSearchParams;
}> {
  const type = parseContentType(ctx.req.headers["content-type"]);
  if (type?.type === "application/json") {
    return { command: parseMicropubJson(await readJsonBody(ctx.req, { maxBytes: maxBodyBytes, empty: {} })) };
  }
  const form = await readFormBody(ctx.req, { maxBytes: maxBodyBytes });
  return { command: parseMicropubForm(form), form };
}

function authDecisionFromMicropub(auth: Extract<MicropubAuthorization, { ok: true }>): AuthDecision {
  return {
    ok: true,
    status: 200,
    token: auth.token,
    ...(auth.source ? { source: auth.source } : {}),
  };
}

async function readMediaInput(ctx: Parameters<NonNullable<App["resources"]>[number]["handler"]>[0], maxMediaBytes: number): Promise<MicropubMediaInput> {
  const form = await readMultipartBody(ctx.req, { maxBytes: maxMediaBytes });
  const part = form.file("file") ?? form.files[0];
  if (!part) throw new TypeError("Micropub media endpoint requires a multipart file field");
  return Object.freeze({
    field: part.name,
    ...(part.filename !== undefined ? { filename: part.filename } : {}),
    ...(part.contentType !== undefined ? { contentType: part.contentType } : {}),
    data: part.data,
    fields: form.fields,
    part,
  });
}

export function micropubApp(options: MicropubAppOptions): App {
  const path = options.path ?? "/micropub";
  const mediaPath = options.mediaPath ?? "/micropub/media";
  const maxBodyBytes = options.maxBodyBytes ?? 262_144;
  const maxMediaBytes = options.maxMediaBytes ?? 10_485_760;
  const media = options.media;
  return {
    resources: [
      {
        id: "micropub.endpoint",
        name: "Micropub Endpoint",
        route: path,
        match: path,
        methods: ["GET", "POST"],
        produces: ["application/json"],
        handler: async (ctx) => {
          if (ctx.req.method === "GET") {
            const query = ctx.url.searchParams.get("q");
            if (query === "config") {
              return repr(200, configResponse(options.config));
            }
            if (query === "syndicate-to") {
              return repr(200, { "syndicate-to": options.config?.["syndicate-to"] ?? [] });
            }
            if (query === "source") {
              const auth = authorizeBearer(ctx.req.headers, options.tokens);
              if (!auth.ok) {
                return repr(auth.status, { error: auth.reason }, auth.status === 401 ? { "WWW-Authenticate": "Bearer" } : {});
              }
              if (!options.source) {
                return repr(501, { error: "source query is not configured" });
              }
              const url = ctx.url.searchParams.get("url");
              if (!url) {
                return repr(400, { error: "url is required" });
              }
              const source = await options.source(url, auth);
              if (!source) {
                return repr(404, { error: "source not found" });
              }
              return repr(200, sourceResponse(source, requestedSourceProperties(ctx.url.searchParams)));
            }
            return repr(400, { error: "unsupported_query" });
          }

          const parsed = await readCommandBody(ctx, maxBodyBytes);
          let auth: AuthDecision;
          if (options.verifyToken) {
            const scoped = await authorizeMicropubAction(parsed.command.action, {
              headers: ctx.req.headers,
              ...(parsed.form ? { form: parsed.form } : {}),
            }, options.verifyToken);
            if (!scoped.ok) {
              return repr(scoped.status, {
                error: scoped.error,
                ...(scoped.description ? { error_description: scoped.description } : {}),
              }, scoped.status === 401 ? { "WWW-Authenticate": "Bearer" } : {});
            }
            auth = authDecisionFromMicropub(scoped);
          } else {
            auth = authorizeBearer(ctx.req.headers, options.tokens);
          }
          if (!auth.ok) {
            return repr(auth.status, { error: auth.reason }, auth.status === 401 ? { "WWW-Authenticate": "Bearer" } : {});
          }
          const command = parsed.command;
          const result = await options.write(command, auth);
          const location = result.url ?? command.url;
          const status = command.action === "create" ? 201 : 200;
          return repr(status, {
            action: command.action,
            url: location,
            assertionCount: result.assertions?.length,
          }, location ? { Location: location } : {});
        },
      },
      ...(media ? [{
        id: "micropub.media",
        name: "Micropub Media",
        route: mediaPath,
        match: mediaPath,
        methods: ["POST"],
        produces: ["application/json"],
        handler: async (ctx) => {
          let input: MicropubMediaInput;
          try {
            input = await readMediaInput(ctx, maxMediaBytes);
          } catch (error) {
            return repr(error instanceof RangeError ? 413 : 400, { error: error instanceof Error ? error.message : String(error) });
          }

          let auth: AuthDecision;
          if (options.verifyToken) {
            const scoped = await authorizeMicropubMedia({
              headers: ctx.req.headers,
              form: input.fields,
            }, options.verifyToken);
            if (!scoped.ok) {
              return repr(scoped.status, {
                error: scoped.error,
                ...(scoped.description ? { error_description: scoped.description } : {}),
              }, scoped.status === 401 ? { "WWW-Authenticate": "Bearer" } : {});
            }
            auth = authDecisionFromMicropub(scoped);
          } else {
            auth = authorizeBearer(ctx.req.headers, options.tokens);
          }
          if (!auth.ok) {
            return repr(auth.status, { error: auth.reason }, auth.status === 401 ? { "WWW-Authenticate": "Bearer" } : {});
          }

          const result = await media(input, auth);
          return repr(201, {
            url: result.url,
            assertionCount: result.assertions?.length,
          }, { Location: result.url });
        },
      } satisfies NonNullable<App["resources"]>[number]] : []),
    ],
  };
}
