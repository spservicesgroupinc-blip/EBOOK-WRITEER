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

test('writing catalog recommends five models, one per family plus one free pick', async () => {
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return Response.json({ data: [
      { id: 'openrouter/auto', name: 'Auto Router', pricing: { prompt: '-1', completion: '-1' }, architecture: { modality: 'text->text' } },
      { id: 'alpha/paid-1', name: 'Alpha One', pricing: { prompt: '0.000003', completion: '0.000015' }, architecture: { modality: 'text->text' } },
      { id: 'beta/paid-2', name: 'Beta Two', pricing: { prompt: '0.000003', completion: '0.000015' }, architecture: { modality: 'text->text' } },
      { id: 'gamma/paid-3', name: 'Gamma Three', pricing: { prompt: '0.000003', completion: '0.000015' }, architecture: { modality: 'text->text' } },
      { id: 'delta/paid-4', name: 'Delta Four', pricing: { prompt: '0.000003', completion: '0.000015' }, architecture: { modality: 'text->text' } },
      { id: 'epsilon/paid-5', name: 'Epsilon Five', pricing: { prompt: '0.000003', completion: '0.000015' }, architecture: { modality: 'text->text' } },
      { id: 'zeta/free:free', name: 'Zeta Free', pricing: { prompt: '0', completion: '0' }, architecture: { modality: 'text->text' } },
    ] });
  };

  const result = await request('/api/openrouter/models', {}, 'GET');
  assert.equal(result.status, 200);
  assert.match(urls[0], /output_modalities=text/);
  assert.match(urls[0], /endpoints=%2Fapi%2Fv1%2Fchat%2Fcompletions|endpoints=\/api\/v1\/chat\/completions/);
  assert.match(urls[0], /sort=most-popular/);

  const router = result.payload.models.find((m: any) => m.id === 'openrouter/auto');
  assert.equal(router.isRouter, true);
  assert.equal(router.isFree, false);
  assert.equal(router.recommended, false);

  const recommended = result.payload.models.filter((m: any) => m.recommended);
  assert.equal(recommended.length, 5);
  assert.equal(recommended.filter((m: any) => m.isFree).length, 1);
  assert.equal(new Set(recommended.map((m: any) => m.id.split('/')[0])).size, 5);
  assert.ok(!recommended.some((m: any) => m.id === 'epsilon/paid-5'));
});

test('image catalog lists only paid image models that need the image engine', async () => {
  let requested = '';
  globalThis.fetch = async (input) => {
    requested = String(input);
    return Response.json({ data: [
      { id: 'vendor/free-image:free', name: 'Free Image', pricing: { prompt: '0', completion: '0' }, architecture: { modality: 'text->image', output_modalities: ['image'] } },
      { id: 'vendor/paid-image', name: 'Paid Image', pricing: { prompt: '0', completion: '0', image: '0.04' }, architecture: { modality: 'text->image', output_modalities: ['image'] } },
    ] });
  };

  const result = await request('/api/openrouter/models?for=image', {}, 'GET');
  assert.match(requested, /output_modalities=image/);
  assert.equal(result.payload.models.length, 1);
  const paid = result.payload.models[0];
  assert.equal(paid.id, 'vendor/paid-image');
  assert.equal(paid.imageOutput, true);
  assert.equal(paid.isFree, false);
  assert.equal(paid.recommended, true);
  assert.equal(paid.pricePerImage, 0.04);
});

test('image generation calls the OpenRouter Images API and reports its cost', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key-not-real';
  const calls: { url: string; body: any }[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return Response.json({
      data: [{ b64_json: 'iVBORw0KGgo=', media_type: 'image/png' }],
      usage: { prompt_tokens: 0, completion_tokens: 1290, cost: 0.04 },
    });
  };

  const result = await request('/api/gemini/image', {
    prompt: 'A lighthouse at dusk, linocut style',
    aspectRatio: '3:4',
    model: 'vendor/image-model',
    engine: 'images',
  });

  assert.equal(result.status, 200);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/images');
  assert.equal(calls[0].body.model, 'vendor/image-model');
  assert.equal(calls[0].body.aspect_ratio, '3:4');
  assert.equal(result.payload.base64, 'iVBORw0KGgo=');
  assert.equal(result.payload.mimeType, 'image/png');
  assert.equal(result.payload.usage.cost, 0.04);
});

test('image generation surfaces OpenRouter credit errors instead of a placeholder', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key-not-real';
  globalThis.fetch = async () => Response.json({ error: { message: 'Insufficient credits for this request.' } }, { status: 402 });
  const result = await request('/api/gemini/image', {
    prompt: 'Cover artwork',
    aspectRatio: '3:4',
    model: 'vendor/image-model',
    engine: 'images',
  });
  assert.equal(result.status, 402);
  assert.match(result.payload.error, /credits/i);
});
