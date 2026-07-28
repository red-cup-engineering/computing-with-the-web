import type { IncomingMessage } from "node:http";
import { readJsonBody, type App, type Resource, type UpgradeHandler } from "@red-cup-engineering/computing-with-http/app";
import { handler as webHandler, sse, staticFiles, websocketServer } from "@red-cup-engineering/http-server";
import { MSG, decode, encode, hello } from "./protocol.mjs";
import type { JsonRecord, WireMessage } from "./protocol.mjs";

export * from "./protocol.mjs";

export type SnapshotEntry = JsonRecord & { id: string };
export type FullFrame<Entry extends SnapshotEntry = SnapshotEntry> = Readonly<{
  type: "full";
  tick: number;
  entities: readonly Entry[];
}>;
export type DeltaFrame<Entry extends SnapshotEntry = SnapshotEntry> = Readonly<{
  type: "delta";
  tick: number;
  ack: number;
  entities: readonly Entry[];
  removed: readonly string[];
}>;
export type SnapshotFrame<Entry extends SnapshotEntry = SnapshotEntry> = FullFrame<Entry> | DeltaFrame<Entry>;

export type Subscriber<Entry extends SnapshotEntry = SnapshotEntry> = Readonly<{
  id: unknown;
  full(tick: number): FullFrame<Entry>;
  delta(tick: number, ack?: number): DeltaFrame<Entry>;
  drop(): void;
}>;

export type BroadcastClient<Message = unknown> = {
  send(message: Message): boolean | void;
  heartbeat?(): boolean | void;
  lastSeq?: number;
};

export type IntentQueue<Intent extends object = JsonRecord> = Readonly<{
  push(raw: unknown): Intent | null;
  drain(): Intent[];
  depth(): number;
}>;

export type SnapshotManager<Entry extends SnapshotEntry = SnapshotEntry> = Readonly<{
  bootstrap(tick: number): Promise<FullFrame<Entry>>;
  resettle(dirty: Iterable<string>, tick: number): Promise<DeltaFrame<Entry>>;
  full(tick: number): FullFrame<Entry>;
  subscribe(subscriberId: unknown): Subscriber<Entry>;
  has(id: string): boolean;
  size(): number;
}>;

export type BroadcastHub<Message = unknown, Entry extends SnapshotEntry = SnapshotEntry> = Readonly<{
  add(client: BroadcastClient<Message>): () => void;
  remove(client: BroadcastClient<Message>): void;
  bind(client: BroadcastClient<Message>, subscriber: Subscriber<Entry>): void;
  subscriberOf(client: BroadcastClient<Message>): Subscriber<Entry> | null;
  send(client: BroadcastClient<Message>, message: Message): boolean;
  broadcast(message: Message): void;
  each(fn: (client: BroadcastClient<Message>, subscriber: Subscriber<Entry> | null) => void): void;
  heartbeat(): void;
  size(): number;
}>;

export type ReplayEntry<Message = unknown> = Readonly<{
  id: number;
  tick: number;
  event: string;
  message: Message;
}>;

export type QwzspaceReplayLog<Message = unknown> = Readonly<{
  record(tick: number, message: Message, event?: string): ReplayEntry<Message>;
  since(id: number): readonly ReplayEntry<Message>[] | null;
  latestId(): number;
  earliestId(): number | null;
  size(): number;
}>;

export type RunTickResult = Readonly<{
  dirty?: Iterable<string>;
  events?: Iterable<unknown>;
}>;

export type QwzspaceTransport = "sse" | "ws" | "both";

export type TickDriver<Intent extends object = JsonRecord> = Readonly<{
  tickNow(): number;
  step(): Promise<RunTickResult>;
  stop(): void;
}>;

export type QwzspaceHealthStatus = "starting" | "ok" | "degraded";

export type QwzspaceReplayStatus = Readonly<{
  retained: number;
  earliestId: number | null;
  latestId: number;
}>;

export type QwzspaceHealthReport = Readonly<{
  status: QwzspaceHealthStatus;
  ready: boolean;
  tick: number;
  queueDepth: number;
  clients: number;
  entities: number;
  transport: QwzspaceTransport;
  uptimeMs: number;
  timestamp: string;
  replay: QwzspaceReplayStatus | null;
  error?: string;
}>;

