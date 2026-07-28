import { jsonRepr, readFormBody, type App, type Repr } from "@red-cup-engineering/computing-with-http/app";
import {
  authorizeBearer,
  type AuthDecision,
  type TokenPolicy,
} from "../sync-guard/index.mjs";

export type MicrosubChannel = Readonly<{
  uid: string;
  name: string;
  unread?: number;
  source?: string;
}>;

export type MicrosubAuthor = Readonly<{
  name?: string;
  url?: string;
  photo?: string;
}>;

export type MicrosubEntry = Readonly<{
  uid: string;
  url?: string;
  name?: string;
  content?: string;
  summary?: string;
  published?: string;
  updated?: string;
  author?: MicrosubAuthor;
  read?: boolean;
  starred?: boolean;
  channel?: string;
  category?: readonly string[];
  properties?: Readonly<Record<string, unknown>>;
}>;

export type MicrosubTimeline = Readonly<{
  items: readonly MicrosubEntry[];
  paging?: Readonly<{
    before?: string;
    after?: string;
  }>;
}>;

export type MicrosubStore = Readonly<{
  channels: (auth: AuthDecision) => readonly MicrosubChannel[] | Promise<readonly MicrosubChannel[]>;
  timeline: (request: MicrosubTimelineRequest, auth: AuthDecision) => MicrosubTimeline | Promise<MicrosubTimeline>;
  search?: (request: MicrosubSearchRequest, auth: AuthDecision) => MicrosubTimeline | Promise<MicrosubTimeline>;
  markRead?: (request: MicrosubMutationRequest, auth: AuthDecision) => MicrosubMutationResult | Promise<MicrosubMutationResult>;
  markUnread?: (request: MicrosubMutationRequest, auth: AuthDecision) => MicrosubMutationResult | Promise<MicrosubMutationResult>;
  markStarred?: (request: MicrosubMutationRequest, auth: AuthDecision) => MicrosubMutationResult | Promise<MicrosubMutationResult>;
  markUnstarred?: (request: MicrosubMutationRequest, auth: AuthDecision) => MicrosubMutationResult | Promise<MicrosubMutationResult>;
}>;

export type MicrosubTimelineRequest = Readonly<{
  channel: string;
  before?: string;
  after?: string;
  limit: number;
}>;

export type MicrosubSearchRequest = Readonly<{
  query: string;
  channel?: string;
  limit: number;
}>;

export type MicrosubMutationRequest = Readonly<{
  channel?: string;
  entry: readonly string[];
}>;

export type MicrosubMutationResult = Readonly<{
  updated: number;
}>;

export type MicrosubAppOptions = Readonly<{
  store: MicrosubStore;
  path?: string;
  tokens?: TokenPolicy;
  maxBodyBytes?: number;
  defaultLimit?: number;
  maxLimit?: number;
}>;

export type MicrosubQuery =
  | "config"
  | "channels"
  | "timeline"
  | "search"
  | "source";

