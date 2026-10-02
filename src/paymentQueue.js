import { transactionIntegrityIssue } from './ledger.js';
import { queueLock } from './accountQueue.js';

export const PAYMENT_QUEUE_KEY = 'rf.outbox';
export const LEGACY_PAYMENT_KEY = 'rf.pending';

export function readPaymentQueue(storage) {
  function parse(key, fallback) {
    const raw = storage.getItem(key);
    if (raw === null) return fallback;
    try { return JSON.parse(raw); }
    catch { throw new Error(`Saved data in ${key} is unreadable. Export recovery data before repairing it.`); }
  }
  const saved = parse(PAYMENT_QUEUE_KEY, []), legacy = parse(LEGACY_PAYMENT_KEY, null);
  if (!Array.isArray(saved)) throw new Error('The saved payment queue is invalid. Its original data has been preserved.');
  const queue = [...saved];
  if (legacy !== null && !queue.some(item => item?.id === legacy?.id && item?._editId === legacy?._editId)) queue.unshift(legacy);
  const identities = new Set();
  return queue.map(item => {
    const action = item?._action || 'create';
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string' || !item.id ||
      !['create','update','delete'].includes(action) || action !== 'delete' && transactionIntegrityIssue(item)) {
      throw new Error('A saved payment is invalid. Its original data has been preserved. Export recovery data before repairing it.');
    }
    const missingEndpoint = typeof item._endpoint !== 'string' || !item._endpoint;
    const identity=item._queueId ?? `legacy:${item.id}:${item._editId || 'create'}`;
    if(typeof identity!=='string'||!identity||identities.has(identity))throw new Error('Saved payment queue identities are invalid or duplicated. Its original data has been preserved.');
    identities.add(identity);
    return {...item, _action: action, _queueId: identity,
      _status: missingEndpoint ? 'failed' : item._status === 'uploading' ? 'queued' : item._status || 'queued',
      ...(missingEndpoint ? {_error:'Confirm the original Google Sheet before retrying this payment.', _errorCode:'MISSING_ENDPOINT'} : {})};
  });
}

export function mutatePaymentQueue(storage, change, withLock = queueLock) {
  return withLock(() => {
    const next = change(readPaymentQueue(storage));
    storage.setItem(PAYMENT_QUEUE_KEY, JSON.stringify(next));
    try { storage.removeItem(LEGACY_PAYMENT_KEY); } catch { /* The durable queue was written first. */ }
    return next;
  });
}
