/** Web-owned Triple Pattern Fragments received from emsenn/web-triple-pattern-fragments,
 * original source 14a3ac30. EAVT and RDF testimony come from their current owners,
 * never from the former @561-group local memetics world. */
import type { App, Repr } from "@red-cup-engineering/computing-with-http/app";
import { linkHeader } from "@red-cup-engineering/computing-with-http/codecs/http";
import { readingTurtle } from "@red-cup-engineering/computer-triplet-serialized-content-engineering-services-section/reading-rdf";

/** Native, already-folded EAVT testimony: the two witness sides stay separate. */
export type FoldedEvidence = Readonly<{
  entity: string;
  fiber: readonly Readonly<{
    predicate: string;
    object: unknown;
    value?: Readonly<{ evidence?: readonly [readonly string[], readonly string[]] }>;
  }>[];
}>;

export type TripleState = "potential" | "active" | "stable";
export type WitnessValue = string | readonly string[] | null;

export type TripleRecord = Readonly<{
  subject: string;
  predicate: string;
  object: unknown;
  state: TripleState;
  witness: WitnessValue;
  claimedBy?: WitnessValue;
  contraryClaimedBy?: WitnessValue;
}>;

export type TriplePattern = Readonly<{
  s?: string;
  p?: string;
  o?: string;
  state?: TripleState;
  witness?: string;
}>;

export type PageOptions = Readonly<{
  page?: number;
  limit?: number;
  maxLimit?: number;
}>;

export type FragmentOptions = PageOptions & Readonly<{
  base?: string;
  path?: string;
}>;

export type FragmentPage = Readonly<{
  query: Required<PageOptions> & TriplePattern;
  totalItems: number;
  totalPages: number;
  page: number;
  limit: number;
  triples: readonly TripleRecord[];
  links: Readonly<{
    self: string;
    first: string;
    last: string;
    previous?: string;
    next?: string;
  }>;
}>;

export type TpfAppOptions = FragmentOptions & Readonly<{
  source: readonly FoldedEvidence[] | (() => readonly FoldedEvidence[] | Promise<readonly FoldedEvidence[]>);
  paths?: {
    query?: string;
  };
}>;

const DEFAULT_LIMIT = 200;
const DEFAULT_MAX_LIMIT = 1000;
const JSON_TYPE = "application/json; charset=utf-8";
const JSONLD_TYPE = "application/ld+json; charset=utf-8";
const TURTLE_TYPE = "text/turtle; charset=utf-8";

/** Projection, not a second evidence algebra: absent, for, against and both
 * witness sides respectively yield absent, potential, active, stable readings. */
const witnessed = (items: readonly string[]): WitnessValue =>
  items.length === 0 ? null : items.length === 1 ? items[0]! : Object.freeze([...items]);

export function allTriples(folds: readonly FoldedEvidence[]): readonly TripleRecord[] {
  const out: TripleRecord[] = [];
  for (const folded of folds) {
    for (const entry of folded.fiber) {
      const sides = entry.value?.evidence ?? [[], []] as const;
      const positive = Object.freeze([...new Set(sides[0])]);
      const negative = Object.freeze([...new Set(sides[1])]);
      if (positive.some((value) => typeof value !== "string" || value.trim() === "")
          || negative.some((value) => typeof value !== "string" || value.trim() === "")) {
        throw new TypeError("fragment projection requires valid EAVT evidence witnesses");
      }
      if (positive.length === 0 && negative.length === 0) continue;
      const state: TripleState = positive.length > 0
        ? negative.length > 0 ? "stable" : "potential"
        : "active";
      const claimedBy = witnessed(positive);
      const contraryClaimedBy = witnessed(negative);
      out.push(Object.freeze({
        subject: folded.entity, predicate: entry.predicate, object: entry.object,
        state,
        witness: state === "stable"
          ? Object.freeze([...positive, ...negative])
          : state === "potential" ? claimedBy : contraryClaimedBy,
        ...(claimedBy !== null ? { claimedBy } : {}),
        ...(contraryClaimedBy !== null ? { contraryClaimedBy } : {}),
      }));
    }
  }
  return Object.freeze(out.sort((left, right) =>
    JSON.stringify([left.subject, left.predicate, left.object, left.state])
      .localeCompare(JSON.stringify([right.subject, right.predicate, right.object, right.state]))));
}

