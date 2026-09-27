import { localNow } from './ledger.js';
export function newEntry(previous = {}) {
  return { amount: '', direction: previous.direction || 'in', category: previous.category || 'Sale', method: previous.method || 'Cash', party: '', notes: '', dateTime: localNow(), chequeDate: '', customDate: false };
}
export function hasDraft(form) { return Boolean(form.amount || form.party || form.notes || form.chequeDate || form.customDate); }
export function editEntry(t) {
  return { amount:(Number(t.amountMinor)/100).toFixed(2), direction:t.direction, category:t.category, method:t.method, party:t.party || '', notes:t.notes || '', dateTime:`${t.transactionDate}T${t.transactionTime}`, chequeDate:t.chequeDate || '', customDate:true };
}
export function shortcutAction(event) {
  if (event.repeat || event.isComposing || event.getModifierState?.('AltGraph')) return null;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && key === 'enter') return 'save';
  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'enter') return 'amount';
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  return {
    n: 'new', i: 'in', o: 'out',
    s: 'Sale', p: 'Purchase', b: 'Bhara', e: 'Expense',
    '1': 'Sale', '2': 'Purchase', '3': 'Bhara', '4': 'Expense',
    c: 'Cash', l: 'Online', q: 'vendor', v: 'notes',
  }[key] || null;
}

export function focusAndCenter(element) {
  if (!element || typeof element.focus !== 'function') return;
  element.focus({ preventScroll: true });
  const scroll = () => element.scrollIntoView?.({ behavior: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(scroll);
  else scroll();
}
