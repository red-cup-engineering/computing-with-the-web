/**
 * feed — HTTP transport for syndication feeds.
 *
 * The serializers themselves (RSS 2.0, Atom, JSON Feed, sitemaps, news sitemap,
 * robots.txt, and the RFC-3339/XML helpers) are content codecs and live in
 * `@red-cup-engineering/computer-serialized-content-engineering-services-section/web-feed` — they are formats, not transport. This module
 * re-exports them unchanged (so existing `@red-cup-engineering/computing-with-the-web/feed` consumers keep
 * working) and adds the transport-coupled pieces that genuinely belong to web:
 * the WebSub `Link` header and the `feedApp` resource builder.
 */

import type { App, Repr, Resource } from "@red-cup-engineering/computing-with-http/app";
import { linkHeader } from "@red-cup-engineering/computing-with-http/codecs/http";
import {
  type FeedChannel,
  type FeedItem,
  type FeedPage,
  type SitemapUrl,
  webSubLinks,
  feedPage,
  rss2,
  atom,
  jsonFeed,
  sitemap,
  sitemapIndex,
  newsSitemap,
  robots,
  type WebSubDiscovery,
} from "@red-cup-engineering/computer-serialized-content-engineering-services-section/web-feed";

export * from "@red-cup-engineering/computer-serialized-content-engineering-services-section/web-feed";

export type FeedAppOptions = {
  channel: FeedChannel;
  items: readonly FeedItem[];
  sitemapUrls?: readonly SitemapUrl[];
  sitemapRefs?: readonly { loc: string; lastmod?: string }[];
  newsSitemapUrls?: readonly {
    loc: string;
    publication: { name: string; language: string };
    publicationDate: string;
    title: string;
  }[];
  paging?: { pageSize: number; pageParam?: string };
  paths?: {
    rss?: string;
    atom?: string;
    json?: string;
    sitemap?: string;
    newsSitemap?: string;
    robots?: string;
  };
};

export function webSubLinkHeader(channel: FeedChannel): string | undefined {
  const discovery: Required<WebSubDiscovery> | undefined = webSubLinks(channel);
  if (!discovery) return undefined;
  return linkHeader([
    { href: discovery.hub, rel: "hub" },
    { href: discovery.self, rel: "self" },
  ]);
}

function repr(type: string, body: string, headers: Record<string, string> = {}): Repr {
  return {
    type,
    cacheControl: { visibility: "public", maxAge: 300 },
    headers,
    body,
  };
}

export function feedApp(options: FeedAppOptions): App {
  const { channel, items } = options;
  const paths = {
    rss: "/feed.xml",
    atom: "/feed.atom",
    json: "/feed.json",
    sitemap: "/sitemap.xml",
    newsSitemap: "/news-sitemap.xml",
    robots: "/robots.txt",
    ...(options.paths ?? {}),
  };
  const sitemapUrls: readonly SitemapUrl[] = options.sitemapUrls ?? items.map((item) => {
    const lastmod = item.updated ?? item.published;
    return {
      loc: item.url,
      ...(lastmod ? { lastmod } : {}),
    };
  });
  const pageFor = (page: number): FeedPage | null =>
    options.paging ? feedPage(channel, items, { ...options.paging, page }) : null;
  const currentPage = (ctxPage: string | null): FeedPage | null => {
    const parsed = Number.parseInt(ctxPage ?? "1", 10);
    return pageFor(Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1);
  };
  const webSubHeader = webSubLinkHeader(channel);
  const feedHeaders = webSubHeader ? { Link: webSubHeader } : {};
  const feedLanguages = channel.language ? { languages: [channel.language] } : {};
  const resources: Resource[] = [
    {
      match: paths.rss,
      route: paths.rss,
      id: "feed.rss",
      name: "RSS Feed",
      methods: ["GET"],
      produces: ["application/rss+xml"],
      ...feedLanguages,
      handler: (ctx) => {
        const page = currentPage(ctx.url.searchParams.get(options.paging?.pageParam ?? "page"));
        return repr("application/rss+xml; charset=utf-8", rss2(channel, page?.items ?? items, page ? page.links : {}), feedHeaders);
      },
    },
    {
      match: paths.atom,
      route: paths.atom,
      id: "feed.atom",
      name: "Atom Feed",
      methods: ["GET"],
      produces: ["application/atom+xml"],
      ...feedLanguages,
      handler: (ctx) => {
        const page = currentPage(ctx.url.searchParams.get(options.paging?.pageParam ?? "page"));
        return repr("application/atom+xml; charset=utf-8", atom(channel, page?.items ?? items, page ? page.links : {}), feedHeaders);
      },
    },
    {
      match: paths.json,
      route: paths.json,
      id: "feed.json",
      name: "JSON Feed",
      methods: ["GET"],
      produces: ["application/feed+json", "application/json"],
      ...feedLanguages,
      handler: (ctx) => {
        const page = currentPage(ctx.url.searchParams.get(options.paging?.pageParam ?? "page"));
        return repr("application/feed+json; charset=utf-8", jsonFeed(channel, page?.items ?? items, page ? page.links : {}), feedHeaders);
      },
    },
    {
      match: paths.sitemap,
      route: paths.sitemap,
      id: "feed.sitemap",
      name: "Sitemap",
      methods: ["GET"],
      produces: ["application/xml"],
      handler: () => repr("application/xml; charset=utf-8", options.sitemapRefs ? sitemapIndex(options.sitemapRefs) : sitemap(sitemapUrls)),
    },
  ];

  if (options.newsSitemapUrls) {
    resources.push({
      match: paths.newsSitemap,
      route: paths.newsSitemap,
      id: "feed.news-sitemap",
      name: "News Sitemap",
      methods: ["GET"],
      produces: ["application/xml"],
      handler: () => repr("application/xml; charset=utf-8", newsSitemap(options.newsSitemapUrls ?? [])),
    });
  }

  resources.push({
    match: paths.robots,
    route: paths.robots,
    id: "feed.robots",
    name: "Robots",
    methods: ["GET"],
    produces: ["text/plain"],
    handler: () => repr("text/plain; charset=utf-8", robots(paths.sitemap.startsWith("http") ? paths.sitemap : new URL(paths.sitemap, channel.homePageUrl).href)),
  });

  return {
    resources,
  };
}