function witnessItems(value: WitnessValue | undefined): readonly string[] {
  if (value == null) return [];
  return typeof value === "string" ? [value] : [...value];
}

function witnessMatches(record: TripleRecord, wanted: string): boolean {
  return witnessItems(record.witness).includes(wanted)
    || witnessItems(record.claimedBy).includes(wanted)
    || witnessItems(record.contraryClaimedBy).includes(wanted);
}

export function tripleMatches(record: TripleRecord, pattern: TriplePattern = {}): boolean {
  if (pattern.s && record.subject !== pattern.s) return false;
  if (pattern.p && record.predicate !== pattern.p) return false;
  if (pattern.o && String(record.object) !== pattern.o) return false;
  if (pattern.state && record.state !== pattern.state) return false;
  if (pattern.witness && !witnessMatches(record, pattern.witness)) return false;
  return true;
}

export function queryTriples(folds: readonly FoldedEvidence[], pattern: TriplePattern = {}, opts: FragmentOptions = {}): FragmentPage {
  const limit = clampLimit(opts.limit, opts.maxLimit);
  const matched = allTriples(folds).filter((record) => tripleMatches(record, pattern));
  const totalItems = matched.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const page = clampPage(opts.page, totalPages);
  const start = (page - 1) * limit;
  const triples = Object.freeze(matched.slice(start, start + limit));
  const base = opts.base ?? "http://localhost/";
  const path = opts.path ?? "/query";
  return Object.freeze({
    query: Object.freeze({
      page,
      limit,
      maxLimit: opts.maxLimit ?? DEFAULT_MAX_LIMIT,
      ...pattern,
    }),
    totalItems,
    totalPages,
    page,
    limit,
    triples,
    links: pageLinks(base, path, pattern, page, limit, totalPages),
  });
}

function clampLimit(limit: number | undefined, maxLimit = DEFAULT_MAX_LIMIT): number {
  if (!Number.isSafeInteger(maxLimit) || maxLimit <= 0) {
    throw new TypeError("maxLimit must be a positive safe integer");
  }
  const requested = limit === undefined || !Number.isSafeInteger(limit) || limit <= 0
    ? DEFAULT_LIMIT : limit;
  return Math.min(requested, maxLimit);
}

function clampPage(page: number | undefined, totalPages: number): number {
  if (page === undefined || !Number.isSafeInteger(page) || page <= 0) return 1;
  return Math.min(page, totalPages);
}

function pageLinks(
  base: string,
  path: string,
  pattern: TriplePattern,
  page: number,
  limit: number,
  totalPages: number,
): FragmentPage["links"] {
  const at = (target: number): string => {
    const url = new URL(path, base);
    for (const [key, value] of Object.entries(pattern)) {
      if (value) url.searchParams.set(key, String(value));
    }
    url.searchParams.set("page", String(target));
    url.searchParams.set("limit", String(limit));
    return url.href;
  };
  return Object.freeze({
    self: at(page),
    first: at(1),
    last: at(totalPages),
    ...(page > 1 ? { previous: at(page - 1) } : {}),
    ...(page < totalPages ? { next: at(page + 1) } : {}),
  });
}

export function fragmentJson(page: FragmentPage): Record<string, unknown> {
  return {
    query: page.query,
    count: page.triples.length,
    totalItems: page.totalItems,
    totalPages: page.totalPages,
    page: page.page,
    limit: page.limit,
    links: page.links,
    triples: page.triples,
  };
}