export type CreateQwzspaceOptions<Intent extends object, Entry extends SnapshotEntry> = Readonly<{
  runTick(tick: number, intents: readonly Intent[]): Promise<RunTickResult | void> | RunTickResult | void;
  subjectsOf(tick: number): Iterable<string> | Promise<Iterable<string>>;
  snapOf(id: string, tick: number): Entry | null | Promise<Entry | null>;
  validate?: (raw: unknown) => Intent | null;
  interest?: (id: string, subscriberId: unknown) => boolean;
  bootstrap?: () => number | Promise<number>;
  intervalMs?: number;
  heartbeatMs?: number;
  transport?: QwzspaceTransport;
  clientDir?: string;
  eventsPath?: string;
  actPath?: string;
  wsPath?: string;
  healthPath?: string | false;
  maxBodyBytes?: number;
  replayCapacity?: number | false;
  autoStart?: boolean;
  onError?: (error: unknown) => void;
}>;

export type QwzspaceServer<Intent extends object = JsonRecord, Entry extends SnapshotEntry = SnapshotEntry> = Readonly<{
  app: App;
  handler: ReturnType<typeof webHandler>;
  queue: IntentQueue<Intent>;
  snapshot: SnapshotManager<Entry>;
  hub: BroadcastHub<unknown, Entry>;
  replay: QwzspaceReplayLog<unknown> | null;
  step(): Promise<RunTickResult>;
  start(): Promise<TickDriver<Intent>>;
  tickNow(): number;
  health(): QwzspaceHealthReport;
  ready: Promise<FullFrame<Entry>>;
}>;

export function id(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value) ? value : null;
}

