export const categories = ['Sale', 'Purchase', 'Bhara', 'Expense'];
export const methods = ['Cash', 'Online', 'Cheque'];
export const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value / 100);
export function localNow() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function periodRange(period, now = new Date()) {
  const date = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  if (period === 'today') return [date(now), date(now)];
  const offset = period === 'last' ? -1 : 0;
  return [date(new Date(now.getFullYear(), now.getMonth()+offset, 1)), date(new Date(now.getFullYear(), now.getMonth()+offset+1, 0))];
}
export function filterTransactions(rows, { start, end, category = '', method = '', query = '' }) {
  return rows.filter(t => t.transactionDate >= start && t.transactionDate <= end && (!category || t.category === category) && (!method || t.method === method) && `${t.party} ${t.notes} ${t.category}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => `${b.transactionDate}T${b.transactionTime}`.localeCompare(`${a.transactionDate}T${a.transactionTime}`));
}
export function totals(rows) {
  return rows.reduce((sum, t) => ({ ...sum, [t.direction]: sum[t.direction] + Number(t.amountMinor) }), { in: 0, out: 0 });
}
export function makeTransaction(form, id = crypto.randomUUID()) {
  const amount = Number(form.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000000 || !/^\d+(\.\d{1,2})?$/.test(form.amount)) throw new Error('Enter a positive amount with up to two decimal places.');
  if (!categories.includes(form.category) || !methods.includes(form.method) || !['in','out'].includes(form.direction)) throw new Error('Choose a valid category, payment method and direction.');
  if (!form.dateTime || !Number.isFinite(Date.parse(form.dateTime))) throw new Error('Choose a valid transaction date and time.');
  if (form.method === 'Cheque' && !/^\d{4}-\d{2}-\d{2}$/.test(form.chequeDate || '')) throw new Error('Enter the date the cheque was given.');
  return { id, schemaVersion: 1, transactionDate: form.dateTime.slice(0,10), transactionTime: form.dateTime.slice(11,16), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, direction: form.direction, category: form.category, method: form.method, amountMinor: Math.round(amount * 100), currency: 'INR', party: (form.party || '').trim(), notes: (form.notes || '').trim(), chequeDate: form.method === 'Cheque' ? form.chequeDate : '', createdAt: new Date().toISOString(), metadata: '{}' };
}
