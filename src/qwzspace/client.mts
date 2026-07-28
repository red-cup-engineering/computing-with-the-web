import { MSG, decode, encode, input, intent, join, type JsonRecord, type WireMessage } from "./protocol.mjs";

export type ClientEntity = JsonRecord & {
  id: string;
  type?: string;
  zone?: string;
  name?: string;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  tx?: number;
  ty?: number;
  tz?: number;
  tyaw?: number;
};
export type ClientFrame = WireMessage | {
  type: "full" | "delta" | string;
  tick?: number;
  entities?: readonly ClientEntity[];
  removed?: readonly string[];
  [key: string]: unknown;
};

export type InterpolationBufferOptions = Readonly<{
  delayMs?: number;
  maxSamples?: number;
  extrapolateMs?: number;
  now?: () => number;
}>;

export type InterpolationSample = Readonly<{
  timeMs: number;
  tick: number;
  entities: readonly ClientEntity[];
}>;

export type InterpolationBuffer = Readonly<{
  push(frame: ClientFrame, receivedAtMs?: number): boolean;
  sample(renderTimeMs?: number): readonly ClientEntity[];
  latestTick(): number;
  latestSample(): InterpolationSample | null;
  size(): number;
  clear(): void;
}>;

export type RealtimeConnectionState = "unknown" | "up" | "stale" | "down" | "contested" | "exhausted";

export type RealtimeConnectionPolicyOptions = Readonly<{
  baseDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitterRatio?: number;
  staleMs?: number;
  maxAttempts?: number;
  now?: () => number;
  random?: () => number;
}>;

export type RealtimeConnectionSnapshot = Readonly<{
  state: RealtimeConnectionState;
  attempts: number;
  reconnectDelayMs: number | null;
  nextReconnectAtMs: number | null;
  lastOpenAtMs: number | null;
  lastCloseAtMs: number | null;
  lastHeartbeatAtMs: number | null;
  latencyMs: number | null;
  lastError: string | null;
}>;

export type RealtimeConnectionPolicy = Readonly<{
  opened(atMs?: number): RealtimeConnectionSnapshot;
  heartbeat(sentAtMs?: number, receivedAtMs?: number): RealtimeConnectionSnapshot;
  closed(reason?: unknown, atMs?: number): RealtimeConnectionSnapshot;
  failed(error?: unknown, atMs?: number): RealtimeConnectionSnapshot;
  snapshot(atMs?: number): RealtimeConnectionSnapshot;
  shouldReconnect(atMs?: number): boolean;
  reset(): RealtimeConnectionSnapshot;
}>;

export type Listener<Payload = unknown> = (payload: Payload) => void;

export type WorldView = Readonly<{
  on(event: string, listener: Listener): () => void;
  emit(event: string, payload?: unknown): void;
  apply(frame: ClientFrame): void;
  me(): ClientEntity | undefined;
  get(id: string): ClientEntity | undefined;
  zone(id: string): ClientEntity | undefined;
  currentZone(): string | null;
  target(): string | null;
  setTarget(id: string | null): void;
  tick(): number;
  field(): FieldGrid | null;
  settledness(): number;
  inventory(): InventoryView;
  altars(): ClientEntity[];
  interpolate(dtSeconds: number, options?: { localRate?: number; remoteRate?: number }): void;
  inZone(): ClientEntity[];
  nameOf(id: string): string;
  entities(): ClientEntity[];
  zones(): ClientEntity[];
}>;

export type FieldGrid = Readonly<{ dim: number; values: Float32Array }>;
export type InventoryView = Readonly<{ items: readonly unknown[]; marks: number; worth: number }>;

export type WebSocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close?(): void;
  onopen?: ((event?: unknown) => void) | null;
  onclose?: ((event?: unknown) => void) | null;
  onerror?: ((event?: unknown) => void) | null;
  onmessage?: ((event: { data: unknown }) => void) | null;
};

export type EventSourceLike = {
  close(): void;
  onopen?: ((event?: unknown) => void) | null;
  onerror?: ((event?: unknown) => void) | null;
  onmessage?: ((event: { data: unknown; lastEventId?: string }) => void) | null;
};

export type RealtimeClient = Readonly<{
  view: WorldView;
  close(): void;
  sendIntent(seq: number, body: JsonRecord): void;
  sendInput(seq: number, forward: unknown, strafe: unknown, yaw: unknown, attack: unknown): void;
  resumeId(): number | null;
}>;

export type ReplayCursor = Readonly<{
  mark(id: unknown): number | null;
  current(): number | null;
  reset(): void;
  header(): Record<string, string>;
  query(): Record<string, string>;
}>;

export type EntityPredicate = (entity: ClientEntity) => boolean;

export type ClientAction = Readonly<{
  intent?: JsonRecord;
  emit?: Readonly<{ event: string; payload?: unknown }>;
  preventDefault?: boolean;
}>;

export type ActionBindingOptions = Readonly<{
  abilities?: readonly string[];
  selfAbilities?: readonly string[];
  foe?: EntityPredicate;
  item?: EntityPredicate;
  npc?: EntityPredicate;
  foeRange?: number;
  itemRange?: number;
  npcRange?: number;
  portalDir?: (zone: ClientEntity | undefined) => string | null;
}>;

export type VitalBar = Readonly<{
  current: number;
  max: number;
  fraction: number;
  label: string;
}>;

export type EffectView = Readonly<{
  name: string;
  until?: number;
  remaining?: number;
}>;

export type QuestView = Readonly<{
  id?: string;
  name: string;
  progress?: string;
}>;

