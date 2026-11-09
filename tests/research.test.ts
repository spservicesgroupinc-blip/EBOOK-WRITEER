import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retrieveResearch } from '../services/wikipediaResearch';

test('rejects missing or oversized topics before any network call', async () => {
  await assert.rejects(() => retrieveResearch(''), /topic/i);
  await assert.rejects(() => retrieveResearch('x'.repeat(201)), /200/);
});

test('retrieves real excerpts with stable provenance; never follows returned URLs', async () => {
  const calls: string[] = [];
  const fetcher = async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/search/page')) return Response.json({ pages: [{ id: 12 }, { id: 13 }] });
    return Response.json({ query: { pages: [{ pageid: Number(new URL(url).searchParams.get('pageids')), title: 'Economic history',
      extract: 'Documented history and dated statistics. '.repeat(30), revisions: [{ revid: 34, timestamp: '2026-10-20T00:00:00Z' }], fullurl: 'http://localhost/private' }] } });
  };
  const result = await retrieveResearch('economic history', fetcher as typeof fetch);
  assert.equal(result.sources.length, 2);
  assert.match(result.sources[0].content, /Documented history/);
  assert.match(result.sources[0].research!.url, /^https:\/\/en.wikipedia.org\/w\/index.php\?oldid=34$/);
  assert.equal(result.sources[0].research!.revisionDate, '2026-10-20T00:00:00Z');
  assert.ok(calls.every(url => new URL(url).hostname === 'en.wikipedia.org'));
});

test('empty search and provider failures do not masquerade as successful research', async () => {
  await assert.rejects(() => retrieveResearch('no matches', (async () => Response.json({ pages: [] })) as typeof fetch), /No.*sources/i);
  await assert.rejects(() => retrieveResearch('topic', (async () => new Response('', { status: 429 })) as typeof fetch), /429/);
});

test('partial retrieval reports missing pages without losing usable sources', async () => {
  const fetcher = async (input: string | URL) => {
    const url = String(input);
    if (url.includes('/search/page')) return Response.json({ pages: [{ id: 1 }, { id: 2 }] });
    if (url.includes('pageids=2')) return new Response('', { status: 503 });
    return Response.json({ query: { pages: [{ pageid: 1, title: 'History', extract: 'A factual excerpt. '.repeat(30) }] } });
  };
  const result = await retrieveResearch('history', fetcher as typeof fetch);
  assert.equal(result.sources.length, 1);
  assert.equal(result.warnings.length, 1);
});
