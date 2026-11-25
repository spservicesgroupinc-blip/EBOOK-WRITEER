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

test('server-side generation accepts any OpenRouter model without a zero-price cap', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key-not-real';
  const bodies: any[] = [];
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ choices: [{ message: { content: 'A generated result.' } }] });
  };
  assert.equal((await request('/api/gemini/generate-text', { parts: [{ text: 'Write' }], model: 'openrouter/free' })).status, 200);
  assert.equal(bodies[0].provider.max_price, undefined);
  assert.equal(bodies[0].plugins, undefined);
  const paid = await request('/api/gemini/generate-text', { parts: [{ text: 'Write' }], model: 'provider/paid' });
  assert.equal(paid.status, 200);
  assert.equal(bodies[1].model, 'provider/paid');
  assert.equal(bodies[1].provider.max_price, undefined);
  assert.equal(bodies.length, 2);
});

test('model catalog returns free and paid models with per-million pricing', async () => {
  globalThis.fetch = async () => Response.json({ data: [
    { id: 'vendor/paid-model', name: 'Paid Model', pricing: { prompt: '0.000003', completion: '0.000015' }, architecture: { modality: 'text->text' } },
    { id: 'vendor/free-model:free', name: 'Free Model', pricing: { prompt: '0', completion: '0' }, architecture: { modality: 'text->text' } },
  ] });
  const result = await request('/api/openrouter/models', {}, 'GET');
  assert.equal(result.status, 200);
  assert.equal(result.payload.models.length, 2);
  const paid = result.payload.models.find((m: any) => m.id === 'vendor/paid-model');
  assert.equal(paid.isFree, false);
  assert.deepEqual(paid.pricing, { prompt: 3, completion: 15 });
  const free = result.payload.models.find((m: any) => m.id === 'vendor/free-model:free');
  assert.equal(free.isFree, true);
});
