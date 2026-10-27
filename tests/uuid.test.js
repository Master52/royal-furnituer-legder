import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from '../src/uuid.js';

test('uses the native UUID method when available', () => {
  const provider = {randomUUID() { assert.equal(this, provider); return 'native-id'; }};
  assert.equal(randomUUID(provider), 'native-id');
});

test('generates RFC 4122 version 4 IDs without randomUUID', () => {
  const provider = {getRandomValues(bytes) { bytes.fill(255); return bytes; }};
  assert.equal(randomUUID(provider), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  const fallback = {getRandomValues: bytes => globalThis.crypto.getRandomValues(bytes)};
  const ids = Array.from({length: 100}, () => randomUUID(fallback));
  assert.equal(new Set(ids).size, 100);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('reports an actionable error when secure randomness is unavailable', () => {
  assert.throws(() => randomUUID({}), /Update your browser/);
});
