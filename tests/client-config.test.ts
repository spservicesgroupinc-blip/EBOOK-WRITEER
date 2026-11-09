import assert from 'node:assert/strict';
import { test } from 'node:test';
import { refineChapterText } from '../services/gemini';

test('generation reports a crashed configuration service instead of a JSON syntax or missing-key error', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async input => {
    assert.equal(input, '/api/client-config');
    calls++;
    return new Response('A server error has occurred\nFUNCTION_INVOCATION_FAILED', { status: 500 });
  };
  try {
    await assert.rejects(() => refineChapterText('A draft.', 'Improve clarity.', 'openrouter/free'),
      error => error instanceof Error && /App configuration service.*HTTP 500/.test(error.message) && !/Unexpected token|not configured/.test(error.message));
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});
