export const queueRecord = operation => {
  const { _queueId, _status, _queuedAt, _error, _errorCode, _endpoint, ...record } = operation;
  return record;
};

export function applyQueuedOperation(rows, operation) {
  if (operation._action === 'delete') return rows.filter(row => row.id !== operation.id);
  const record = queueRecord(operation);
  const current = rows.find(row => row.id === operation.id);
  const saved = operation._action === 'update' && current
    ? { ...current, ...record, createdAt: current.createdAt, revision: current.revision }
    : record;
  return [...rows.filter(row => row.id !== operation.id), saved];
}

export function overlayOutbox(rows, queue, endpoint) {
  const matching = endpoint ? queue.filter(operation => operation._endpoint === endpoint) : queue;
  return matching.reduce(applyQueuedOperation, rows);
}