export function fragmentJsonLd(page: FragmentPage, opts: { base?: string } = {}): Record<string, unknown> {
  const base = opts.base ?? "http://localhost/";
  return {
    "@context": {
      hydra: "http://www.w3.org/ns/hydra/core#",
      rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
      prov: "http://www.w3.org/ns/prov#",
      void: "http://rdfs.org/ns/void#",
      tpf: "http://www.w3.org/ns/hydra/core#",
      subject: "http://www.w3.org/1999/02/22-rdf-syntax-ns#subject",
      predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#predicate",
      object: "http://www.w3.org/1999/02/22-rdf-syntax-ns#object",
      state: "https://561.group/vocab#state",
      witness: "http://www.w3.org/ns/prov#wasDerivedFrom",
    },
    "@id": page.links.self,
    "@type": ["hydra:Collection", "hydra:PagedCollection"],
    "hydra:totalItems": page.totalItems,
    "void:triples": page.totalItems,
    "hydra:itemsPerPage": page.limit,
    "hydra:first": { "@id": page.links.first },
    "hydra:last": { "@id": page.links.last },
    ...(page.links.previous ? { "hydra:previous": { "@id": page.links.previous } } : {}),
    ...(page.links.next ? { "hydra:next": { "@id": page.links.next } } : {}),
    "hydra:search": searchTemplate(page.links.self),
    "hydra:member": page.triples.map((record) => tripleJsonLd(record, base)),
  };
}

function searchTemplate(self: string): Record<string, unknown> {
  const url = new URL(self);
  url.search = "";
  return {
    "@type": "hydra:IriTemplate",
    "hydra:template": `${url.href}{?s,p,o,state,witness,page,limit}`,
    "hydra:mapping": [
      mapping("s", "rdf:subject"),
      mapping("p", "rdf:predicate"),
      mapping("o", "rdf:object"),
      mapping("state", "https://561.group/vocab#state"),
      mapping("witness", "prov:wasDerivedFrom"),
      mapping("page", "hydra:pageIndex"),
      mapping("limit", "hydra:limit"),
    ],
  };
}

function mapping(variable: string, property: string): Record<string, unknown> {
  return { "@type": "hydra:IriTemplateMapping", "hydra:variable": variable, "hydra:property": property };
}

function tripleJsonLd(record: TripleRecord, base: string): Record<string, unknown> {
  return {
    "@type": "rdf:Statement",
    subject: { "@id": new URL(encodeURI(record.subject), base).href },
    predicate: record.predicate,
    object: record.object,
    state: record.state,
    witness: record.witness,
    ...(record.claimedBy !== undefined ? { claimedBy: record.claimedBy } : {}),
    ...(record.contraryClaimedBy !== undefined ? { contraryClaimedBy: record.contraryClaimedBy } : {}),
  };
}

/** Hydra collection, serialized as witnessed RDF documentary statements by
 * the current Data owner. Do not emit naked domain facts from a claim. */
export function fragmentTurtle(page: FragmentPage, opts: {
  base?: string; subjects?: readonly string[];
} = {}): string {
  const base = opts.base ?? "http://localhost/";
  const subjects = opts.subjects ?? [...new Set(page.triples.map((record) => record.subject))];
  const grouped = new Map<string, TripleRecord[]>();
  for (const triple of page.triples) {
    const entries = grouped.get(triple.subject) ?? [];
    entries.push(triple);
    grouped.set(triple.subject, entries);
  }
  const documents = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([entity, records]) => readingTurtle({
      entity,
      fiber: records.map((record) => {
        const positive = record.claimedBy === undefined
          ? record.state === "potential" ? witnessItems(record.witness) : []
          : witnessItems(record.claimedBy);
        const negative = record.contraryClaimedBy === undefined
          ? record.state === "active" ? witnessItems(record.witness) : []
          : witnessItems(record.contraryClaimedBy);
        return { predicate: record.predicate, object: record.object,
          value: { evidence: [positive, negative] as const } };
      }),
    }, { base, subjects }));
  return [
    "@prefix hydra: <http://www.w3.org/ns/hydra/core#> .",
    "@prefix void: <http://rdfs.org/ns/void#> .",
    `<${page.links.self}> a hydra:Collection, hydra:PagedCollection ;`,
    `  hydra:totalItems ${page.totalItems} ;`,
    `  hydra:itemsPerPage ${page.limit} ;`,
    `  void:triples ${page.totalItems} .`,
    ...documents,
  ].join("\n");
}