export type EntityHudView = Readonly<{
  id: string;
  name: string;
  level: number;
  health: VitalBar;
  stamina: VitalBar;
  tags: readonly string[];
  effects: readonly EffectView[];
  entity: ClientEntity;
}>;

export type HudModel = Readonly<{
  tick: number;
  zone: ClientEntity | null;
  self: EntityHudView | null;
  target: EntityHudView | null;
  party: readonly EntityHudView[];
  inventory: InventoryView;
  quest: QuestView | null;
  event: string | null;
}>;

export type WebSocketGameClientOptions = Readonly<{
  view: WorldView;
  socket: WebSocketLike;
  name?: string;
  onState?: (state: "open" | "joining" | "playing" | "disconnected" | "error") => void;
  onMessage?: (message: WireMessage) => void;
}>;

export type SseGameClientOptions = Readonly<{
  view: WorldView;
  events: EventSourceLike;
  fetch?: (input: string, init: RequestInit) => Promise<unknown>;
  actPath?: string;
  actor?: string;
  replayCursor?: ReplayCursor;
  onState?: (state: "open" | "disconnected" | "error") => void;
  onFrame?: (frame: ClientFrame) => void;
}>;

export const DEFAULT_DIRECTION_KEYS: Readonly<Record<string, "n" | "s" | "w" | "e">> = Object.freeze({
  w: "n",
  W: "n",
  ArrowUp: "n",
  s: "s",
  S: "s",
  ArrowDown: "s",
  a: "w",
  A: "w",
  ArrowLeft: "w",
  d: "e",
  D: "e",
  ArrowRight: "e",
});

export const DEFAULT_ACTION_ABILITIES: readonly string[] = Object.freeze(["heavy", "cleave", "bolt", "second-wind"]);

function clientEntities(value: unknown): ClientEntity[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is ClientEntity =>
      Boolean(entry) && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string")
    : [];
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function replayId(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) return null;
  return numeric;
}

export function createReplayCursor(initial?: unknown): ReplayCursor {
  let current = replayId(initial);
  return Object.freeze({
    mark(id) {
      const next = replayId(id);
      if (next !== null) current = current === null ? next : Math.max(current, next);
      return current;
    },
    current: () => current,
    reset() {
      current = null;
    },
    header() {
      return current === null ? {} : { "Last-Event-ID": String(current) };
    },
    query() {
      return current === null ? {} : { since: String(current) };
    },
  });
}

export function createInterpolationBuffer(options: InterpolationBufferOptions = {}): InterpolationBuffer {
  const now = options.now ?? (() => Date.now());
  const delayMs = Math.max(0, finiteNumber(options.delayMs) ?? 100);
  const maxSamples = Math.max(1, Math.trunc(finiteNumber(options.maxSamples) ?? 32));
  const extrapolateMs = Math.max(0, finiteNumber(options.extrapolateMs) ?? 0);
  const state = new Map<string, ClientEntity>();
  const samples: InterpolationSample[] = [];
  let tick = 0;

  const push = (frame: ClientFrame, receivedAtMs = now()): boolean => {
    const normalized = normalizeInterpolationFrame(frame);
    const timeMs = finiteNumber(receivedAtMs);
    if (!normalized || timeMs === null) return false;
    tick = Math.max(tick, normalized.tick);
    if (normalized.full) state.clear();
    for (const removed of normalized.removed) state.delete(removed);
    for (const entity of normalized.entities) state.set(entity.id, cloneEntity(entity));
    samples.push(Object.freeze({
      timeMs,
      tick: normalized.tick,
      entities: Object.freeze([...state.values()].map(cloneEntity)),
    }));
    samples.sort((left, right) => left.timeMs - right.timeMs || left.tick - right.tick);
    while (samples.length > maxSamples) samples.shift();
    return true;
  };

  const sample = (renderTimeMs = now() - delayMs): readonly ClientEntity[] => {
    const at = finiteNumber(renderTimeMs);
    if (samples.length === 0 || at === null) return Object.freeze([]);
    const first = samples[0]!;
    if (at <= first.timeMs) return freezeEntities(first.entities);
    for (let index = 1; index < samples.length; index++) {
      const right = samples[index]!;
      if (at <= right.timeMs) return interpolateSamples(samples[index - 1]!, right, at);
    }
    const last = samples[samples.length - 1]!;
    if (samples.length >= 2 && extrapolateMs > 0 && at <= last.timeMs + extrapolateMs) {
      return extrapolateSamples(samples[samples.length - 2]!, last, at);
    }
    return freezeEntities(last.entities);
  };

  const latestSample = (): InterpolationSample | null => samples[samples.length - 1] ?? null;

  return Object.freeze({
    push,
    sample,
    latestTick: () => tick,
    latestSample,
    size: () => samples.length,
    clear: () => {
      state.clear();
      samples.length = 0;
      tick = 0;
    },
  });
}