function positiveLimit(value: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function optional(value: string | null): string | undefined {
  return value === null || value === "" ? undefined : value;
}

function timelineRequest(params: URLSearchParams, defaultLimit: number, maxLimit: number): MicrosubTimelineRequest {
  const channel = params.get("channel") || "default";
  const out: {
    channel: string;
    before?: string;
    after?: string;
    limit: number;
  } = {
    channel,
    limit: positiveLimit(params.get("limit"), defaultLimit, maxLimit),
  };
  const before = optional(params.get("before"));
  const after = optional(params.get("after"));
  if (before !== undefined) out.before = before;
  if (after !== undefined) out.after = after;
  return Object.freeze(out);
}

function searchRequest(params: URLSearchParams, defaultLimit: number, maxLimit: number): MicrosubSearchRequest {
  const query = params.get("search") ?? params.get("query") ?? "";
  if (!query) throw new TypeError("search query is required");
  const out: {
    query: string;
    channel?: string;
    limit: number;
  } = {
    query,
    limit: positiveLimit(params.get("limit"), defaultLimit, maxLimit),
  };
  const channel = optional(params.get("channel"));
  if (channel !== undefined) out.channel = channel;
  return Object.freeze(out);
}

function entryList(form: URLSearchParams): readonly string[] {
  const entries = form.getAll("entry").filter(Boolean);
  const single = form.get("url") ?? form.get("uid");
  return Object.freeze(entries.length ? entries : single ? [single] : []);
}

export function mutationRequest(form: URLSearchParams): MicrosubMutationRequest {
  const entry = entryList(form);
  if (entry.length === 0) throw new TypeError("entry is required");
  const out: {
    channel?: string;
    entry: readonly string[];
  } = { entry };
  const channel = optional(form.get("channel"));
  if (channel !== undefined) out.channel = channel;
  return Object.freeze(out);
}

export function normalizeEntry(entry: MicrosubEntry): MicrosubEntry {
  if (!entry.uid) throw new TypeError("entry.uid is required");
  const out: {
    uid: string;
    url?: string;
    name?: string;
    content?: string;
    summary?: string;
    published?: string;
    updated?: string;
    author?: MicrosubAuthor;
    read?: boolean;
    starred?: boolean;
    channel?: string;
    category?: readonly string[];
    properties?: Readonly<Record<string, unknown>>;
  } = { uid: entry.uid };
  if (entry.url !== undefined) out.url = entry.url;
  if (entry.name !== undefined) out.name = entry.name;
  if (entry.content !== undefined) out.content = entry.content;
  if (entry.summary !== undefined) out.summary = entry.summary;
  if (entry.published !== undefined) out.published = entry.published;
  if (entry.updated !== undefined) out.updated = entry.updated;
  if (entry.author !== undefined) out.author = Object.freeze({ ...entry.author });
  if (entry.read !== undefined) out.read = entry.read;
  if (entry.starred !== undefined) out.starred = entry.starred;
  if (entry.channel !== undefined) out.channel = entry.channel;
  if (entry.category !== undefined) out.category = Object.freeze([...entry.category]);
  if (entry.properties !== undefined) out.properties = Object.freeze({ ...entry.properties });
  return Object.freeze(out);
}

export function timeline(items: readonly MicrosubEntry[], opts: {
  before?: string;
  after?: string;
  limit?: number;
} = {}): MicrosubTimeline {
  const sorted = [...items].map(normalizeEntry).sort((left, right) => {
    const leftRank = left.updated ?? left.published ?? "";
    const rightRank = right.updated ?? right.published ?? "";
    return leftRank === rightRank ? left.uid.localeCompare(right.uid) : rightRank.localeCompare(leftRank);
  });
  const start = opts.after ? sorted.findIndex((item) => item.uid === opts.after) + 1 : 0;
  const clipped = sorted.slice(Math.max(0, start));
  const beforeIndex = opts.before ? clipped.findIndex((item) => item.uid === opts.before) : -1;
  const bounded = beforeIndex >= 0 ? clipped.slice(0, beforeIndex) : clipped;
  const limit = opts.limit ?? 20;
  const page = bounded.slice(0, limit);
  const paging: { before?: string; after?: string } = {};
  if (page.length > 0 && bounded.length > limit) paging.after = page[page.length - 1]!.uid;
  if (opts.after) paging.before = opts.after;
  return Object.freeze({
    items: Object.freeze(page),
    ...(Object.keys(paging).length ? { paging: Object.freeze(paging) } : {}),
  });
}

function repr(status: number, body: unknown, headers: Record<string, string> = {}): Repr {
  return jsonRepr(body, { status, headers, pretty: true, cacheControl: { noStore: true } });
}

async function readForm(ctx: Parameters<NonNullable<App["resources"]>[number]["handler"]>[0], maxBodyBytes: number): Promise<URLSearchParams> {
  return readFormBody(ctx.req, { maxBytes: maxBodyBytes });
}

function actionHandler(action: string, store: MicrosubStore): MicrosubStore["markRead"] | undefined {
  if (action === "mark_read") return store.markRead;
  if (action === "mark_unread") return store.markUnread;
  if (action === "mark_starred") return store.markStarred;
  if (action === "mark_unstarred") return store.markUnstarred;
  return undefined;
}

export function microsubApp(options: MicrosubAppOptions): App {
  const path = options.path ?? "/microsub";
  const defaultLimit = options.defaultLimit ?? 20;
  const maxLimit = options.maxLimit ?? 100;
  const maxBodyBytes = options.maxBodyBytes ?? 64_000;
  return {
    resources: [
      {
        id: "microsub.endpoint",
        name: "Microsub Endpoint",
        route: path,
        match: path,
        methods: ["GET", "POST"],
        produces: ["application/json"],
        handler: async (ctx) => {
          const auth = authorizeBearer(ctx.req.headers, options.tokens);
          if (!auth.ok) {
            return repr(auth.status, { error: auth.reason }, auth.status === 401 ? { "WWW-Authenticate": "Bearer" } : {});
          }

          try {
            if (ctx.req.method === "GET") {
              const q = (ctx.url.searchParams.get("q") ?? "channels") as MicrosubQuery;
              if (q === "config") {
                return repr(200, { channels: true, timeline: true, search: Boolean(options.store.search), actions: ["mark_read", "mark_unread", "mark_starred", "mark_unstarred"] });
              }
              if (q === "channels") {
                return repr(200, { channels: await options.store.channels(auth) });
              }
              if (q === "timeline") {
                return repr(200, await options.store.timeline(timelineRequest(ctx.url.searchParams, defaultLimit, maxLimit), auth));
              }
              if (q === "search" && options.store.search) {
                return repr(200, await options.store.search(searchRequest(ctx.url.searchParams, defaultLimit, maxLimit), auth));
              }
              return repr(400, { error: "unsupported_query" });
            }

            const form = await readForm(ctx, maxBodyBytes);
            const action = form.get("action") ?? "";
            const handler = actionHandler(action, options.store);
            if (!handler) {
              return repr(400, { error: "unsupported_action" });
            }
            return repr(200, await handler(mutationRequest(form), auth));
          } catch (error) {
            return repr(400, { error: error instanceof Error ? error.message : String(error) });
          }
        },
      },
    ],
  };
}
