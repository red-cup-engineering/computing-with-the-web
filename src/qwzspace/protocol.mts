export const PROTOCOL_VERSION = 1;

export const MSG = Object.freeze({
  hello: "hello",
  join: "join",
  intent: "intent",
  input: "input",
  snapshot: "snapshot",
  delta: "delta",
  event: "event",
  chat: "chat",
  combat: "combat",
  codex: "codex",
  field: "field",
  speak: "speak",
  said: "said",
  settle: "settle",
  power: "power",
  trade: "trade",
  inventory: "inventory",
  parley: "parley",
  move: "move",
  dispute: "dispute",
  claim: "claim",
  altar: "altar",
  bye: "bye",
});

export type JsonRecord = Record<string, unknown>;
export type WireMessage = JsonRecord & { k: string };

export function hello(idValue: string | null, world: unknown = null): WireMessage {
  return { k: MSG.hello, v: PROTOCOL_VERSION, id: idValue, world };
}

export function snapshot(tick: number, you: string | null, entries: readonly unknown[]): WireMessage {
  return { k: MSG.snapshot, tick, you, e: entries };
}

export function delta(tick: number, ack: number, changed: readonly unknown[], gone: readonly string[]): WireMessage {
  return { k: MSG.delta, tick, ack: ack | 0, c: changed, g: gone };
}

export function event(type: string, payload: JsonRecord = {}): WireMessage {
  return { k: MSG.event, t: String(type), ...payload };
}

export function chat(from: unknown, line: unknown): WireMessage {
  return event("chat", { from, line: String(line).slice(0, 200) });
}

export function bye(idValue: unknown): WireMessage {
  return { k: MSG.bye, id: idValue };
}

export function join(name?: unknown): WireMessage {
  return { k: MSG.join, name: String(name ?? "wanderer").slice(0, 24) || "wanderer" };
}

export function intent(seq: unknown, body: JsonRecord): WireMessage {
  return { k: MSG.intent, seq: Number(seq) | 0, ...body };
}

export function input(seq: unknown, forward: unknown, strafe: unknown, yaw: unknown, attack: unknown): WireMessage {
  return {
    k: MSG.input,
    seq: Number(seq) | 0,
    f: clampAxis(forward),
    s: clampAxis(strafe),
    y: Number.isFinite(Number(yaw)) ? Number(yaw) : 0,
    a: attack ? 1 : 0,
  };
}

export function view(entry: JsonRecord): JsonRecord & { id: unknown } {
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    x: round(entry.x, 2),
    y: round(entry.y, 2),
    z: round(entry.z, 2),
    yaw: round(entry.yaw, 3),
    hp: entry.hp,
    maxHp: entry.maxHp,
    charge: entry.charge,
    ...(entry.marks !== undefined ? { marks: entry.marks } : {}),
    ...(entry.worth !== undefined ? { worth: entry.worth } : {}),
  };
}

export function combat(tick: unknown, attacker: unknown, target: unknown, amount: unknown, outcome: unknown): WireMessage {
  return { k: MSG.combat, tick: Number(tick) | 0, at: attacker, tg: target, dmg: Number(amount) || 0, out: outcome };
}

export function chatLine(from: unknown, line: unknown): WireMessage {
  return { k: MSG.chat, from, line: String(line).slice(0, 200) };
}

export function codex(glyph: unknown): WireMessage {
  return { k: MSG.codex, glyph };
}

export function speak(force: unknown, targetId: unknown = null): WireMessage {
  return { k: MSG.speak, force: String(force), tg: targetId ?? null };
}

export function said(from: unknown, force: unknown, glyph: unknown, x: unknown, z: unknown): WireMessage {
  return { k: MSG.said, from, force: String(force), glyph, x: round(x, 2), z: round(z, 2) };
}

export function field(grid: { dim: number; q: string }, settledness = 0): WireMessage {
  return { k: MSG.field, dim: grid.dim | 0, q: String(grid.q), s: round(settledness, 3) };
}

export function settle(): WireMessage {
  return { k: MSG.settle };
}

export function power(key: unknown, targetId: unknown = null): WireMessage {
  return { k: MSG.power, power: String(key), tg: targetId ?? null };
}

export function trade(op: unknown, to: unknown, offer: unknown = null, ask: unknown = null): WireMessage {
  return {
    k: MSG.trade,
    op: String(op),
    to: to ?? null,
    ...(offer ? { offer } : {}),
    ...(ask ? { ask } : {}),
  };
}

export function inventory(items: unknown, marks: unknown, worth: unknown): WireMessage {
  return { k: MSG.inventory, items: Array.isArray(items) ? items : [], marks: Number(marks) | 0, worth: Number(worth) | 0 };
}

export function parley(targetId: unknown): WireMessage {
  return { k: MSG.parley, tg: targetId ?? null };
}

export function move(force: unknown): WireMessage {
  return { k: MSG.move, force: String(force) };
}

export function dispute(payload: JsonRecord): WireMessage {
  return { k: MSG.dispute, ...payload };
}

export function claim(force: unknown, altarId: unknown = null): WireMessage {
  return { k: MSG.claim, force: String(force), altar: altarId ?? null };
}

export function altar(id: unknown, glyph: unknown, pos: unknown, neg: unknown, state: unknown, x: unknown, z: unknown): WireMessage {
  return { k: MSG.altar, id, glyph, pos: Number(pos) | 0, neg: Number(neg) | 0, state, x: round(x, 2), z: round(z, 2) };
}

export function encode(message: unknown): string {
  return JSON.stringify(message);
}

export function decode(text: unknown): WireMessage | null {
  try {
    const parsed = JSON.parse(String(text)) as unknown;
    return parsed && typeof parsed === "object" && typeof (parsed as { k?: unknown }).k === "string"
      ? parsed as WireMessage
      : null;
  } catch {
    return null;
  }
}

function clampAxis(value: unknown): number {
  const n = Number(value);
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

function round(value: unknown, places: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}