export function createRealtimeConnectionPolicy(options: RealtimeConnectionPolicyOptions = {}): RealtimeConnectionPolicy {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const baseDelayMs = Math.max(0, finiteNumber(options.baseDelayMs) ?? 250);
  const maxDelayMs = Math.max(baseDelayMs, finiteNumber(options.maxDelayMs) ?? 10_000);
  const factor = Math.max(1, finiteNumber(options.factor) ?? 2);
  const jitterRatio = Math.max(0, Math.min(1, finiteNumber(options.jitterRatio) ?? 0.2));
  const staleMs = Math.max(0, finiteNumber(options.staleMs) ?? 30_000);
  const maxAttempts = Math.max(0, Math.trunc(finiteNumber(options.maxAttempts) ?? Number.POSITIVE_INFINITY));
  let positiveEvidence = false;
  let negativeEvidence = false;
  let attempts = 0;
  let reconnectDelayMs: number | null = null;
  let nextReconnectAtMs: number | null = null;
  let lastOpenAtMs: number | null = null;
  let lastCloseAtMs: number | null = null;
  let lastHeartbeatAtMs: number | null = null;
  let latencyMs: number | null = null;
  let lastError: string | null = null;

  const settle = (atMs = now()): RealtimeConnectionSnapshot => Object.freeze({
    state: connectionState(positiveEvidence, negativeEvidence, attempts, maxAttempts, staleMs, lastHeartbeatAtMs, atMs),
    attempts,
    reconnectDelayMs,
    nextReconnectAtMs,
    lastOpenAtMs,
    lastCloseAtMs,
    lastHeartbeatAtMs,
    latencyMs,
    lastError,
  });

  const scheduleReconnect = (atMs: number): void => {
    if (attempts >= maxAttempts) {
      reconnectDelayMs = null;
      nextReconnectAtMs = null;
      return;
    }
    const raw = Math.min(maxDelayMs, baseDelayMs * (factor ** Math.max(0, attempts - 1)));
    const jitter = raw * jitterRatio * (random() - 0.5) * 2;
    reconnectDelayMs = Math.max(0, Math.round(raw + jitter));
    nextReconnectAtMs = atMs + reconnectDelayMs;
  };

  const markDown = (reason: unknown, atMs: number): RealtimeConnectionSnapshot => {
    attempts++;
    negativeEvidence = true;
    lastCloseAtMs = atMs;
    lastError = errorText(reason);
    scheduleReconnect(atMs);
    return settle(atMs);
  };

  return Object.freeze({
    opened: (atMs = now()) => {
      positiveEvidence = true;
      negativeEvidence = false;
      attempts = 0;
      reconnectDelayMs = null;
      nextReconnectAtMs = null;
      lastOpenAtMs = atMs;
      lastError = null;
      return settle(atMs);
    },
    heartbeat: (sentAtMs, receivedAtMs = now()) => {
      positiveEvidence = true;
      negativeEvidence = false;
      lastHeartbeatAtMs = receivedAtMs;
      const sent = finiteNumber(sentAtMs);
      latencyMs = sent === null ? latencyMs : Math.max(0, receivedAtMs - sent);
      lastError = null;
      return settle(receivedAtMs);
    },
    closed: (reason, atMs = now()) => {
      positiveEvidence = false;
      return markDown(reason, atMs);
    },
    failed: (error, atMs = now()) => markDown(error, atMs),
    snapshot: settle,
    shouldReconnect: (atMs = now()) => {
      const view = settle(atMs);
      return view.nextReconnectAtMs !== null && atMs >= view.nextReconnectAtMs && view.state !== "exhausted";
    },
    reset: () => {
      positiveEvidence = false;
      negativeEvidence = false;
      attempts = 0;
      reconnectDelayMs = null;
      nextReconnectAtMs = null;
      lastOpenAtMs = null;
      lastCloseAtMs = null;
      lastHeartbeatAtMs = null;
      latencyMs = null;
      lastError = null;
      return settle(now());
    },
  });
}

