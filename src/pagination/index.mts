import { normaliseSize, pageCount } from "./count.mjs";
export { normaliseSize, pageCount } from "./count.mjs";
import type { App, Repr } from "@red-cup-engineering/computing-with-http/app";
import { mark, type ChargeValueName, type UtteranceCarrier } from "@red-cup-engineering/relating";
import { joinKnowledgeNames } from "@red-cup-engineering/animating/becoming/doing/algebra";
import { utterEvidence } from "@red-cup-engineering/animating/becoming/doing/working/learning/lessons";
import { linkHeader } from "@red-cup-engineering/computing-with-http/codecs/http";
import { assertHttpUrl } from "@red-cup-engineering/uri-services-section/http-url";
import { escapeHtmlText } from "../feed/index.mjs";

export type PageLinks = {
  self: string;
  first: string;
  previous?: string;
  next?: string;
  last: string;
};

export type Page<T> = {
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  items: readonly T[];
  links: PageLinks;
};

export type FeedPage<T> = {
  index: number;
  size: number;
  pageCount: number;
  total: number;
  offset: number;
  items: readonly T[];
  isFirst: boolean;
  isLast: boolean;
  firstIndex: 0;
  lastIndex: number;
  previousIndex: number | null;
  nextIndex: number | null;
};

export type FeedLink = {
  rel: string;
  href: string;
  type?: string;
  title?: string;
};

export type FeedPageUrlOptions = {
  param?: string;
  origin?: string;
};

export type FeedLinkOptions = FeedPageUrlOptions & {
  build?: (index: number) => string;
  type?: string;
};

export type ArchiveLinkOptions = FeedLinkOptions & {
  current?: string;
  oldestFirst?: boolean;
};

export type HFeedLinkOptions = FeedLinkOptions & {
  ends?: boolean;
};

export type FeedHistoryClaimKind = "complete" | "archive" | "subscription";

export type FeedHistoryClaim = {
  subject: string;
  /** The claim made good claims the predicate; the contrary fact is its own
   *  claim of the contrary (`not-`) predicate — never a witness polarity. */
  predicate: `feed-history:${FeedHistoryClaimKind}` | `feed-history:not-${FeedHistoryClaimKind}`;
  object: FeedHistoryClaimKind;
  /** The single utterance the claim articulates — the only admissible evidence. */
  utterance: UtteranceCarrier;
  /** Charge value carried as judgment DATA at this layer: joined exactly with
   *  the knowledge join, never re-admitted into bedrock. */
  value: ChargeValueName;
};

export type PaginationOptions = {
  baseUrl: string;
  path?: string;
  page?: number;
  pageSize?: number;
  pageParam?: string;
};

export type CollectionItem = {
  id: string;
  url: string;
  title: string;
  summary?: string;
  published?: string;
  updated?: string;
};

export type CollectionAppOptions<T extends CollectionItem = CollectionItem> = {
  baseUrl: string;
  items: readonly T[];
  path?: string;
  pageSize?: number;
  renderItem?: (item: T) => string;
};

export const ATOM_TYPE = "application/atom+xml";
export const FH_NS = "http://purl.org/syndication/history/1.0";
export const FH_PREFIX = "fh";

function positiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${field} must be a positive integer`);
}

function headerQuoted(value: unknown): string {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function feedPageUrl(base: string, index: number, options: FeedPageUrlOptions = {}): string {
  if (!base) throw new TypeError("base must be a non-empty URL");
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError("index must be a non-negative integer");
  const param = options.param ?? "page";
  if (!param) throw new TypeError("param is required");
  const url = options.origin ? new URL(base, options.origin) : new URL(base);
  if (index === 0) {
    url.searchParams.delete(param);
  } else {
    url.searchParams.set(param, String(index));
  }
  return url.href;
}

export function pageUrl(
  baseUrl: string,
  path: string,
  page: number,
  pageParam?: string,
): string;
export function pageUrl(
  baseUrl: string,
  pageIndex: number,
  options?: FeedPageUrlOptions,
): string;
export function pageUrl(
  baseUrl: string,
  pathOrPageIndex: string | number,
  pageOrOptions: number | FeedPageUrlOptions = 1,
  pageParam = "page",
): string {
  if (typeof pathOrPageIndex === "number") {
    return feedPageUrl(baseUrl, pathOrPageIndex, pageOrOptions as FeedPageUrlOptions);
  }
  assertHttpUrl(baseUrl, "baseUrl");
  const path = pathOrPageIndex;
  const page = pageOrOptions as number;
  positiveInteger(page, "page");
  if (!pageParam) throw new TypeError("pageParam is required");
  const url = new URL(path, baseUrl);
  url.searchParams.set(pageParam, String(page));
  return url.href;
}

export function paginateFeed<T>(items: readonly T[], size: number, index: number): FeedPage<T> {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  normaliseSize(size);
  const total = items.length;
  const count = pageCount(total, size);
  if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`index must be in range 0..${count - 1}`);
  }
  const offset = index * size;
  return Object.freeze({
    index,
    size,
    pageCount: count,
    total,
    offset,
    items: Object.freeze(items.slice(offset, offset + size)),
    isFirst: index === 0,
    isLast: index === count - 1,
    firstIndex: 0,
    lastIndex: count - 1,
    previousIndex: index === 0 ? null : index - 1,
    nextIndex: index === count - 1 ? null : index + 1,
  });
}

export function allFeedPages<T>(items: readonly T[], size: number): readonly FeedPage<T>[] {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  return Object.freeze(Array.from({ length: pageCount(items.length, size) }, (_, index) => paginateFeed(items, size, index)));
}

export const allPages = allFeedPages;

export function link(rel: string, href: string, options: { type?: string; title?: string } = {}): FeedLink {
  if (!rel) throw new TypeError("link rel must be non-empty");
  if (!href) throw new TypeError("link href must be non-empty");
  return Object.freeze({
    rel,
    href,
    ...(options.type !== undefined ? { type: options.type } : {}),
    ...(options.title !== undefined ? { title: options.title } : {}),
  });
}

function feedUrlBuilder(base: string, options: FeedLinkOptions): (index: number) => string {
  return options.build ?? ((index) => feedPageUrl(base, index, {
    ...(options.param !== undefined ? { param: options.param } : {}),
    ...(options.origin !== undefined ? { origin: options.origin } : {}),
  }));
}

export function toAtomLink(item: FeedLink, options: { type?: string } = {}): string {
  const type = item.type ?? options.type ?? ATOM_TYPE;
  const title = item.title === undefined ? "" : ` title="${escapeHtmlText(item.title)}"`;
  return `<link rel="${escapeHtmlText(item.rel)}" href="${escapeHtmlText(item.href)}" type="${escapeHtmlText(type)}"${title}/>`;
}

export function toLinkHeader(item: FeedLink, options: { type?: string } = {}): string {
  const type = item.type ?? options.type ?? ATOM_TYPE;
  const title = item.title === undefined ? "" : `; title="${headerQuoted(item.title)}"`;
  return `<${item.href}>; rel="${headerQuoted(item.rel)}"; type="${headerQuoted(type)}"${title}`;
}

export function toLinkHeaderValue(links: readonly FeedLink[], options: { type?: string } = {}): string {
  return links.map((item) => toLinkHeader(item, options)).join(", ");
}

export function pagedLinks<T>(page: FeedPage<T>, base: string, options: FeedLinkOptions = {}): readonly FeedLink[] {
  const build = feedUrlBuilder(base, options);
  const type = options.type ?? ATOM_TYPE;
  return Object.freeze([
    link("first", build(page.firstIndex), { type }),
    ...(page.previousIndex === null ? [] : [link("previous", build(page.previousIndex), { type })]),
    ...(page.nextIndex === null ? [] : [link("next", build(page.nextIndex), { type })]),
    link("last", build(page.lastIndex), { type }),
  ]);
}

export function pagedFeed<T>(
  items: readonly T[],
  size: number,
  index: number,
  base: string,
  options: FeedLinkOptions = {},
): { page: FeedPage<T>; links: readonly FeedLink[] } {
  const page = paginateFeed(items, size, index);
  return { page, links: pagedLinks(page, base, options) };
}

export function pagedLinksToAtom(links: readonly FeedLink[], options: { type?: string } = {}): string {
  return links.map((item) => toAtomLink(item, options)).join("\n");
}

export function pagedLinksToHeader(links: readonly FeedLink[], options: { type?: string } = {}): string {
  return toLinkHeaderValue(links, options);
}

export function fhNamespaceDecl(prefix = FH_PREFIX): string {
  if (!prefix) throw new TypeError("prefix is required");
  return `xmlns:${escapeHtmlText(prefix)}="${FH_NS}"`;
}

export function completeMarker(prefix = FH_PREFIX): string {
  if (!prefix) throw new TypeError("prefix is required");
  return `<${escapeHtmlText(prefix)}:complete/>`;
}

export function mayAssertComplete<T>(page: FeedPage<T>): boolean {
  return page.pageCount === 1;
}

export function feedHistoryClaim<T>(
  page: FeedPage<T>,
  claim: FeedHistoryClaimKind,
  witness: unknown = { page: page.index, claim },
): FeedHistoryClaim {
  const asserted =
    claim === "complete" ? mayAssertComplete(page)
      : claim === "archive" ? page.index !== 0
        : page.index === 0;
  const subject = `feed-page:${page.index}`;
  const predicate = asserted
    ? (`feed-history:${claim}` as const)
    : (`feed-history:not-${claim}` as const);
  return {
    subject,
    predicate,
    object: claim,
    utterance: utterEvidence({ subject: mark(subject), predicate: mark(predicate), object: mark(claim), provenance: witness }),
    value: asserted ? "potential" : "active",
  };
}

export function foldFeedHistoryClaims(claims: readonly FeedHistoryClaim[]): ChargeValueName {
  return joinKnowledgeNames(claims.map((claim) => claim.value));
}

export function archiveMarker(prefix = FH_PREFIX): string {
  if (!prefix) throw new TypeError("prefix is required");
  return `<${escapeHtmlText(prefix)}:archive/>`;
}

export function archiveLinks<T>(page: FeedPage<T>, base: string, options: ArchiveLinkOptions = {}): readonly FeedLink[] {
  const build = feedUrlBuilder(base, options);
  const type = options.type ?? ATOM_TYPE;
  const olderIndex = options.oldestFirst ? page.previousIndex : page.nextIndex;
  const newerIndex = options.oldestFirst ? page.nextIndex : page.previousIndex;
  return Object.freeze([
    ...(olderIndex === null ? [] : [link("prev-archive", build(olderIndex), { type })]),
    ...(newerIndex === null ? [] : [link("next-archive", build(newerIndex), { type })]),
    link("current", options.current ?? build(0), { type }),
  ]);
}

export function subscriptionLinks<T>(page: FeedPage<T>, base: string, options: ArchiveLinkOptions = {}): readonly FeedLink[] {
  const build = feedUrlBuilder(base, options);
  const type = options.type ?? ATOM_TYPE;
  const olderIndex = options.oldestFirst ? page.previousIndex : page.nextIndex;
  return Object.freeze([
    ...(olderIndex === null ? [] : [link("prev-archive", build(olderIndex), { type })]),
    link("current", options.current ?? build(page.index), { type }),
  ]);
}

export function archivedFeed<T>(
  items: readonly T[],
  size: number,
  index: number,
  base: string,
  options: ArchiveLinkOptions & { prefix?: string } = {},
): { page: FeedPage<T>; links: readonly FeedLink[]; marker: string; namespace: string; isSubscription: boolean } {
  const page = paginateFeed(items, size, index);
  const prefix = options.prefix ?? FH_PREFIX;
  const isSubscription = index === 0;
  return {
    page,
    links: isSubscription ? subscriptionLinks(page, base, options) : archiveLinks(page, base, options),
    marker: isSubscription ? "" : archiveMarker(prefix),
    namespace: fhNamespaceDecl(prefix),
    isSubscription,
  };
}

export function archiveLinksToAtom(links: readonly FeedLink[], options: { type?: string } = {}): string {
  return links.map((item) => toAtomLink(item, options)).join("\n");
}

export function archiveLinksToHeader(links: readonly FeedLink[], options: { type?: string } = {}): string {
  return toLinkHeaderValue(links, options);
}

export function hfeedLinks<T>(page: FeedPage<T>, base: string, options: HFeedLinkOptions = {}): readonly FeedLink[] {
  const build = feedUrlBuilder(base, options);
  const linkOptions = options.type === undefined ? {} : { type: options.type };
  const ends = options.ends ?? true;
  return Object.freeze([
    ...(ends ? [link("first", build(page.firstIndex), linkOptions)] : []),
    ...(page.previousIndex === null ? [] : [link("prev", build(page.previousIndex), linkOptions)]),
    ...(page.nextIndex === null ? [] : [link("next", build(page.nextIndex), linkOptions)]),
    ...(ends ? [link("last", build(page.lastIndex), linkOptions)] : []),
  ]);
}

export function hfeedPage<T>(
  items: readonly T[],
  size: number,
  index: number,
  base: string,
  options: HFeedLinkOptions = {},
): { page: FeedPage<T>; links: readonly FeedLink[] } {
  const page = paginateFeed(items, size, index);
  return { page, links: hfeedLinks(page, base, options) };
}

function relationLabel(rel: string): string {
  const words = rel.replace(/-/g, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export function hfeedAnchors(links: readonly FeedLink[]): string {
  return links.map((item) => `<a rel="${escapeHtmlText(item.rel)}" href="${escapeHtmlText(item.href)}">${escapeHtmlText(relationLabel(item.rel))}</a>`).join("\n");
}

export function hfeedHeadLinks(links: readonly FeedLink[]): string {
  return links
    .map((item) => `<link rel="${escapeHtmlText(item.rel)}" href="${escapeHtmlText(item.href)}"${item.type ? ` type="${escapeHtmlText(item.type)}"` : ""}/>`)
    .join("\n");
}

export function hfeedLinksToHeader(links: readonly FeedLink[], options: { type?: string } = {}): string {
  return toLinkHeaderValue(links, options);
}

export function paginate<T>(items: readonly T[], options: PaginationOptions): Page<T>;
export function paginate<T>(items: readonly T[], size: number, index: number): FeedPage<T>;
export function paginate<T>(items: readonly T[], optionsOrSize: PaginationOptions | number, index = 0): Page<T> | FeedPage<T> {
  if (typeof optionsOrSize === "number") return paginateFeed(items, optionsOrSize, index);
  const options = optionsOrSize;
  assertHttpUrl(options.baseUrl, "baseUrl");
  const pageSize = options.pageSize ?? 20;
  positiveInteger(pageSize, "pageSize");
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const requestedPage = options.page ?? 1;
  positiveInteger(requestedPage, "page");
  const page = Math.min(requestedPage, totalPages);
  const path = options.path ?? "/";
  const pageParam = options.pageParam ?? "page";
  const start = (page - 1) * pageSize;
  return {
    page,
    pageSize,
    totalPages,
    totalItems,
    items: items.slice(start, start + pageSize),
    links: {
      self: pageUrl(options.baseUrl, path, page, pageParam),
      first: pageUrl(options.baseUrl, path, 1, pageParam),
      ...(page > 1 ? { previous: pageUrl(options.baseUrl, path, page - 1, pageParam) } : {}),
      ...(page < totalPages ? { next: pageUrl(options.baseUrl, path, page + 1, pageParam) } : {}),
      last: pageUrl(options.baseUrl, path, totalPages, pageParam),
    },
  };
}

export function paginationLinkHeader(page: Page<unknown>): string {
  return linkHeader([
    { href: page.links.self, rel: "self" },
    { href: page.links.first, rel: "first" },
    ...(page.links.previous ? [{ href: page.links.previous, rel: "prev" }] : []),
    ...(page.links.next ? [{ href: page.links.next, rel: "next" }] : []),
    { href: page.links.last, rel: "last" },
  ]);
}

export function pageLinksNav(links: PageLinks, ariaLabel = "Pagination"): string {
  const previous = links.previous;
  const next = links.next;
  const renderedLinks = [
    `<a rel="self" href="${escapeHtmlText(links.self)}">self</a>`,
    `<a rel="first" href="${escapeHtmlText(links.first)}">first</a>`,
    previous ? `<a rel="prev" href="${escapeHtmlText(previous)}">previous</a>` : "",
    next ? `<a rel="next" href="${escapeHtmlText(next)}">next</a>` : "",
    `<a rel="last" href="${escapeHtmlText(links.last)}">last</a>`,
  ].filter(Boolean).join(" ");
  return `<nav class="pagination" aria-label="${escapeHtmlText(ariaLabel)}">${renderedLinks}</nav>`;
}

function defaultRenderItem(item: CollectionItem): string {
  return [
    `<article class="collection-item" data-id="${escapeHtmlText(item.id)}">`,
    `  <h2><a href="${escapeHtmlText(item.url)}">${escapeHtmlText(item.title)}</a></h2>`,
    item.summary ? `  <p>${escapeHtmlText(item.summary)}</p>` : "",
    item.published ? `  <time datetime="${escapeHtmlText(item.published)}">${escapeHtmlText(item.published)}</time>` : "",
    `</article>`,
  ].filter(Boolean).join("\n");
}

export function collectionHtml<T extends CollectionItem>(
  page: Page<T>,
  renderItem: (item: T) => string = defaultRenderItem,
): string {
  const nav = pageLinksNav(page.links);
  const items = page.items.map((item) => renderItem(item)).join("\n");
  return [
    `<section class="collection-page" data-page="${page.page}" data-total-pages="${page.totalPages}">`,
    `  ${nav}`,
    items,
    `  ${nav}`,
    `</section>`,
  ].join("\n");
}

function repr(type: string, body: string, headers: Record<string, string> = {}): Repr {
  return {
    type,
    cacheControl: { visibility: "public", maxAge: 300 },
    headers,
    body,
  };
}

export function collectionApp<T extends CollectionItem>(options: CollectionAppOptions<T>): App {
  assertHttpUrl(options.baseUrl, "baseUrl");
  const path = options.path ?? "/";
  const pageSize = options.pageSize ?? 20;
  positiveInteger(pageSize, "pageSize");
  return {
    resources: [
      {
        match: path,
        route: path,
        id: "pagination.collection",
        name: "Paginated Collection",
        methods: ["GET"],
        produces: ["text/html", "application/json"],
        handler: (ctx) => {
          const parsedPage = Number.parseInt(ctx.url.searchParams.get("page") ?? "1", 10);
          const page = paginate(options.items, {
            baseUrl: options.baseUrl,
            path,
            pageSize,
            page: Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
          });
          const headers = { Link: paginationLinkHeader(page) };
          if (ctx.negotiatedType === "application/json") {
            return repr("application/json; charset=utf-8", `${JSON.stringify(page, null, 2)}\n`, headers);
          }
          return repr("text/html; charset=utf-8", collectionHtml(page, options.renderItem), headers);
        },
      },
    ],
  };
}
