import test from 'node:test';
import assert from 'node:assert/strict';
import { applyQueuedOperation, overlayOutbox, queueRecord } from '../src/outbox.js';

test('pending creates appear optimistically and queue metadata is excluded from the request', () => {
  const payment = { id:'new-1', amountMinor:1200, _action:'create', _queueId:'q1', _status:'queued', _endpoint:'sheet' };
  assert.deepEqual(overlayOutbox([], [payment]), [{ id:'new-1', amountMinor:1200, _action:'create' }]);
  assert.deepEqual(queueRecord(payment), { id:'new-1', amountMinor:1200, _action:'create' });
});

test('updates retain the original creation metadata and deletes remove only their row', () => {
  const original = { id:'a', amountMinor:100, createdAt:'original', revision:3 };
  const updated = { id:'a', amountMinor:250, createdAt:'changed', revision:4, _action:'update', _expectedRevision:3, _editId:'edit-1', _queueId:'q2' };
  assert.deepEqual(applyQueuedOperation([original], updated), [{ ...original, amountMinor:250, _action:'update', _expectedRevision:3, _editId:'edit-1' }]);
  assert.deepEqual(applyQueuedOperation([original,{id:'b'}], {id:'a',_action:'delete'}), [{id:'b'}]);
});

test('queued operations apply in order so later changes win', () => {
  const rows=overlayOutbox([], [{id:'a',amountMinor:100,_action:'create'},{id:'a',amountMinor:200,_action:'update'}]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].amountMinor,200);
});