export function createWorldView(localId: string): WorldView {
  const entities = new Map<string, ClientEntity>();
  const zones = new Map<string, ClientEntity>();
  const listeners = new Map<string, Set<Listener>>();
  const altars = new Map<string, ClientEntity>();
  let myZone: string | null = null;
  let targetId: string | null = null;
  let latestTick = 0;
  let fieldGrid: FieldGrid | null = null;
  let settledness = 0;
  let inventoryView: InventoryView = Object.freeze({ items: [], marks: 0, worth: 0 });

  const emit = (event: string, payload?: unknown): void => {
    for (const listener of [...listeners.get(event) ?? []]) listener(payload);
  };
  const on = (event: string, listener: Listener): (() => void) => {
    const set = listeners.get(event) ?? new Set<Listener>();
    set.add(listener);
    listeners.set(event, set);
    return () => set.delete(listener);
  };
  const setTarget = (id: string | null): void => {
    if (id === targetId) return;
    targetId = id;
    emit("target", id);
  };
  const nameOf = (id: string): string => String(entities.get(id)?.name ?? id);

  const diffEntity = (entryId: string, next: ClientEntity, prev: ClientEntity | undefined): void => {
    if (!prev) {
      emit("entity-add", { id: entryId, snap: next });
    } else {
      const nextHealth = Number(next.health ?? next.hp ?? 0);
      const prevHealth = Number(prev.health ?? prev.hp ?? 0);
      const deltaHealth = nextHealth - prevHealth;
      if (deltaHealth < 0) emit("damage", { id: entryId, amount: -deltaHealth, health: nextHealth });
      if (deltaHealth > 0) emit("heal", { id: entryId, amount: deltaHealth, health: nextHealth });
      const deadNow = isDead(next);
      const deadBefore = isDead(prev);
      if (deadNow && !deadBefore) emit("died", { id: entryId, status: next.status, glyph: next.aliveGlyph });
      if (!deadNow && deadBefore) emit("revived", { id: entryId });
      if (Number(next.level ?? 1) > Number(prev.level ?? 1)) emit("levelup", { id: entryId, level: next.level });
      for (const gained of gainedEffects(prev.effects, next.effects)) emit("effect-gain", { id: entryId, name: gained });
      emit("entity-update", { id: entryId, snap: next, prev });
    }
    if (entryId === localId) emit("me", { snap: next, prev });
  };

  const ingestEntity = (entity: ClientEntity, snap = false): void => {
    if (entity.type === "zone") {
      zones.set(entity.id, entity);
      if (entity.id === myZone) emit("zone-data", entity);
      return;
    }
    const prev = entities.get(entity.id);
    const next = mergeEntity(prev, entity, snap);
    entities.set(entity.id, next);
    if (entity.id === localId && typeof entity.zone === "string" && entity.zone !== myZone) {
      myZone = entity.zone;
      emit("zone-change", { zone: myZone, data: zones.get(myZone) });
    }
    if (entity.id === localId && typeof entity.event === "string" && entity.event !== prev?.event) {
      emit("world-event", { name: entity.event });
    }
    diffEntity(entity.id, next, prev);
  };

  const apply = (frame: ClientFrame): void => {
    if (typeof frame.tick === "number") latestTick = frame.tick;
    if (frame.type === "full") {
      entities.clear();
      zones.clear();
      for (const entity of clientEntities(frame.entities)) ingestEntity(entity, true);
      emit("snapshot", { full: true });
      return;
    }
    if (frame.type === "delta") {
      for (const entity of clientEntities(frame.entities)) ingestEntity(entity, false);
      for (const removed of stringList(frame.removed)) {
        if (entities.delete(removed)) emit("entity-remove", { id: removed });
        if (zones.delete(removed)) emit("zone-remove", { id: removed });
        if (removed === targetId) setTarget(null);
      }
      emit("snapshot", { full: false });
      return;
    }
    if (frame.k === MSG.snapshot) {
      apply({ type: "full", tick: Number(frame.tick ?? 0), entities: clientEntities(frame.e) });
      return;
    }
    if (frame.k === MSG.delta) {
      apply({
        type: "delta",
        tick: Number(frame.tick ?? 0),
        entities: clientEntities(frame.c),
        removed: stringList(frame.g),
      });
      return;
    }
    if (frame.k === MSG.event) emit(String(frame.t ?? "event"), frame);
    else if (frame.k === MSG.chat) emit("chat", { from: nameOf(String(frame.from ?? "")), text: String(frame.line ?? "") });
    else if (frame.k === MSG.field) {
      fieldGrid = decodeField(frame as WireMessage);
      settledness = Number(frame.s ?? 0);
      emit("field", fieldGrid);
    } else if (frame.k === MSG.inventory) {
      inventoryView = Object.freeze({
        items: Array.isArray(frame.items) ? frame.items : [],
        marks: Number(frame.marks) | 0,
        worth: Number(frame.worth) | 0,
      });
      emit("inventory", inventoryView);
    } else if (frame.k === MSG.altar && typeof frame.id === "string") {
      const entry = { ...frame, id: frame.id } as ClientEntity;
      altars.set(frame.id, entry);
      emit("altar", entry);
    } else if (frame.k === MSG.bye) {
      const removed = String(frame.id ?? "");
      if (entities.delete(removed)) emit("entity-remove", { id: removed });
      altars.delete(removed);
      if (removed === targetId) setTarget(null);
    }
    else if (typeof frame.k === "string") emit(frame.k, frame);
  };

  const interpolate = (dtSeconds: number, options: { localRate?: number; remoteRate?: number } = {}): void => {
    const dt = Math.max(0, Number(dtSeconds) || 0);
    for (const entity of entities.values()) {
      if (typeof entity.tx !== "number" || typeof entity.x !== "number") continue;
      const rate = entity.id === localId ? options.localRate ?? 22 : options.remoteRate ?? 11;
      const k = 1 - Math.exp(-rate * dt);
      entity.x += (entity.tx - entity.x) * k;
      if (typeof entity.ty === "number" && typeof entity.y === "number") entity.y += (entity.ty - entity.y) * k;
      if (typeof entity.tz === "number" && typeof entity.z === "number") entity.z += (entity.tz - entity.z) * k;
      if (typeof entity.tyaw === "number" && typeof entity.yaw === "number") entity.yaw += shortAngle(entity.yaw, entity.tyaw) * k;
    }
  };

  return Object.freeze({
    on,
    emit,
    apply,
    me: () => entities.get(localId),
    get: (entryId) => entities.get(entryId),
    zone: (entryId) => zones.get(entryId),
    currentZone: () => myZone,
    target: () => targetId,
    setTarget,
    tick: () => latestTick,
    field: () => fieldGrid,
    settledness: () => settledness,
    inventory: () => inventoryView,
    altars: () => [...altars.values()],
    interpolate,
    inZone: () => [...entities.values()].filter((entity) => entity.zone === myZone),
    nameOf,
    entities: () => [...entities.values()],
    zones: () => [...zones.values()],
  });
}

export function applyWireText(view: WorldView, text: unknown): WireMessage | null {
  const message = decode(text);
  if (message) view.apply(message);
  return message;
}

export function sendJoin(socket: WebSocketLike, name: unknown): void {
  if (socket.readyState === 1) socket.send(encode(join(name)));
}

export function sendIntent(socket: WebSocketLike, seq: number, body: JsonRecord): void {
  if (socket.readyState === 1) socket.send(encode(intent(seq, body)));
}

export function sendInput(socket: WebSocketLike, seq: number, forward: unknown, strafe: unknown, yaw: unknown, attack: unknown): void {
  if (socket.readyState === 1) socket.send(encode(input(seq, forward, strafe, yaw, attack)));
}

