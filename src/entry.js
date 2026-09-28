import { localNow } from './ledger.js';
export function newEntry(previous = {}) {
  const category=['Sale','Purchase','Bhara','Expense'].includes(previous.category)?previous.category:'Sale';
  const method=['Cash','Online','Cheque'].includes(previous.method)?previous.method:'Cash';
  return { amount: '', direction: previous.direction==='out'?'out':'in', category, method, party: '', notes: '', dateTime: localNow(), chequeDate: '', customDate: false, recordType:'payment', exchangeDirection:'receive-cash-send-online', cashReceived:'', cashChange:'', onlineChange:'' };
}
export function hasDraft(form) { return Boolean(form.amount || form.party || form.notes || form.chequeDate || form.cashReceived || form.cashChange || form.onlineChange || form.customDate || form.recordType==='transfer'); }
export function editEntry(t) {
  return { amount:(Number(t.amountMinor)/100).toFixed(2), direction:t.direction, category:t.category, method:t.method, party:t.party || '', notes:t.notes || '', dateTime:`${t.transactionDate}T${t.transactionTime}`, chequeDate:t.chequeDate || '', customDate:true, recordType:t.recordType==='transfer'?'transfer':'payment', exchangeDirection:t.fromMethod==='Online'?'receive-cash-send-online':'receive-online-give-cash', cashReceived:t.cashReceivedMinor!=='' && t.cashReceivedMinor!=null?(Number(t.cashReceivedMinor)/100).toFixed(2):'', cashChange:t.cashChangeMinor!=='' && t.cashChangeMinor!=null?(Number(t.cashChangeMinor)/100).toFixed(2):'', onlineChange:t.onlineChangeMinor!=='' && t.onlineChangeMinor!=null?(Number(t.onlineChangeMinor)/100).toFixed(2):'' };
}
export function shortcutAction(event) {
  if (event.repeat || event.isComposing || event.getModifierState?.('AltGraph')) return null;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && key === 'enter') return 'save';
  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'enter') return 'amount';
  if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && (key === '1' || event.code === 'Digit1')) return 'exchange-cash-online';
  if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && (key === '2' || event.code === 'Digit2')) return 'exchange-online-cash';
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  return {
    n: 'new', i: 'in', o: 'out',
    s: 'Sale', p: 'Purchase', b: 'Bhara', e: 'Expense',
    '1': 'Sale', '2': 'Purchase', '3': 'Bhara', '4': 'Expense',
    c: 'Cash', l: 'Online', q: 'vendor', v: 'notes',
    m: 'payment-mode', x: 'exchange-mode', r: 'cash-received', h: 'cash-change', j: 'online-change',
  }[key] || null;
}

export function focusAndCenter(element) {
  if (!element || typeof element.focus !== 'function') return;
  element.focus({ preventScroll: true });
  const scroll = () => element.scrollIntoView?.({ behavior: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(scroll);
  else scroll();
}