function repr(type: string, body: string, headers: Record<string, string> = {}): Repr {
  return {
    type,
    cacheControl: { visibility: "public", maxAge: 60 },
    headers: {
      Vary: "Accept",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      ...headers,
    },
    body,
  };
}

async function sourceFor(opts: TpfAppOptions): Promise<readonly FoldedEvidence[]> {
  return typeof opts.source === "function" ? await opts.source() : opts.source;
}

function patternFrom(url: URL): TriplePattern {
  const state = url.searchParams.get("state") || undefined;
  if (state !== undefined && state !== "potential" && state !== "active" && state !== "stable") {
    throw new TypeError("state must be potential, active, or stable");
  }
  return {
    ...(url.searchParams.get("s") ? { s: url.searchParams.get("s")! } : {}),
    ...(url.searchParams.get("p") ? { p: url.searchParams.get("p")! } : {}),
    ...(url.searchParams.get("o") ? { o: url.searchParams.get("o")! } : {}),
    ...(state ? { state } : {}),
    ...(url.searchParams.get("witness") ? { witness: url.searchParams.get("witness")! } : {}),
  };
}

function intParam(url: URL, name: string): number | undefined {
  const value = url.searchParams.get(name);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function tpfApp(opts: TpfAppOptions): App {
  const path = opts.paths?.query ?? opts.path ?? "/query";
  const base = opts.base ?? "http://localhost/";
  return {
    resources: [
      {
        match: path,
        route: path,
        id: "triple-pattern-fragments.query",
        name: "Triple Pattern Fragments Query",
        methods: ["GET"],
        produces: ["application/ld+json", "application/json", "text/turtle"],
        handler: async (ctx) => {
          let pattern: TriplePattern;
          try {
            pattern = patternFrom(ctx.url);
          } catch (error) {
            return {
              ...repr("text/plain; charset=utf-8", error instanceof Error ? error.message : String(error)),
              status: 400,
            };
          }
          const folds = await sourceFor(opts);
          const fragmentOpts: {
            base?: string;
            path?: string;
            page?: number;
            limit?: number;
            maxLimit?: number;
          } = { base, path };
          const requestedPage = intParam(ctx.url, "page");
          if (requestedPage !== undefined) fragmentOpts.page = requestedPage;
          const requestedLimit = intParam(ctx.url, "limit") ?? opts.limit;
          if (requestedLimit !== undefined) fragmentOpts.limit = requestedLimit;
          if (opts.maxLimit !== undefined) fragmentOpts.maxLimit = opts.maxLimit;
          const page = queryTriples(folds, pattern, fragmentOpts);
          const headers = { Link: linkHeader([
            { href: page.links.first, rel: "first" },
            { href: page.links.last, rel: "last" },
            ...(page.links.previous ? [{ href: page.links.previous, rel: "prev" }] : []),
            ...(page.links.next ? [{ href: page.links.next, rel: "next" }] : []),
          ]) };
          if (ctx.negotiatedType === "text/turtle") {
            return repr(TURTLE_TYPE, fragmentTurtle(page, { base, subjects: folds.map((fold) => fold.entity) }), headers);
          } else if (ctx.negotiatedType === "application/ld+json") {
            return repr(JSONLD_TYPE, `${JSON.stringify(fragmentJsonLd(page, { base }), null, 2)}\n`, headers);
          }
          return repr(JSON_TYPE, `${JSON.stringify(fragmentJson(page), null, 2)}\n`, headers);
        },
      },
    ],
  };
}

export default tpfApp;
