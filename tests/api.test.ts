import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import handler from '../api/index';

const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENROUTER_API_KEY;
afterEach(() => { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey; });

async function request(url: string, body: unknown, method = 'POST') {
  let payload: any;
  const response = { statusCode: 0, setHeader() {}, end(text: string) { payload = JSON.parse(text); } };
  await handler({ url, body, method }, response);
  return { status: response.statusCode, payload };
}

test('research route validates requests without calling a model or provider', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected request'); };
  assert.equal((await request('/api/research', { topic: 'x'.repeat(201) })).status, 400);
  assert.equal((await request('/api/research', { topic: '' })).status, 400);
  assert.equal((await request('/api/research', {}, 'GET')).status, 405);
  assert.equal(calls, 0);
});

test('server-side generation also enforces zero-price routing and rejects paid overrides', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key-not-real';
  const bodies: any[] = [];
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ choices: [{ message: { content: 'A generated result.' } }] });
  };
  assert.equal((await request('/api/gemini/generate-text', { parts: [{ text: 'Write' }], model: 'openrouter/free' })).status, 200);
  assert.deepEqual(bodies[0].provider.max_price, { prompt: 0, completion: 0 });
  assert.equal(bodies[0].plugins, undefined);
  const rejected = await request('/api/gemini/generate-text', { parts: [{ text: 'Write' }], model: 'provider/paid' });
  assert.match(rejected.payload.error, /Only OpenRouter free/);
  assert.equal(bodies.length, 1);
});