export function num(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function createIntentQueue<Intent extends object = JsonRecord>(
  options: { validate?: (raw: unknown) => Intent | null } = {},
): IntentQueue<Intent> {
  const validate = options.validate ?? ((raw: unknown): Intent | null =>
    raw && typeof raw === "object" ? raw as Intent : null);
  let pending: Intent[] = [];
  return Object.freeze({
    push(raw) {
      const accepted = validate(raw);
      if (accepted) pending.push(accepted);
      return accepted;
    },
    drain() {
      const batch = pending;
      pending = [];
      return batch;
    },
    depth: () => pending.length,
  });
}

export function createBroadcastHub<Message = unknown, Entry extends SnapshotEntry = SnapshotEntry>(): BroadcastHub<Message, Entry> {
  const clients = new Set<BroadcastClient<Message>>();
  const bound = new Map<BroadcastClient<Message>, Subscriber<Entry>>();

  const remove = (client: BroadcastClient<Message>): void => {
    clients.delete(client);
    bound.get(client)?.drop();
    bound.delete(client);
  };

  const sendOne = (client: BroadcastClient<Message>, message: Message): boolean => {
    try {
      const ok = client.send(message);
      if (ok === false) remove(client);
      return ok !== false;
    } catch {
      remove(client);
      return false;
    }
  };

  return Object.freeze({
    add(client) {
      clients.add(client);
      return () => remove(client);
    },
    remove,
    bind(client, subscriber) {
      bound.set(client, subscriber);
    },
    subscriberOf(client) {
      return bound.get(client) ?? null;
    },
    send: sendOne,
    broadcast(message) {
      for (const client of [...clients]) sendOne(client, message);
    },
    each(fn) {
      for (const client of [...clients]) fn(client, bound.get(client) ?? null);
    },
    heartbeat() {
      for (const client of [...clients]) {
        if (!client.heartbeat) continue;
        try {
          const ok = client.heartbeat();
          if (ok === false) remove(client);
        } catch {
          remove(client);
        }
      }
    },
    size: () => clients.size,
  });
}

export function createQwzspaceReplayLog<Message = unknown>(capacity = 256): QwzspaceReplayLog<Message> {
  const limit = Math.max(0, Math.trunc(Number.isFinite(capacity) ? capacity : 0));
  const entries: ReplayEntry<Message>[] = [];
  let nextId = 1;
  return Object.freeze({
    record(tick, message, event = eventName(message)) {
      const entry = Object.freeze({ id: nextId++, tick: tick | 0, event, message });
      if (limit > 0) {
        entries.push(entry);
        while (entries.length > limit) entries.shift();
      }
      return entry;
    },
    since(id) {
      if (!Number.isSafeInteger(id) || id < 0) return null;
      const earliest = entries[0]?.id;
      if (earliest === undefined) return Object.freeze([]);
      if (id < earliest - 1) return null;
      return Object.freeze(entries.filter((entry) => entry.id > id));
    },
    latestId: () => nextId - 1,
    earliestId: () => entries[0]?.id ?? null,
    size: () => entries.length,
  });
}

export function createSnapshotManager<Entry extends SnapshotEntry = SnapshotEntry>(
  options: {
    subjectsOf(tick: number): Iterable<string> | Promise<Iterable<string>>;
    snapOf(id: string, tick: number): Entry | null | Promise<Entry | null>;
    interest?: (id: string, subscriberId: unknown) => boolean;
  },
): SnapshotManager<Entry> {
  const cache = new Map<string, Entry>();
  const subscribers = new Map<unknown, { lastView: Map<string, string> }>();
  const signature = (entry: Entry): string => JSON.stringify(entry);
  const visibleFor = (subscriberId: unknown): Array<[string, Entry]> => {
    const entries: Array<[string, Entry]> = [];
    for (const [entryId, entry] of cache) {
      if (!options.interest || options.interest(entryId, subscriberId)) entries.push([entryId, entry]);
    }
    return entries;
  };

  return Object.freeze({
    async bootstrap(tick) {
      cache.clear();
      for (const subject of await options.subjectsOf(tick)) {
        const entry = await options.snapOf(subject, tick);
        if (entry) cache.set(subject, entry);
      }
      return { type: "full", tick, entities: [...cache.values()] };
    },
    async resettle(dirty, tick) {
      const entities: Entry[] = [];
      const removed: string[] = [];
      for (const subject of dirty) {
        const entry = await options.snapOf(subject, tick);
        if (entry) {
          cache.set(subject, entry);
          entities.push(entry);
        } else if (cache.has(subject)) {
          cache.delete(subject);
          removed.push(subject);
        }
      }
      return { type: "delta", tick, ack: 0, entities, removed };
    },
    full(tick) {
      return { type: "full", tick, entities: [...cache.values()] };
    },
    subscribe(subscriberId) {
      const state = { lastView: new Map<string, string>() };
      subscribers.set(subscriberId, state);
      return Object.freeze({
        id: subscriberId,
        full(tick) {
          const entities: Entry[] = [];
          state.lastView.clear();
          for (const [entryId, entry] of visibleFor(subscriberId)) {
            entities.push(entry);
            state.lastView.set(entryId, signature(entry));
          }
          return { type: "full", tick, entities };
        },
        delta(tick, ack = 0) {
          const entities: Entry[] = [];
          const seen = new Set<string>();
          for (const [entryId, entry] of visibleFor(subscriberId)) {
            seen.add(entryId);
            const nextSignature = signature(entry);
            if (state.lastView.get(entryId) !== nextSignature) {
              entities.push(entry);
              state.lastView.set(entryId, nextSignature);
            }
          }
          const removed: string[] = [];
          for (const entryId of state.lastView.keys()) {
            if (!seen.has(entryId)) {
              removed.push(entryId);
              state.lastView.delete(entryId);
            }
          }
          return { type: "delta", tick, ack: ack | 0, entities, removed };
        },
        drop() {
          subscribers.delete(subscriberId);
        },
      });
    },
    has: (entryId) => cache.has(entryId),
    size: () => cache.size,
  });
}

async function runStep<Intent extends object, Entry extends SnapshotEntry>(
  state: { tick: number; running: boolean },
  opts: {
    queue: IntentQueue<Intent>;
    hub: BroadcastHub<unknown, Entry>;
    snapshot: SnapshotManager<Entry>;
    runTick(tick: number, intents: readonly Intent[]): Promise<RunTickResult | void> | RunTickResult | void;
    perSubscriber: boolean;
    replay?: QwzspaceReplayLog<unknown>;
  },
): Promise<RunTickResult> {
  if (state.running) return {};
  state.running = true;
  try {
    const tick = state.tick + 1;
    const intents = opts.queue.drain();
    const result = (await opts.runTick(tick, intents)) ?? {};
    state.tick = tick;
    const dirty = result.dirty ?? [];
    if (opts.perSubscriber) {
      await opts.snapshot.resettle(dirty, tick);
      opts.hub.each((client, subscriber) => {
        if (!subscriber) return;
        const frame = subscriber.delta(tick, client.lastSeq ?? 0);
        if (frame.entities.length || frame.removed.length) opts.hub.send(client, frame);
      });
    } else {
      const frame = await opts.snapshot.resettle(dirty, tick);
      if (frame.entities.length || frame.removed.length) {
        opts.replay?.record(tick, frame, frame.type);
        opts.hub.broadcast(frame);
      }
    }
    for (const message of result.events ?? []) {
      opts.replay?.record(tick, message);
      opts.hub.broadcast(message);
    }
    return result;
  } finally {
    state.running = false;
  }
}

export async function startTickDriver<Intent extends object = JsonRecord, Entry extends SnapshotEntry = SnapshotEntry>(
  options: {
    hub: BroadcastHub<unknown, Entry>;
    snapshot: SnapshotManager<Entry>;
    queue: IntentQueue<Intent>;
    runTick(tick: number, intents: readonly Intent[]): Promise<RunTickResult | void> | RunTickResult | void;
    bootstrap?: () => number | Promise<number>;
    intervalMs?: number;
    heartbeatMs?: number;
    perSubscriber?: boolean;
    onError?: (error: unknown) => void;
  },
): Promise<TickDriver<Intent>> {
  const state = { tick: (options.bootstrap ? await options.bootstrap() : 0) | 0, running: false };
  await options.snapshot.bootstrap(state.tick);
  const step = async (): Promise<RunTickResult> => runStep(state, {
    queue: options.queue,
    hub: options.hub,
    snapshot: options.snapshot,
    runTick: options.runTick,
    perSubscriber: options.perSubscriber ?? false,
  });
  const tickTimer = setInterval(() => {
    void step().catch((error) => options.onError?.(error));
  }, options.intervalMs ?? 200);
  const heartbeatTimer = setInterval(() => options.hub.heartbeat(), options.heartbeatMs ?? 15_000);
  tickTimer.unref?.();
  heartbeatTimer.unref?.();
  return Object.freeze({
    tickNow: () => state.tick,
    step,
    stop() {
      clearInterval(tickTimer);
      clearInterval(heartbeatTimer);
    },
  });
}

function eventName(message: unknown): string {
  if (message && typeof message === "object") {
    const record = message as { type?: unknown; k?: unknown };
    if (typeof record.type === "string") return record.type;
    if (typeof record.k === "string") return record.k;
  }
  return "message";
}

export function createSseResources<Intent extends object, Entry extends SnapshotEntry>(
  options: {
    hub: BroadcastHub<unknown, Entry>;
    queue: IntentQueue<Intent>;
    snapshot: SnapshotManager<Entry>;
    tickNow(): number;
    eventsPath?: string;
    actPath?: string;
    maxBodyBytes?: number;
    replay?: QwzspaceReplayLog<unknown>;
  },
): Resource[] {
  const eventsPath = options.eventsPath ?? "/events";
  const actPath = options.actPath ?? "/act";
  const maxBodyBytes = options.maxBodyBytes ?? 64 * 1024;
  return [
    {
      id: "qwzspace.events",
      name: "QWZSpace Events",
      route: eventsPath,
      match: eventsPath,
      methods: ["GET"],
      produces: ["text/event-stream"],
      handler: async (ctx) => {
        let client: BroadcastClient<unknown> | undefined;
        const writer = sse(ctx.req, ctx.res, () => {
          if (client) options.hub.remove(client);
        });
        writer.comment("connected");
        client = {
          send(message) {
            writer.send(eventName(message), message);
            return true;
          },
          heartbeat() {
            writer.comment("ping");
            return true;
          },
        };
        options.hub.add(client);
        const subscriber = options.snapshot.subscribe(ctx.req);
        options.hub.bind(client, subscriber);
        const replay = replaySince(ctx.req.headers["last-event-id"], options.replay);
        if (replay) {
          for (const entry of replay) writer.send(entry.event, entry.message, String(entry.id));
        } else {
          options.hub.send(client, subscriber.full(options.tickNow()));
        }
      },
    },
    {
      id: "qwzspace.act",
      name: "QWZSpace Act",
      route: actPath,
      match: actPath,
      methods: ["POST"],
      produces: ["application/json"],
      handler: async (ctx) => {
        try {
          const raw = await readJsonBody(ctx.req, { maxBytes: maxBodyBytes, empty: {} });
          const accepted = options.queue.push(raw);
          if (!accepted) {
            return { status: 400, type: "application/json; charset=utf-8", body: "{\"error\":\"invalid intent\"}\n" };
          }
          return { status: 204, type: "application/json; charset=utf-8" };
        } catch (error) {
          const tooLarge = error instanceof RangeError;
          return {
            status: tooLarge ? 413 : 400,
            type: "application/json; charset=utf-8",
            body: JSON.stringify({ error: tooLarge ? "intent too large" : "invalid json" }) + "\n",
          };
        }
      },
    },
  ];
}

export function createWsUpgrade<Intent extends object, Entry extends SnapshotEntry>(
  options: {
    hub: BroadcastHub<unknown, Entry>;
    queue: IntentQueue<Intent>;
    snapshot: SnapshotManager<Entry>;
    tickNow(): number;
    path?: string | RegExp | ((path: string) => boolean);
    maxPayload?: number;
    replay?: QwzspaceReplayLog<unknown>;
    onMessage?: (message: WireMessage, req: IncomingMessage) => void;
  },
): UpgradeHandler {
  const endpoint = websocketServer((ws, req) => {
    const client: BroadcastClient<unknown> = {
      send(message) {
        ws.send(encode(message));
        return true;
      },
      heartbeat() {
        ws.ping();
        return true;
      },
    };
    options.hub.add(client);
    const subscriber = options.snapshot.subscribe(req);
    options.hub.bind(client, subscriber);
    client.send(hello(null, { tick: options.tickNow() }));
    const replay = replaySince(new URL(req.url ?? "/", "http://localhost").searchParams.get("since"), options.replay);
    if (replay) {
      for (const entry of replay) client.send(entry.message);
    } else {
      client.send(subscriber.full(options.tickNow()));
    }
    ws.on("message", (data) => {
      const message = decode(data);
      if (!message) return;
      if (typeof message.seq === "number") client.lastSeq = message.seq;
      if (message.k === MSG.intent || message.k === MSG.join) options.queue.push(message);
      options.onMessage?.(message, req);
    });
    ws.on("close", () => options.hub.remove(client));
  }, options.maxPayload === undefined ? {} : { maxPayload: options.maxPayload });
  return endpoint.toUpgrade(options.path ?? "/ws");
}

function replaySince(value: unknown, replay: QwzspaceReplayLog<unknown> | undefined): readonly ReplayEntry<unknown>[] | null {
  if (!replay) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === null || raw === "") return null;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 0) return null;
  return replay.since(id);
}