export function createWebSocketGameClient(options: WebSocketGameClientOptions): RealtimeClient {
  const { socket, view } = options;
  socket.onopen = () => options.onState?.("open");
  socket.onclose = () => options.onState?.("disconnected");
  socket.onerror = () => options.onState?.("error");
  socket.onmessage = (event) => {
    const message = decode(event.data);
    if (!message) return;
    if (message.k === MSG.hello) {
      sendJoin(socket, options.name ?? "wanderer");
      options.onState?.("joining");
    } else {
      view.apply(message);
      if (message.k === MSG.snapshot) options.onState?.("playing");
    }
    options.onMessage?.(message);
  };
  return Object.freeze({
    view,
    close: () => socket.close?.(),
    sendIntent: (seq, body) => sendIntent(socket, seq, body),
    sendInput: (seq, forward, strafe, yaw, attack) => sendInput(socket, seq, forward, strafe, yaw, attack),
    resumeId: () => null,
  });
}

export function createSseGameClient(options: SseGameClientOptions): RealtimeClient {
  const { events, view } = options;
  const post = options.fetch ?? globalThis.fetch?.bind(globalThis);
  const replay = options.replayCursor ?? createReplayCursor();
  events.onopen = () => options.onState?.("open");
  events.onerror = () => options.onState?.("error");
  events.onmessage = (event) => {
    try {
      replay.mark((event as { lastEventId?: unknown }).lastEventId);
      const frame = JSON.parse(String(event.data)) as ClientFrame;
      view.apply(frame);
      options.onFrame?.(frame);
    } catch {
      // Bad event frames are ignored; the next server frame can resynchronize.
    }
  };
  const inertSocket: WebSocketLike = { readyState: 0, send() {} };
  return Object.freeze({
    view,
    close: () => { events.close(); options.onState?.("disconnected"); },
    resumeId: () => replay.current(),
    sendIntent: (_seq, body) => {
      if (!post) return;
      const request = actionRequest(options.actPath ?? "/act", { ...body, ...(options.actor ? { actor: options.actor } : {}) });
      void post(request.url, request.init);
    },
    sendInput: (seq, forward, strafe, yaw, attack) => {
      sendInput(inertSocket, seq, forward, strafe, yaw, attack);
      if (!post) return;
      const message = input(seq, forward, strafe, yaw, attack);
      const request = actionRequest(options.actPath ?? "/act", { ...message, ...(options.actor ? { actor: options.actor } : {}) });
      void post(request.url, request.init);
    },
  });
}

export function sseUrl(path = "/events", params: Record<string, string> = {}): string {
  const query = new URLSearchParams(compactParams(params)).toString();
  return query ? `${path}?${query}` : path;
}

export function wsUrl(path = "/ws", opts: { since?: ReplayCursor | number | string | null; params?: Record<string, string | number | boolean | null | undefined> } = {}): string {
  const params = { ...(opts.params ?? {}) };
  const since = opts.since && typeof opts.since === "object" && "current" in opts.since
    ? opts.since.current()
    : replayId(opts.since);
  if (since !== null) params.since = since;
  const query = new URLSearchParams(compactParams(params)).toString();
  return query ? `${path}?${query}` : path;
}

function compactParams(params: Record<string, string | number | boolean | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = String(value);
  }
  return out;
}

export function actionRequest(path: string, body: JsonRecord): { url: string; init: RequestInit } {
  return {
    url: path,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  };
}

export function directionForKey(key: unknown, keys: Readonly<Record<string, "n" | "s" | "w" | "e">> = DEFAULT_DIRECTION_KEYS): "n" | "s" | "w" | "e" | null {
  return typeof key === "string" ? keys[key] ?? null : null;
}

export function isTextEditingElement(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const element = value as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable === true;
}

export function defaultFoe(entity: ClientEntity): boolean {
  const kind = String(entity.kind ?? entity.type ?? "");
  const status = String(entity.status ?? "");
  return (kind === "monster" || kind === "foe" || kind === "enemy")
    && entity.aliveGlyph !== "f"
    && entity.aliveGlyph !== "⊥"
    && !["slain", "vanished", "ghost", "dead"].includes(status);
}

export function nearestEntity(view: WorldView, predicate: EntityPredicate, range = Number.POSITIVE_INFINITY): ClientEntity | null {
  const me = view.me();
  if (!me || !Number.isFinite(Number(me.x)) || !Number.isFinite(Number(me.z))) return null;
  const maxDistance = Math.max(0, Number(range) || 0);
  let best: ClientEntity | null = null;
  let bestDistance = maxDistance * maxDistance;
  for (const entity of view.inZone()) {
    if (entity.id === me.id || !predicate(entity)) continue;
    const dx = Number(entity.x) - Number(me.x);
    const dz = Number(entity.z) - Number(me.z);
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) continue;
    const distance = dx * dx + dz * dz;
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = entity;
    }
  }
  return best;
}

export function cycleTarget(view: WorldView, predicate: EntityPredicate = defaultFoe): ClientEntity | null {
  const candidates = view.inZone().filter((entity) => entity.id !== view.me()?.id && predicate(entity));
  if (!candidates.length) {
    view.setTarget(null);
    return null;
  }
  const current = view.target();
  const index = candidates.findIndex((entity) => entity.id === current);
  const next = candidates[(index + 1) % candidates.length] ?? candidates[0]!;
  view.setTarget(next.id);
  return next;
}

export function abilityAction(view: WorldView, abilityName: string, options: ActionBindingOptions = {}): ClientAction {
  const selfAbilities = new Set(options.selfAbilities ?? ["second-wind", "mend", "heal"]);
  const target = selfAbilities.has(abilityName)
    ? null
    : view.target() ?? nearestEntity(view, options.foe ?? defaultFoe, options.foeRange ?? 16)?.id ?? null;
  return {
    intent: { kind: "ability", ability: abilityName, target },
    emit: { event: "fx-cast", payload: { id: view.me()?.id, ability: abilityName } },
  };
}

