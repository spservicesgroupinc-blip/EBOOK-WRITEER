import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { generateOutline, refineChapterText, writeChapter } from '../services/gemini';
import { BackgroundKeeper } from '../services/backgroundKeeper';
import { SourceType } from '../types';

const originalFetch = globalThis.fetch;
const originalDelay = BackgroundKeeper.unthrottledDelay;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
  globalThis.fetch = originalFetch;
  BackgroundKeeper.unthrottledDelay = originalDelay;
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

function mockModel(contents: string[], failFirst = false) {
  const requests: any[] = [];
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value),
  } });
  BackgroundKeeper.unthrottledDelay = async () => {};
  globalThis.fetch = async (input, init) => {
    if (String(input) === '/api/client-config') return Response.json({ apiKey: 'test-key-not-real' });
    assert.equal(String(input), 'https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    if (failFirst && requests.length === 1) return Response.json({ error: { message: 'Busy' } }, { status: 429 });
    return Response.json({ choices: [{ message: { content: contents.shift() } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  };
  return requests;
}
const sources = [{ id: 'one', type: SourceType.TEXT, name: 'Official report', content: 'The recorded value was 123 in 2010.', isProcessing: false }];
const chapter = { chapterNumber: 1, title: 'Evidence', summary: 'Explain the data.' };
const outline = { title: 'History explained', description: 'An educational history.', chapters: [chapter] };

test('actual outline request receives nonfiction and special instructions', async () => {
  const requests = mockModel([JSON.stringify(outline)]);
  const result = await generateOutline(sources, 'Define technical terms.', { style: 'educational_nonfiction' });
  assert.equal(result.chapters[0].title, 'Evidence');
  assert.match(requests[0].messages[0].content, /Never invent/);
  assert.match(requests[0].messages[0].content, /Define technical terms/);
  assert.doesNotMatch(requests[0].messages[0].content, /Detailed narrative beats and plot points/);
});

test('draft, fallback, and automatic polish all preserve nonfiction and zero model prices', async () => {
  const requests = mockModel(['A sourced draft. '.repeat(15), 'A sourced polished chapter. '.repeat(15)], true);
  const result = await writeChapter(chapter, outline, sources, { style: 'educational_nonfiction', twoPassPolish: true, customInstruction: 'Use dates carefully.' });
  assert.match(result, /polished chapter/);
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.ok(request.model.endsWith(':free') || request.model === 'openrouter/free');
    assert.deepEqual(request.provider.max_price, { prompt: 0, completion: 0 });
    assert.equal(request.plugins, undefined);
    assert.match(request.messages[0].content, /Use dates carefully/);
    assert.match(request.messages[0].content, /recorded value was 123/);
    assert.match(request.messages[0].content, /Never invent/);
  }
});

test('manual editing does not replace a multi-part instruction when it mentions dialogue', async () => {
  const requests = mockModel(['Edited text.']);
  await refineChapterText('A factual draft.', 'Do not invent dialogue; retain citations and shorten by half.', undefined,
    { style: 'educational_nonfiction', sources, customInstruction: 'Keep a light touch.' });
  assert.match(requests[0].messages[0].content, /Do not invent dialogue; retain citations and shorten by half/);
  assert.match(requests[0].messages[0].content, /Keep a light touch/);
});

test('malformed outlines fail explicitly instead of inventing a story outline', async () => {
  mockModel(['{}']);
  await assert.rejects(() => generateOutline(sources, '', { style: 'educational_nonfiction' }), /usable chapter outline/);
});

test('paid model overrides are rejected before any model request', async () => {
  const requests = mockModel([]);
  await assert.rejects(() => refineChapterText('Draft', 'Improve', 'provider/paid-model'), /Only OpenRouter free/);
  assert.equal(requests.length, 0);
});
