import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readApiJson } from '../services/http';

test('plain-text server crash produces an actionable error with status', async () => {
  await assert.rejects(() => readApiJson(new Response('A server error has occurred\nFUNCTION_INVOCATION_FAILED', { status: 500 }), 'Research service'),
    error => error instanceof Error && /Research service.*HTTP 500/.test(error.message) && !/Unexpected token/.test(error.message));
});

test('HTML gateway timeout is handled without exposing markup', async () => {
  await assert.rejects(() => readApiJson(new Response('<html>gateway timeout</html>', { status: 504 }), 'OpenRouter'),
    error => error instanceof Error && /timed out.*504/i.test(error.message) && !error.message.includes('<html>'));
});

test('structured provider errors retain their useful message', async () => {
  await assert.rejects(() => readApiJson(Response.json({ error: { message: 'Rate limit exceeded' } }, { status: 429 }), 'OpenRouter'), /Rate limit exceeded/);
  await assert.rejects(() => readApiJson(Response.json({ error: 'Research unavailable' }, { status: 502 }), 'Research service'), /Research unavailable/);
});

test('empty and non-object success responses are rejected as malformed', async () => {
  for (const body of ['', 'null', '42', '[]', '<html>Sign in</html>']) {
    await assert.rejects(() => readApiJson(new Response(body, { status: 200 }), 'App server'), /invalid response.*200/i);
  }
});

test('successful JSON response is returned unchanged', async () => {
  assert.deepEqual(await readApiJson(Response.json({ sources: [], warnings: [] }), 'Research service'), { sources: [], warnings: [] });
});
