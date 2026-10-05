export function validateEndpoint(value) {
  const url = new URL(value);
  if (url.origin !== 'https://script.google.com' || !/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname) || url.search || url.hash) throw new Error('Use the deployed Apps Script URL ending in /exec.');
  return url.href;
}
export const MAX_REQUEST_CHARS = 100000;
export const ACCESS_CHANGED_EVENT = 'rf:access-changed';
export const accessTokenKey = endpoint => `rf.access-token:${validateEndpoint(endpoint)}`;
export function readAccessToken(endpoint) {
  try { return sessionStorage.getItem(accessTokenKey(endpoint)) || ''; } catch { return ''; }
}
export function serializeRequest(endpoint, transaction, action = 'create', accessToken = readAccessToken(endpoint)) {
  const body = JSON.stringify({action:transaction ? action : 'list',transaction:transaction ?? {},...(accessToken ? {accessToken} : {})});
  if (body.length > MAX_REQUEST_CHARS) throw new Error('This record contains too much detail for Google Sheets. Split the invoice into smaller invoices before saving.');
  return body;
}
// Apps Script may spend 25 seconds waiting for its write lock before doing work.
export const REQUEST_TIMEOUT_MS = 60000;
const READ_ACTIONS = new Set(['list', 'listDeleted', 'listAccounts', 'getInvoices', 'listStock']);
const CREATE_ACTIONS = new Set(['create', 'createParty', 'createInvoice', 'createInvoiceNote', 'importStock', 'createStockItem', 'recordStock', 'reviewInvoiceStock', 'reverseStock']);
const EDIT_ACTIONS = new Set(['update', 'updateParty', 'updateInvoice', 'updateInvoiceNote']);
function safeToRetry(transaction, action) {
  return !transaction || READ_ACTIONS.has(action) || Boolean(transaction.id &&
    (CREATE_ACTIONS.has(action) || EDIT_ACTIONS.has(action) && transaction._editId));
}
function connectionError(message, retryable = false) {
  const error = new Error(message);
  // Transport failures are not rejected business records: keep the durable queue.
  error.retryable = retryable;
  return error;
}
export function createRequest({fetchImpl = (...args) => fetch(...args), wait = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutSignal = ms => AbortSignal.timeout(ms)} = {}) {
  return async function request(endpoint, transaction, action = 'create', options = {}) {
    validateEndpoint(endpoint);
    // Serialize once: an ambiguous upload must retry the same ID and edit token.
    const body = serializeRequest(endpoint, transaction, action, options.accessToken ?? readAccessToken(endpoint));
    for (let attempt = 0; ; attempt++) {
      try {
        const fetchOptions = {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body, redirect:'follow', cache:'no-store', credentials:'omit', signal:timeoutSignal(REQUEST_TIMEOUT_MS)};
        const response = await fetchImpl(endpoint, fetchOptions);
        if ([401,403].includes(response.status) || /accounts\.google\.com/.test(response.url || '')) {
          throw connectionError('Google requires permission to access this deployment. Check Apps Script deployment access and authorize the script owner; refreshing cannot fix permissions.');
        }
        if (!response.ok) throw connectionError('Google Sheets could not be reached. Your saved changes remain on this device. Please retry.', [408,429,500,502,503,504].includes(response.status));
        const text = await response.text();
        if (/^\s*</.test(text)) {
          throw connectionError(/sign.?in|sign.?out|accounts\.google|authorization|permission/i.test(text)
            ? 'Google returned a sign-in or permission page instead of your ledger. Check Apps Script deployment access and authorize the script owner.'
            : 'Google returned a page instead of ledger data. Check the deployed Apps Script URL and its access settings.');
        }
        let result;
        try { result = JSON.parse(text); }
        catch { throw connectionError('Google Sheets returned an invalid response. Please retry.', true); }
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw connectionError('Google Sheets did not return ledger data. Check the deployed Apps Script URL.');
        if (!result.ok) {
          const error = new Error(result.error || 'Google Sheets returned an error.');
          // A lock wait failure means Google never started this operation.
          if (result.code === 'REQUEST_FAILED' && /timed?\s*out|\btimeout\b/i.test(error.message)) error.retryable = true;
          else error.code = result.code;
          throw error;
        }
        if (!transaction && !Array.isArray(result.transactions)) throw new Error('This URL did not return a ledger. Deploy the Code.gs provided in Settings and try again.');
        return result;
      } catch (cause) {
        let error = cause;
        if (['TimeoutError','AbortError'].includes(cause.name)) error = connectionError('Google Sheets took too long to respond. Your saved changes remain on this device; retry to confirm them.', true);
        else if (cause instanceof TypeError) error = connectionError('Connection to Google Sheets was interrupted. Your saved changes remain on this device. Check your connection or deployment access.', true);
        if (attempt >= 1 || !error.retryable || !safeToRetry(transaction, action) || globalThis.navigator?.onLine === false) throw error;
        await wait(1500);
      }
    }
  };
}
export const request = createRequest();
