import { randomBytes } from "node:crypto";

import { serializeSetCookie, signCookieValue, type CookieOptions } from "@red-cup-engineering/computing-with-http/codecs/cookie";
import { parseSseStream, sseHeaders } from "@red-cup-engineering/computing-with-http/codecs/sse";
import {
  createProjectedEventHub,
  readJsonBody,
  type App,
  type Context,
  type Repr,
  writeSseComment,
  writeSseEvent,
  type SseSink,
  type TopicEvent,
} from "@red-cup-engineering/computing-with-http/app";
import { getSignedCookie } from "@red-cup-engineering/http-server";

export type SessionLogin = Readonly<{
  name: string;
  secret?: string;
}>;

export type SessionIdentity = Readonly<{
  session: string;
}>;

export type SessionInput = Readonly<{
  session: string;
  line: string;
}>;

export type StreamSeed = Readonly<{
  out?: string | readonly string[];
  state?: unknown;
}>;

export type WebSessionCarrierOptions = Readonly<{
  login(login: SessionLogin): SessionIdentity | Promise<SessionIdentity>;
  enqueue(input: SessionInput): void | Promise<void>;
  streamSeed?: (session: string) => StreamSeed | Promise<StreamSeed>;
  snapshot?: (session: string) => unknown | Promise<unknown>;
  paths?: Partial<WebSessionCarrierPaths>;
  sessionCookie?: false | WebSessionCookieOptions;
  maxBodyBytes?: number;
}>;

export type WebSessionCookieOptions = Readonly<{
  secret: string;
  name?: string;
  cookie?: CookieOptions;
}>;

export type WebSessionCarrierPaths = Readonly<{
  session: string;
  input: string;
  stream: string;
  events: string;
}>;

export type EmitOutputOptions = Readonly<{
  state?: unknown;
  refreshState?: boolean;
}>;

export type WebSessionCarrier = Readonly<{
  app: App;
  sessionOf(token: string): string | undefined;
  revoke(token: string): boolean;
  emitOutput(session: string, lines: string | readonly string[], opts?: EmitOutputOptions): Promise<number>;
  emitState(session: string, state?: unknown): Promise<number>;
  publishEvents(events: TopicEvent | readonly TopicEvent[]): void;
  subscribers(session?: string): number;
}>;

export type SessionInputValidator<Input, Intent extends object> = (input: Input) => Intent | null | undefined;

export type SessionInputQueue<Input, Intent extends object> = Readonly<{
  push(input: Input): Intent | null;
  drain(): Intent[];
  peek(): Intent[];
  size(): number;
}>;

export type QueuedWebSessionCarrier<Intent extends object = SessionInput> =
  WebSessionCarrier & Readonly<{
    queue: SessionInputQueue<SessionInput, Intent>;
    drainInput(): Intent[];
    pendingInput(): Intent[];
  }>;

export type WebSessionRequestInit = Readonly<{
  method: "GET" | "POST";
  headers?: Readonly<Record<string, string>>;
  body?: string;
}>;

export type WebSessionFetchResponse = Readonly<{
  ok?: boolean;
  status: number;
  json(): Promise<unknown>;
  text?(): Promise<string>;
}>;

export type WebSessionFetch = (url: string, init: WebSessionRequestInit) => Promise<WebSessionFetchResponse>;

export type WebSessionEvent = Readonly<{
  event: string;
  data: string;
  id?: string;
  retry?: number;
}>;

export type WebSessionEventSource = {
  close(): void;
  addEventListener?(type: string, listener: (event: { type: string; data: string }) => void): void;
  removeEventListener?(type: string, listener: (event: { type: string; data: string }) => void): void;
  onmessage?: ((event: { type: string; data: string }) => void) | null;
  onopen?: ((event?: unknown) => void) | null;
  onerror?: ((event?: unknown) => void) | null;
};

export type WebSessionEventSourceFactory = (url: string) => WebSessionEventSource;

export type WebSessionClientOptions = Readonly<{
  fetch: WebSessionFetch;
  eventSource?: WebSessionEventSourceFactory;
  paths?: Partial<WebSessionCarrierPaths>;
}>;

export type WebSessionClient = Readonly<{
  login(login: SessionLogin): Promise<SessionIdentity & { token: string }>;
  input(token: string, line: string): Promise<boolean>;
  stream(token: string, handlers?: Partial<WebSessionStreamHandlers>): WebSessionEventSource;
  events(topics?: string | readonly string[], handler?: (event: WebSessionEvent, payload: unknown) => void): WebSessionEventSource;
}>;

