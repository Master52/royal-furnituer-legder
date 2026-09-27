const DB_NAME = 'shop-ledger-browser-settings';
const STORE_NAME = 'settings';
const ENDPOINT_KEY = 'rf.endpoint';

export function readEndpoint() {
  try {
    const value = JSON.parse(localStorage.getItem(ENDPOINT_KEY));
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('Browser storage unavailable'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Browser storage unavailable'));
    request.onblocked = () => reject(new Error('Browser storage is blocked'));
  });
}

async function indexedDbRequest(mode, action) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Browser storage unavailable'));
      transaction.onabort = () => reject(transaction.error || new Error('Browser storage unavailable'));
    });
  } finally {
    db.close();
  }
}

export async function loadEndpoint() {
  const local = readEndpoint();
  if (local) return local;
  try {
    const saved = await indexedDbRequest('readonly', store => store.get(ENDPOINT_KEY));
    if (typeof saved !== 'string') return '';
    try { localStorage.setItem(ENDPOINT_KEY, JSON.stringify(saved)); } catch { /* IndexedDB remains the fallback. */ }
    return saved;
  } catch {
    return '';
  }
}

export async function saveEndpoint(value) {
  let saved = false;
  try { localStorage.setItem(ENDPOINT_KEY, JSON.stringify(value)); saved = true; } catch { /* Try IndexedDB below. */ }
  try { await indexedDbRequest('readwrite', store => store.put(value, ENDPOINT_KEY)); saved = true; } catch { /* Keep whichever store accepted it. */ }
  if (!saved) throw new Error('The sheet connected, but this browser blocked saving its link. Allow site storage and connect again.');
}

export async function clearEndpoint() {
  try { localStorage.removeItem(ENDPOINT_KEY); } catch { /* Try IndexedDB below. */ }
  try { await indexedDbRequest('readwrite', store => store.delete(ENDPOINT_KEY)); } catch {
    if (readEndpoint()) throw new Error('Could not remove the saved connection. Check browser storage permissions.');
  }
}
