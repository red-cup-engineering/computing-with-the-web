import test from 'node:test';
import assert from 'node:assert/strict';
import { feedApp } from '../dist/feed/index.mjs';

const channel = { title: 'Pulse', homePageUrl: 'https://example.org/', feedUrl: 'https://example.org/feed.xml' };
const item = (id, updated = '2026-11-13T00:00:00Z') => ({ id, url: `https://example.org/pulse/${id}`, title: id, updated });
const sitemapBody = async app => (await app.resources.find(resource => resource.id === 'feed.sitemap').handler()).body;

test('derived sitemap follows current items through publication, change and eviction', async () => {
  const items = [];
  const app = feedApp({ channel, items });
  assert.doesNotMatch(await sitemapBody(app), /<url>/);
  items.push(item('first'));
  assert.match(await sitemapBody(app), /<loc>https:\/\/example.org\/pulse\/first<\/loc>/);
  items[0].updated = '2026-11-14T01:00:00Z';
  assert.match(await sitemapBody(app), /<lastmod>2026-11-14<\/lastmod>/);
  items.unshift(item('second'));
  items.pop();
  const retained = await sitemapBody(app);
  assert.match(retained, /\/pulse\/second/);
  assert.doesNotMatch(retained, /\/pulse\/first/);
  items.splice(0);
  assert.doesNotMatch(await sitemapBody(app), /<url>/);
});

test('explicit sitemap URLs remain authoritative, including an explicitly empty list', async () => {
  const items = [item('feed-only')];
  const urls = [{ loc: 'https://example.org/explicit' }];
  const app = feedApp({ channel, items, sitemapUrls: urls });
  items.push(item('new-feed-only'));
  assert.match(await sitemapBody(app), /\/explicit/);
  assert.doesNotMatch(await sitemapBody(app), /feed-only/);
  urls.push({ loc: 'https://example.org/explicit-next' });
  assert.match(await sitemapBody(app), /explicit-next/);
  assert.doesNotMatch(await sitemapBody(feedApp({ channel, items, sitemapUrls: [] })), /<url>/);
});

test('explicit sitemap index references keep precedence over item-derived URLs', async () => {
  const items = [item('feed-only')];
  const app = feedApp({ channel, items, sitemapRefs: [{ loc: 'https://example.org/archive.xml' }] });
  const body = await sitemapBody(app);
  assert.match(body, /<sitemapindex/);
  assert.match(body, /archive.xml/);
  assert.doesNotMatch(body, /feed-only/);
});