export type WebSessionStreamHandlers = Readonly<{
  out(line: string): void;
  sense(line: string): void;
  state(state: unknown): void;
  event(event: WebSessionEvent, payload: unknown): void;
  open(): void;
  error(error?: unknown): void;
}>;

type StreamSub = {
  session: string;
  sink: SseSink;
};

type JsonObject = Record<string, unknown>;

const DEFAULT_PATHS: WebSessionCarrierPaths = {
  session: "/session",
  input: "/input",
  stream: "/stream",
  events: "/events",
};

export function createWebSessionCarrier(opts: WebSessionCarrierOptions): WebSessionCarrier {
  const paths = { ...DEFAULT_PATHS, ...(opts.paths ?? {}) };
  const maxBodyBytes = opts.maxBodyBytes ?? 64 * 1024;
  const sessionCookie = normalizeSessionCookie(opts.sessionCookie);
  const tokens = new Map<string, string>();
  const streams = new Set<StreamSub>();
  const eventHub = createProjectedEventHub();

  const requireToken = (token: unknown): string | null => {
    if (typeof token !== "string" || !token) return null;
    return tokens.get(token) ?? null;
  };
  const requireRequestToken = (ctx: Context, token: unknown): string | null => {
    const explicit = requireToken(token);
    if (explicit) return explicit;
    if (!sessionCookie) return null;
    return requireToken(getSignedCookie(ctx.req, sessionCookie.name, sessionCookie.secret));
  };

  const emitState = async (session: string, state?: unknown): Promise<number> => {
    const value = state === undefined ? await opts.snapshot?.(session) : state;
    if (value === undefined) return 0;
    let delivered = 0;
    for (const sub of [...streams]) {
      if (sub.session !== session) continue;
      if (writeSseEvent(sub.sink, "state", value)) delivered += 1;
      else streams.delete(sub);
    }
    return delivered;
  };

  const emitOutput = async (
    session: string,
    lines: string | readonly string[],
    emitOpts: EmitOutputOptions = {},
  ): Promise<number> => {
    const list = typeof lines === "string" ? [lines] : [...lines];
    let delivered = 0;
    for (const sub of [...streams]) {
      if (sub.session !== session) continue;
      let alive = true;
      for (const line of list) {
        if (!writeSseEvent(sub.sink, "out", line)) {
          alive = false;
          break;
        }
      }
      if (alive) delivered += 1;
      else streams.delete(sub);
    }
    if (emitOpts.refreshState ?? true) await emitState(session, emitOpts.state);
    return delivered;
  };

  const openStream = async (ctx: Context, session: string): Promise<void> => {
    const sink = responseSink(ctx);
    const sub = { session, sink };
    streams.add(sub);
    ctx.res.on("close", () => { streams.delete(sub); });
    writeSseComment(sink, "ok");
    const seed = await opts.streamSeed?.(session);
    if (seed?.out) {
      const lines = typeof seed.out === "string" ? [seed.out] : seed.out;
      for (const line of lines) writeSseEvent(sink, "out", line);
    }
    if (seed && "state" in seed) writeSseEvent(sink, "state", seed.state);
    else await emitState(session);
  };

  const app: App = {
    resources: [
      {
        id: "session-carrier.session",
        name: "Web Session Login",
        route: paths.session,
        match: paths.session,
        methods: ["POST"],
        produces: ["application/json"],
        handler: async (ctx) => {
          const body = await readJson(ctx, maxBodyBytes);
          const name = asString(body["name"]);
          if (!name) {
            return json(400, { error: "name required" });
          }
          const secret = asString(body["secret"]);
          const identity = await opts.login({ name, ...(secret === undefined ? {} : { secret }) });
          if (!identity.session) {
            return json(500, { error: "login did not return a session" });
          }
          const token = mintToken(tokens);
          tokens.set(token, identity.session);
          const headers: Record<string, string> = {};
          if (sessionCookie) {
            headers["Set-Cookie"] = signedCookieHeader(sessionCookie, token);
          }
          return json(200, { session: identity.session, token }, headers);
        },
      },
      {
        id: "session-carrier.input",
        name: "Web Session Input",
        route: paths.input,
        match: paths.input,
        methods: ["POST"],
        produces: ["application/json"],
        handler: async (ctx) => {
          const body = await readJson(ctx, maxBodyBytes);
          const session = requireRequestToken(ctx, body["token"]);
          if (!session) {
            return json(401, { error: "bad token" });
          }
          const line = asString(body["line"]);
          if (!line) {
            return json(400, { error: "line required" });
          }
          await opts.enqueue({ session, line });
          return json(202, { accepted: true });
        },
      },
      {
        id: "session-carrier.stream",
        name: "Web Session Stream",
        route: paths.stream,
        match: paths.stream,
        methods: ["GET"],
        handler: async (ctx) => {
          const session = requireRequestToken(ctx, ctx.url.searchParams.get("token"));
          if (!session) {
            return { status: 401, type: "text/plain; charset=utf-8", body: "bad token" };
          }
          await openStream(ctx, session);
        },
      },
      {
        id: "session-carrier.events",
        name: "Web Session Events",
        route: paths.events,
        match: paths.events,
        methods: ["GET"],
        handler: (ctx) => {
          const sink = responseSink(ctx);
          const topics = ctx.url.searchParams.get("topics") ?? undefined;
          const close = eventHub.subscribe(sink, topics === undefined ? {} : { topics });
          ctx.res.on("close", close);
        },
      },
    ],
  };

  return {
    app,
    sessionOf: (token) => tokens.get(token),
    revoke(token) { return tokens.delete(token); },
    emitOutput,
    emitState,
    publishEvents(events) { eventHub.publish(events); },
    subscribers(session) {
      if (session === undefined) return streams.size;
      return [...streams].filter((sub) => sub.session === session).length;
    },
  };
}

