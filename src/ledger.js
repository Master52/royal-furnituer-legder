export const categories = ['Sale', 'Purchase', 'Bhara', 'Expense'];
export const methods = ['Cash', 'Online', 'Cheque'];
export const SHOP_TIMEZONE = 'Asia/Kolkata';
export const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value / 100);
export function localNow() {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_TIMEZONE, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(d);
  const part = type => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
export function periodRange(period, now = new Date(), timeZone = SHOP_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(now);
  const year = Number(parts.find(item => item.type === 'year').value);
  const month = Number(parts.find(item => item.type === 'month').value);
  const day = parts.find(item => item.type === 'day').value;
  const date = (y,m,d) => `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  if (period === 'today') return [date(year,month,day), date(year,month,day)];
  const offset = period === 'last' ? -1 : 0;
  const start = new Date(Date.UTC(year, month - 1 + offset, 1));
  const end = new Date(Date.UTC(year, month + offset, 0));
  return [date(start.getUTCFullYear(), start.getUTCMonth()+1, 1), date(end.getUTCFullYear(), end.getUTCMonth()+1, end.getUTCDate())];
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
  return { id, schemaVersion: 1, transactionDate: form.dateTime.slice(0,10), transactionTime: form.dateTime.slice(11,16), timezone: SHOP_TIMEZONE, direction: form.direction, category: form.category, method: form.method, amountMinor: Math.round(amount * 100), currency: 'INR', party: (form.party || '').trim(), notes: (form.notes || '').trim(), chequeDate: form.method === 'Cheque' ? form.chequeDate : '', createdAt: new Date().toISOString(), metadata: '{}' };
}