export function pointMoveAction(x: unknown, z: unknown, precision = 2): ClientAction | null {
  const px = rounded(x, precision);
  const pz = rounded(z, precision);
  return px === null || pz === null ? null : { intent: { kind: "move", x: px, z: pz } };
}

export function entityPointerAction(view: WorldView, entityId: string, options: ActionBindingOptions = {}): ClientAction | null {
  const entity = view.get(entityId);
  if (!entity) return null;
  const foe = options.foe ?? defaultFoe;
  const item = options.item ?? ((entry: ClientEntity) => String(entry.kind ?? entry.type ?? "") === "item");
  const npc = options.npc ?? ((entry: ClientEntity) => String(entry.kind ?? entry.type ?? "") === "npc");
  if (foe(entity)) {
    view.setTarget(entity.id);
    return { intent: { kind: "attack", target: entity.id }, emit: { event: "fx-swing", payload: { id: view.me()?.id } } };
  }
  if (npc(entity)) return { emit: { event: "interact-npc", payload: { id: entity.id } } };
  if (item(entity)) return { intent: { kind: "pickup", item: entity.id } };
  return null;
}

export function actionForKey(key: unknown, view: WorldView, options: ActionBindingOptions = {}): ClientAction | null {
  const direction = directionForKey(key);
  if (direction) return { intent: { kind: "move", dir: direction }, preventDefault: true };
  if (typeof key !== "string") return null;
  if (key === "Enter") return { emit: { event: "focus-chat" } };
  if (key === "Escape") return { emit: { event: "close-panels" } };
  if (/^[1-9]$/.test(key)) {
    const ability = (options.abilities ?? DEFAULT_ACTION_ABILITIES)[Number(key) - 1];
    return ability ? abilityAction(view, ability, options) : null;
  }
  if (key === "Tab") {
    const target = cycleTarget(view, options.foe ?? defaultFoe);
    return { emit: { event: "target", payload: target?.id ?? null }, preventDefault: true };
  }
  if (key === "i" || key === "I") return { emit: { event: "toggle-panel", payload: "inventory" } };
  if (key === "c" || key === "C") return { emit: { event: "toggle-panel", payload: "character" } };
  if (key === "g" || key === "G") {
    const item = nearestEntity(view, options.item ?? ((entry) => String(entry.kind ?? entry.type ?? "") === "item"), options.itemRange ?? 5);
    return item ? { intent: { kind: "pickup", item: item.id }, emit: { event: "toast", payload: `grab ${view.nameOf(item.id)}` } } : null;
  }
  if (key === "f" || key === "F") {
    const npc = nearestEntity(view, options.npc ?? ((entry) => String(entry.kind ?? entry.type ?? "") === "npc"), options.npcRange ?? 6);
    return npc ? { emit: { event: "interact-npc", payload: { id: npc.id } } } : null;
  }
  if (key === "e" || key === "E") {
    const currentZone = view.currentZone();
    const zone = currentZone ? view.zone(currentZone) : undefined;
    const dir = (options.portalDir ?? firstExit)(zone);
    return dir ? { intent: { kind: "portal", dir }, emit: { event: "toast", payload: `go ${dir}` } } : null;
  }
  if (key === "r" || key === "R") {
    const status = String(view.me()?.status ?? "");
    return status === "ghost" ? { intent: { kind: "respawn" } } : null;
  }
  return null;
}

export function applyClientAction(action: ClientAction | null, send: (intent: JsonRecord) => void, emit?: (event: string, payload?: unknown) => void): boolean {
  if (!action) return false;
  if (action.intent) send(action.intent);
  if (action.emit) emit?.(action.emit.event, action.emit.payload);
  return Boolean(action.intent || action.emit);
}

export function vitalBar(entity: ClientEntity | undefined, currentKey: string, maxKey: string): VitalBar {
  const current = Math.max(0, finiteNumber(entity?.[currentKey]) ?? 0);
  const max = Math.max(0, finiteNumber(entity?.[maxKey]) ?? current);
  const denominator = max > 0 ? max : current > 0 ? current : 1;
  const fraction = Math.max(0, Math.min(1, current / denominator));
  return Object.freeze({
    current,
    max,
    fraction,
    label: max > 0 ? `${Math.round(current)} / ${Math.round(max)}` : `${Math.round(current)}`,
  });
}

export function healthBar(entity: ClientEntity | undefined): VitalBar {
  const currentKey = entity && "health" in entity ? "health" : "hp";
  const maxKey = entity && "maxHealth" in entity ? "maxHealth" : "maxHp";
  return vitalBar(entity, currentKey, maxKey);
}

export function staminaBar(entity: ClientEntity | undefined): VitalBar {
  return vitalBar(entity, "stamina", "maxStamina");
}

export function statusTags(entity: ClientEntity | undefined): readonly string[] {
  if (!entity) return Object.freeze([]);
  const tags = new Set<string>();
  const status = String(entity.status ?? "");
  const alive = String(entity.aliveGlyph ?? "");
  const form = String(entity.formGlyph ?? "");
  const formName = String(entity.form ?? "");
  if (status && status !== "up") tags.add(status);
  if (alive === "⊤") tags.add("undead");
  if (alive === "f" || alive === "⊥") tags.add("dead");
  if (form === "⊤") tags.add("contested-form");
  if (formName && formName !== "flesh") tags.add(formName);
  return Object.freeze([...tags].sort());
}

