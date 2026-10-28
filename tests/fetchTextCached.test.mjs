import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchTextCached } from '../src/simulation/fetchWithProgress.js';

function mockFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const next = responses.shift();
    if (next instanceof Error) {
      throw next;
    }
    return new Response(next);
  };
  return calls;
}

test('fetchTextCached fetches a URL once and reuses the text', async () => {
  const calls = mockFetch(['{"a":1}']);
  assert.equal(await fetchTextCached('/cached-once.json'), '{"a":1}');
  let progress = 0;
  assert.equal(await fetchTextCached('/cached-once.json', (r) => { progress = r; }), '{"a":1}');
  await Promise.resolve();
  assert.equal(progress, 1);
  assert.deepEqual(calls, ['/cached-once.json']);
});

test('fetchTextCached retries after a failed request', async () => {
  const calls = mockFetch([new Error('offline'), 'ok']);
  await assert.rejects(() => fetchTextCached('/retry.json'), /offline/);
  assert.equal(await fetchTextCached('/retry.json'), 'ok');
  assert.equal(calls.length, 2);
});