function healthStatus(readyState: "starting" | "ready" | "error"): QwzspaceHealthStatus {
  if (readyState === "ready") return "ok";
  if (readyState === "error") return "degraded";
  return "starting";
}

export function qwsHealthReport<Entry extends SnapshotEntry = SnapshotEntry>(
  options: {
    hub: BroadcastHub<unknown, Entry>;
    queue: Readonly<{ depth(): number }>;
    snapshot: SnapshotManager<Entry>;
    tickNow(): number;
    readyState: "starting" | "ready" | "error";
    transport: QwzspaceTransport;
    startedAt: number;
    replay?: QwzspaceReplayLog<unknown> | null;
    error?: unknown;
    now?: () => number;
  },
): QwzspaceHealthReport {
  const now = options.now?.() ?? Date.now();
  const out: {
    status: QwzspaceHealthStatus;
    ready: boolean;
    tick: number;
    queueDepth: number;
    clients: number;
    entities: number;
    transport: QwzspaceTransport;
    uptimeMs: number;
    timestamp: string;
    replay: QwzspaceReplayStatus | null;
    error?: string;
  } = {
    status: healthStatus(options.readyState),
    ready: options.readyState === "ready",
    tick: options.tickNow(),
    queueDepth: options.queue.depth(),
    clients: options.hub.size(),
    entities: options.snapshot.size(),
    transport: options.transport,
    uptimeMs: Math.max(0, now - options.startedAt),
    timestamp: new Date(now).toISOString(),
    replay: options.replay ? {
      retained: options.replay.size(),
      earliestId: options.replay.earliestId(),
      latestId: options.replay.latestId(),
    } : null,
  };
  if (options.error !== undefined) out.error = options.error instanceof Error ? options.error.message : String(options.error);
  return Object.freeze(out);
}