export function effectViews(entity: ClientEntity | undefined, tick = 0): readonly EffectView[] {
  const effects = entity?.effects;
  if (!Array.isArray(effects)) return Object.freeze([]);
  const out: EffectView[] = [];
  for (const effect of effects) {
    if (typeof effect === "string") {
      out.push(Object.freeze({ name: effect }));
      continue;
    }
    if (!effect || typeof effect !== "object") continue;
    const record = effect as { name?: unknown; until?: unknown };
    if (typeof record.name !== "string" || !record.name) continue;
    const until = finiteNumber(record.until);
    const view: { name: string; until?: number; remaining?: number } = { name: record.name };
    if (until !== null) {
      view.until = until;
      view.remaining = Math.max(0, Math.ceil(until - tick));
    }
    out.push(Object.freeze(view));
  }
  return Object.freeze(out);
}

export function partyEntities(view: WorldView): readonly ClientEntity[] {
  const me = view.me();
  const party = me?.party;
  if (!me || party === undefined || party === null || party === "") return Object.freeze([]);
  return Object.freeze(view.inZone()
    .filter((entity) => entity.id !== me.id && entity.party === party)
    .sort((left, right) => view.nameOf(left.id).localeCompare(view.nameOf(right.id))));
}

export function entityHud(entity: ClientEntity | undefined, tick = 0): EntityHudView | null {
  if (!entity) return null;
  return Object.freeze({
    id: entity.id,
    name: String(entity.name ?? entity.id),
    level: Math.max(1, Math.trunc(finiteNumber(entity.level) ?? 1)),
    health: healthBar(entity),
    stamina: staminaBar(entity),
    tags: statusTags(entity),
    effects: effectViews(entity, tick),
    entity,
  });
}

export function questView(entity: ClientEntity | undefined): QuestView | null {
  const bounty = entity?.bounty;
  if (!bounty || typeof bounty !== "object") return null;
  const record = bounty as { id?: unknown; name?: unknown; target?: unknown; done?: unknown; goal?: unknown };
  const name = typeof record.name === "string" && record.name ? record.name : typeof record.target === "string" ? record.target : "";
  if (!name) return null;
  const done = finiteNumber(record.done);
  const goal = finiteNumber(record.goal);
  const out: { id?: string; name: string; progress?: string } = { name };
  if (typeof record.id === "string" && record.id) out.id = record.id;
  if (done !== null && goal !== null) out.progress = `${Math.trunc(done)} / ${Math.trunc(goal)}`;
  return Object.freeze(out);
}

export function hudModel(view: WorldView): HudModel {
  const tick = view.tick();
  const me = view.me();
  const target = view.target();
  const zoneId = view.currentZone();
  return Object.freeze({
    tick,
    zone: zoneId ? view.zone(zoneId) ?? null : null,
    self: entityHud(me, tick),
    target: target ? entityHud(view.get(target), tick) : null,
    party: Object.freeze(partyEntities(view).map((entity) => entityHud(entity, tick)).filter((entity): entity is EntityHudView => entity !== null)),
    inventory: view.inventory(),
    quest: questView(me),
    event: typeof me?.event === "string" && me.event ? me.event : null,
  });
}

type NormalizedInterpolationFrame = Readonly<{
  full: boolean;
  tick: number;
  entities: readonly ClientEntity[];
  removed: readonly string[];
}>;

function normalizeInterpolationFrame(frame: ClientFrame): NormalizedInterpolationFrame | null {
  if (frame.type === "full") {
    return Object.freeze({
      full: true,
      tick: Math.max(0, Math.trunc(finiteNumber(frame.tick) ?? 0)),
      entities: clientEntities(frame.entities).map(cloneEntity),
      removed: Object.freeze([]),
    });
  }
  if (frame.type === "delta") {
    return Object.freeze({
      full: false,
      tick: Math.max(0, Math.trunc(finiteNumber(frame.tick) ?? 0)),
      entities: clientEntities(frame.entities).map(cloneEntity),
      removed: Object.freeze(stringList(frame.removed)),
    });
  }
  if (frame.k === MSG.snapshot) {
    return Object.freeze({
      full: true,
      tick: Math.max(0, Math.trunc(finiteNumber(frame.tick) ?? 0)),
      entities: clientEntities(frame.e).map(cloneEntity),
      removed: Object.freeze([]),
    });
  }
  if (frame.k === MSG.delta) {
    return Object.freeze({
      full: false,
      tick: Math.max(0, Math.trunc(finiteNumber(frame.tick) ?? 0)),
      entities: clientEntities(frame.c).map(cloneEntity),
      removed: Object.freeze(stringList(frame.g)),
    });
  }
  return null;
}

function freezeEntities(entities: readonly ClientEntity[]): readonly ClientEntity[] {
  return Object.freeze(entities.map(cloneEntity));
}

function cloneEntity(entity: ClientEntity): ClientEntity {
  return { ...entity };
}

function interpolateSamples(left: InterpolationSample, right: InterpolationSample, renderTimeMs: number): readonly ClientEntity[] {
  const span = Math.max(1, right.timeMs - left.timeMs);
  const alpha = Math.max(0, Math.min(1, (renderTimeMs - left.timeMs) / span));
  const leftById = entitiesById(left.entities);
  const rightById = entitiesById(right.entities);
  const ids = new Set([...leftById.keys(), ...rightById.keys()]);
  const out: ClientEntity[] = [];
  for (const id of ids) {
    const before = leftById.get(id);
    const after = rightById.get(id);
    if (before && after) {
      out.push(interpolateEntity(before, after, alpha));
    } else if (after) {
      out.push(cloneEntity(after));
    } else if (before && alpha < 1) {
      out.push(cloneEntity(before));
    }
  }
  return Object.freeze(out);
}