function signedCookieHeader(
  sessionCookie: { name: string; secret: string; cookie: CookieOptions },
  token: string,
): string {
  return serializeSetCookie(
    sessionCookie.name,
    signCookieValue(token, sessionCookie.secret, sessionCookie.name),
    sessionCookie.cookie,
  );
}

export function createQueuedWebSessionCarrier<Intent extends object = SessionInput>(
  opts: Omit<WebSessionCarrierOptions, "enqueue"> & Readonly<{
    validateInput?: SessionInputValidator<SessionInput, Intent>;
  }>,
): QueuedWebSessionCarrier<Intent> {
  const validate = opts.validateInput ?? ((input: SessionInput) => input as unknown as Intent);
  const queue = createSessionInputQueue<SessionInput, Intent>(validate);
  const carrier = createWebSessionCarrier({
    ...opts,
    enqueue(input) {
      queue.push(input);
    },
  });
  return Object.freeze({
    ...carrier,
    queue,
    drainInput: () => queue.drain(),
    pendingInput: () => queue.peek(),
  });
}

export function createSessionInputQueue<Input, Intent extends object>(
  validate: SessionInputValidator<Input, Intent>,
): SessionInputQueue<Input, Intent> {
  const pending: Intent[] = [];
  return Object.freeze({
    push(input) {
      const intent = validate(input);
      if (!intent) return null;
      pending.push(intent);
      return intent;
    },
    drain() {
      return pending.splice(0, pending.length);
    },
    peek() {
      return [...pending];
    },
    size() {
      return pending.length;
    },
  });
}

export function sessionRequest(login: SessionLogin, paths: Partial<WebSessionCarrierPaths> = {}): { url: string; init: WebSessionRequestInit } {
  const resolved = { ...DEFAULT_PATHS, ...paths };
  return jsonRequest(resolved.session, {
    name: login.name,
    ...(login.secret === undefined ? {} : { secret: login.secret }),
  });
}

export function inputRequest(token: string, line: string, paths: Partial<WebSessionCarrierPaths> = {}): { url: string; init: WebSessionRequestInit } {
  const resolved = { ...DEFAULT_PATHS, ...paths };
  return jsonRequest(resolved.input, { token, line });
}

export function streamUrl(token: string, paths: Partial<WebSessionCarrierPaths> = {}): string {
  const resolved = { ...DEFAULT_PATHS, ...paths };
  return `${resolved.stream}?token=${encodeURIComponent(token)}`;
}

export function eventsUrl(topics?: string | readonly string[], paths: Partial<WebSessionCarrierPaths> = {}): string {
  const resolved = { ...DEFAULT_PATHS, ...paths };
  const topicText = typeof topics === "string" ? topics : topics ? topics.join(",") : undefined;
  return topicText ? `${resolved.events}?topics=${encodeURIComponent(topicText)}` : resolved.events;
}

export function parseSseFrames(buffer: string): { events: WebSessionEvent[]; rest: string } {
  const events: WebSessionEvent[] = [];
  let rest = buffer;
  let index = rest.indexOf("\n\n");
  while (index >= 0) {
    const frame = rest.slice(0, index);
    rest = rest.slice(index + 2);
    const event = parseSseFrame(frame);
    if (event) events.push(event);
    index = rest.indexOf("\n\n");
  }
  return { events, rest };
}