export function createQwzspaceHealthResource<Entry extends SnapshotEntry = SnapshotEntry>(
  options: {
    path?: string;
    report(): QwzspaceHealthReport;
  },
): Resource {
  return {
    id: "qwzspace.health",
    name: "QWZSpace Health",
    route: options.path ?? "/health",
    match: options.path ?? "/health",
    methods: ["GET", "HEAD"],
    produces: ["application/json"],
    handler: async (ctx) => {
      const report = options.report();
      return {
        status: report.status === "degraded" ? 503 : 200,
        type: "application/json; charset=utf-8",
        cacheControl: { noCache: true, maxAge: 0 },
        body: JSON.stringify(report) + "\n",
      };
    },
  };
}

export function createQwzspaceServer<
  Intent extends object = JsonRecord,
  Entry extends SnapshotEntry = SnapshotEntry,
>(options: CreateQwzspaceOptions<Intent, Entry>): QwzspaceServer<Intent, Entry> {
  const queue = createIntentQueue<Intent>({ ...(options.validate ? { validate: options.validate } : {}) });
  const snapshotManager = createSnapshotManager<Entry>({
    subjectsOf: options.subjectsOf,
    snapOf: options.snapOf,
    ...(options.interest ? { interest: options.interest } : {}),
  });
  const hub = createBroadcastHub<unknown, Entry>();
  const state = { tick: 0, running: false };
  const startedAt = Date.now();
  let readyState: "starting" | "ready" | "error" = "starting";
  let readyError: unknown;
  const perSubscriber = Boolean(options.interest);
  const transport = options.transport ?? "sse";
  const replay = options.replayCapacity === false || perSubscriber
    ? null
    : createQwzspaceReplayLog<unknown>(options.replayCapacity ?? 256);
  const health = (): QwzspaceHealthReport => qwsHealthReport({
    queue,
    hub,
    snapshot: snapshotManager,
    tickNow: () => state.tick,
    readyState,
    transport,
    startedAt,
    replay,
    ...(readyError !== undefined ? { error: readyError } : {}),
  });
  const step = (): Promise<RunTickResult> => runStep(state, {
    queue,
    hub,
    snapshot: snapshotManager,
    runTick: options.runTick,
    perSubscriber,
    ...(replay ? { replay } : {}),
  });
  const start = async (): Promise<TickDriver<Intent>> => {
    const driver = await startTickDriver<Intent, Entry>({
      queue,
      hub,
      snapshot: snapshotManager,
      runTick: options.runTick,
      ...(options.bootstrap ? { bootstrap: options.bootstrap } : {}),
      ...(options.intervalMs !== undefined ? { intervalMs: options.intervalMs } : {}),
      ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
      perSubscriber,
      ...(options.onError ? { onError: options.onError } : {}),
    });
    state.tick = driver.tickNow();
    return Object.freeze({
      tickNow: () => driver.tickNow(),
      step: () => driver.step(),
      stop: () => driver.stop(),
    });
  };
  const resources: Resource[] = [];
  const upgrades: UpgradeHandler[] = [];
  if (options.healthPath !== false) {
    resources.push(createQwzspaceHealthResource({
      ...(options.healthPath ? { path: options.healthPath } : {}),
      report: health,
    }));
  }
  if (options.clientDir) resources.push({ match: (path) => path === "/" || !path.startsWith(options.eventsPath ?? "/events"), handler: staticFiles({ root: options.clientDir }) });
  if (transport === "sse" || transport === "both") {
    resources.unshift(...createSseResources({
      queue,
      hub,
      snapshot: snapshotManager,
      tickNow: () => state.tick,
      ...(options.eventsPath ? { eventsPath: options.eventsPath } : {}),
      ...(options.actPath ? { actPath: options.actPath } : {}),
      ...(options.maxBodyBytes !== undefined ? { maxBodyBytes: options.maxBodyBytes } : {}),
      ...(replay ? { replay } : {}),
    }));
  }
  if (transport === "ws" || transport === "both") {
    upgrades.push(createWsUpgrade({
      queue,
      hub,
      snapshot: snapshotManager,
      tickNow: () => state.tick,
      ...(options.wsPath ? { path: options.wsPath } : {}),
      ...(options.maxBodyBytes !== undefined ? { maxPayload: options.maxBodyBytes } : {}),
      ...(replay ? { replay } : {}),
    }));
  }
  if (transport !== "sse" && transport !== "ws" && transport !== "both") {
    throw new TypeError(`unknown qwzspace transport: ${String(transport)}`);
  }
  const app: App = { resources, upgrades };

  const ready = (async () => {
    state.tick = (options.bootstrap ? await options.bootstrap() : 0) | 0;
    return snapshotManager.bootstrap(state.tick);
  })();
  void ready.then(
    () => { readyState = "ready"; },
    (error) => { readyState = "error"; readyError = error; },
  );
  if (options.autoStart) void ready.then(() => start()).catch((error) => options.onError?.(error));
  return Object.freeze({
    app,
    handler: webHandler(app),
    queue,
    snapshot: snapshotManager,
    hub,
    replay,
    step,
    start,
    tickNow: () => state.tick,
    health,
    ready,
  });
}

export const createServer = createQwzspaceServer;