function extrapolateSamples(left: InterpolationSample, right: InterpolationSample, renderTimeMs: number): readonly ClientEntity[] {
  const span = Math.max(1, right.timeMs - left.timeMs);
  const alpha = Math.max(1, (renderTimeMs - left.timeMs) / span);
  const leftById = entitiesById(left.entities);
  const out: ClientEntity[] = [];
  for (const entity of right.entities) {
    const before = leftById.get(entity.id);
    out.push(before ? interpolateEntity(before, entity, alpha) : cloneEntity(entity));
  }
  return Object.freeze(out);
}

function entitiesById(entities: readonly ClientEntity[]): Map<string, ClientEntity> {
  const out = new Map<string, ClientEntity>();
  for (const entity of entities) out.set(entity.id, entity);
  return out;
}

function interpolateEntity(left: ClientEntity, right: ClientEntity, alpha: number): ClientEntity {
  const out = { ...left, ...right };
  interpolateNumber(out, "x", left, right, alpha);
  interpolateNumber(out, "y", left, right, alpha);
  interpolateNumber(out, "z", left, right, alpha);
  interpolateAngle(out, "yaw", left, right, alpha);
  const x = finiteNumber(out.x);
  const y = finiteNumber(out.y);
  const z = finiteNumber(out.z);
  const yaw = finiteNumber(out.yaw);
  if (x !== null) out.tx = x;
  if (y !== null) out.ty = y;
  if (z !== null) out.tz = z;
  if (yaw !== null) out.tyaw = yaw;
  return out;
}

function interpolateNumber(out: ClientEntity, key: "x" | "y" | "z", left: ClientEntity, right: ClientEntity, alpha: number): void {
  const a = finiteNumber(left[key]);
  const b = finiteNumber(right[key]);
  if (a !== null && b !== null) out[key] = a + (b - a) * alpha;
}

function interpolateAngle(out: ClientEntity, key: "yaw", left: ClientEntity, right: ClientEntity, alpha: number): void {
  const a = finiteNumber(left[key]);
  const b = finiteNumber(right[key]);
  if (a !== null && b !== null) out[key] = a + shortAngle(a, b) * alpha;
}

function connectionState(
  positiveEvidence: boolean,
  negativeEvidence: boolean,
  attempts: number,
  maxAttempts: number,
  staleMs: number,
  lastHeartbeatAtMs: number | null,
  atMs: number,
): RealtimeConnectionState {
  if (attempts >= maxAttempts && negativeEvidence) return "exhausted";
  if (positiveEvidence && negativeEvidence) return "contested";
  if (negativeEvidence) return "down";
  if (positiveEvidence) {
    if (lastHeartbeatAtMs !== null && staleMs > 0 && atMs - lastHeartbeatAtMs > staleMs) return "stale";
    return "up";
  }
  return "unknown";
}

function errorText(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Error) return value.message || value.name;
  return String(value);
}

function mergeEntity(prev: ClientEntity | undefined, next: ClientEntity, snap: boolean): ClientEntity {
  if (!prev) {
    const out = { ...next };
    const x = finiteNumber(next.x);
    const y = finiteNumber(next.y);
    const z = finiteNumber(next.z);
    const yaw = finiteNumber(next.yaw);
    if (x !== null) { out.x = x; out.tx = x; }
    if (y !== null) { out.y = y; out.ty = y; }
    if (z !== null) { out.z = z; out.tz = z; }
    if (yaw !== null) { out.yaw = yaw; out.tyaw = yaw; }
    return out;
  }
  const out = { ...prev, ...next };
  const x = finiteNumber(next.x);
  const y = finiteNumber(next.y);
  const z = finiteNumber(next.z);
  const yaw = finiteNumber(next.yaw);
  if (x !== null) { out.tx = x; if (snap) out.x = x; else if (prev.x !== undefined) out.x = prev.x; else delete out.x; }
  if (y !== null) { out.ty = y; if (snap) out.y = y; else if (prev.y !== undefined) out.y = prev.y; else delete out.y; }
  if (z !== null) { out.tz = z; if (snap) out.z = z; else if (prev.z !== undefined) out.z = prev.z; else delete out.z; }
  if (yaw !== null) { out.tyaw = yaw; if (snap) out.yaw = yaw; else if (prev.yaw !== undefined) out.yaw = prev.yaw; else delete out.yaw; }
  return out;
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isDead(entity: ClientEntity): boolean {
  const status = String(entity.status ?? "");
  return entity.aliveGlyph === "f" || entity.aliveGlyph === "⊥" || ["slain", "vanished", "ghost", "dead"].includes(status);
}

function gainedEffects(prev: unknown, next: unknown): string[] {
  const prevNames = new Set(effectNames(prev));
  return effectNames(next).filter((name) => !prevNames.has(name));
}

function effectNames(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
      if (entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string") return [(entry as { name: string }).name];
      if (typeof entry === "string") return [entry];
      return [];
    })
    : [];
}

function decodeField(message: WireMessage): FieldGrid | null {
  const dim = Number(message.dim);
  const q = String(message.q ?? "");
  if (!Number.isSafeInteger(dim) || dim <= 0 || q.length < dim * dim) return null;
  const values = new Float32Array(dim * dim);
  for (let index = 0; index < values.length; index++) {
    const code = q.charCodeAt(index) - 48;
    values[index] = Math.max(0, Math.min(9, code)) / 9;
  }
  return { dim, values };
}

function shortAngle(a: number, b: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function rounded(value: unknown, places: number): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

function firstExit(zone: ClientEntity | undefined): string | null {
  const exits = zone?.exits;
  if (!exits || typeof exits !== "object" || Array.isArray(exits)) return null;
  return Object.keys(exits)[0] ?? null;
}
