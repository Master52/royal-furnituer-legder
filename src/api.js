export function validateEndpoint(value) {
  const url = new URL(value);
  if (url.origin !== 'https://script.google.com' || !/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname) || url.search || url.hash) throw new Error('Use the deployed Apps Script URL ending in /exec.');
  return url.href;
}
export async function request(endpoint, transaction, action = 'create') {
  validateEndpoint(endpoint);
  const response = await fetch(endpoint, transaction ? { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, transaction }), redirect: 'follow', cache:'no-store', signal: AbortSignal.timeout(30000) } : { redirect: 'follow', cache:'no-store', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Google Sheets could not be reached. Please retry.');
  const result = await response.json();
  if (!result.ok) { const error = new Error(result.error || 'Google Sheets returned an error.'); error.code = result.code; throw error; }
  if (!transaction && !Array.isArray(result.transactions)) throw new Error('This URL did not return a ledger. Deploy the Code.gs provided in Settings and try again.');
  return result;
}