export function parseSseFrame(frame: string): WebSessionEvent | null {
  if (!frame || frame.startsWith(":")) return null;
  const [decoded] = parseSseStream(frame);
  if (!decoded || !decoded.data) return null;
  const event = decoded.event || "message";
  return {
    event,
    data: decoded.data,
    ...(decoded.id === undefined ? {} : { id: decoded.id }),
    ...(decoded.retry === undefined ? {} : { retry: decoded.retry }),
  };
}

export function decodeEventData(event: WebSessionEvent): unknown {
  try {
    return JSON.parse(event.data);
  } catch {
    return event.data;
  }
}

export function createWebSessionClient(opts: WebSessionClientOptions): WebSessionClient {
  const paths = { ...DEFAULT_PATHS, ...(opts.paths ?? {}) };
  const openEventSource = (url: string): WebSessionEventSource => {
    if (!opts.eventSource) throw new Error("createWebSessionClient requires eventSource for stream/event connections");
    return opts.eventSource(url);
  };

  return Object.freeze({
    async login(login) {
      const req = sessionRequest(login, paths);
      const response = await opts.fetch(req.url, req.init);
      const body = await response.json() as JsonObject;
      if (response.status < 200 || response.status >= 300 || typeof body["token"] !== "string" || typeof body["session"] !== "string") {
        throw new Error(`session login failed (${response.status})`);
      }
      return { session: body["session"], token: body["token"] };
    },
    async input(token, line) {
      const req = inputRequest(token, line, paths);
      const response = await opts.fetch(req.url, req.init);
      return response.status >= 200 && response.status < 300;
    },
    stream(token, handlers = {}) {
      const source = openEventSource(streamUrl(token, paths));
      const onEvent = (event: { type: string; data: string }): void => {
        const parsed: WebSessionEvent = { event: event.type || "message", data: event.data };
        const payload = decodeEventData(parsed);
        if (parsed.event === "out") handlers.out?.(String(payload));
        else if (parsed.event === "sense") handlers.sense?.(String(payload));
        else if (parsed.event === "state") handlers.state?.(payload);
        handlers.event?.(parsed, payload);
      };
      attachEventSource(source, ["out", "sense", "state", "message"], onEvent);
      source.onopen = () => handlers.open?.();
      source.onerror = (error?: unknown) => handlers.error?.(error);
      return source;
    },
    events(topics, handler) {
      const source = openEventSource(eventsUrl(topics, paths));
      const onEvent = (event: { type: string; data: string }): void => {
        const parsed: WebSessionEvent = { event: event.type || "message", data: event.data };
        handler?.(parsed, decodeEventData(parsed));
      };
      attachEventSource(source, ["message", "market", "combat", "chat", "world", "say", "move", "trade"], onEvent);
      return source;
    },
  });
}

function attachEventSource(
  source: WebSessionEventSource,
  events: readonly string[],
  listener: (event: { type: string; data: string }) => void,
): void {
  if (source.addEventListener) {
    for (const event of events) source.addEventListener(event, listener);
  } else {
    source.onmessage = listener;
  }
}

function jsonRequest(url: string, body: JsonObject): { url: string; init: WebSessionRequestInit } {
  const encoded = JSON.stringify(body);
  return {
    url,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(encoded)),
      },
      body: encoded,
    },
  };
}

function mintToken(existing: ReadonlyMap<string, string>): string {
  let token = randomBytes(24).toString("hex");
  while (existing.has(token)) token = randomBytes(24).toString("hex");
  return token;
}

function normalizeSessionCookie(
  options: false | WebSessionCookieOptions | undefined,
): { name: string; secret: string; cookie: CookieOptions } | null {
  if (!options) return null;
  if (!options.secret) throw new TypeError("sessionCookie.secret is required");
  return {
    name: options.name ?? "web_session",
    secret: options.secret,
    cookie: {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      ...options.cookie,
    },
  };
}

function responseSink(ctx: Context): SseSink {
  ctx.res.writeHead(200, sseHeaders());
  ctx.res.flushHeaders?.();
  ctx.req.socket.setTimeout(0);
  ctx.req.socket.setNoDelay(true);
  return {
    write(chunk: string) {
      if (ctx.res.destroyed || ctx.res.writableEnded) throw new Error("SSE sink is closed");
      return ctx.res.write(chunk);
    },
  };
}

async function readJson(ctx: Context, maxBodyBytes: number): Promise<JsonObject> {
  try {
    const parsed = await readJsonBody(ctx.req, { maxBytes: maxBodyBytes, empty: {} });
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : {};
  } catch {
    return {};
  }
}

function json(status: number, body: JsonObject, headers: Record<string, string> = {}): Repr {
  return {
    status,
    type: "application/json; charset=utf-8",
    headers,
    body: `${JSON.stringify(body)}\n`,
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
