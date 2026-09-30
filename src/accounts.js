import { localNow, transactionIntegrityIssue, duplicateTransactionIds } from './ledger.js';

export const ACCOUNTS_VERSION = '1.8.0';
export const MAX_MINOR = 100000000000;
export function minor(value, label = 'amount') {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  const amount = match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : NaN;
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_MINOR) throw new Error(`Enter a valid ${label} with at most two decimal places.`);
  return amount;
}
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export const blankItem = () => ({ description: '', quantity: '1', rate: '', discount: '0', cost: '' });
export const blankInvoice = () => ({ partyId: '', type: 'sale', invoiceNumber: '', invoiceDate: localNow().slice(0, 10), notes: '', items: [blankItem()] });
export function makeParty(form, id = crypto.randomUUID()) {
  const name = form.name.trim();
  if (!name || name.length > 150) throw new Error('Enter a party name (up to 150 characters).');
  if (!validDate(form.openingDate)) throw new Error('Choose the opening balance date.');
  return { id, schemaVersion: 1, name, phone: form.phone.trim(), address: form.address.trim(), openingDate: form.openingDate, openingBalanceMinor: minor(form.openingBalance || '0', 'opening balance') * (form.openingDirection === 'payable' ? -1 : 1) };
}
export function makeInvoice(form, id = crypto.randomUUID()) {
  if (!form.partyId || !['sale', 'purchase'].includes(form.type)) throw new Error('Choose a party and invoice type.');
  if (form.invoiceNumber && form.invoiceNumber.trim().length > 80) throw new Error('Invoice number is too long.');
  if (!validDate(form.invoiceDate)) throw new Error('Choose a valid invoice date.');
  if (!form.items.length || form.items.length > 50) throw new Error('Add between 1 and 50 invoice items.');
  let totalMinor = 0, costTotalMinor = 0, completeCost = true;
  const items = form.items.map((item, index) => {
    const description = item.description.trim();
    if (!description || description.length > 300) throw new Error(`Enter a description for item ${index + 1}.`);
    const quantityMilli = Math.round(Number(item.quantity) * 1000);
    if (!/^\d+(\.\d{1,3})?$/.test(String(item.quantity)) || !Number.isSafeInteger(quantityMilli) || quantityMilli <= 0 || quantityMilli > 1000000000) throw new Error('Quantity must be positive with at most three decimal places.');
    const rateMinor = minor(item.rate, 'rate'), discountMinor = minor(item.discount || '0', 'line discount');
    if (!Number.isSafeInteger(rateMinor * quantityMilli)) throw new Error('Item amount is too large.');
    const lineTotalMinor = Math.round(rateMinor * quantityMilli / 1000) - discountMinor;
    if (lineTotalMinor < 0 || lineTotalMinor > MAX_MINOR) throw new Error('Line discount cannot exceed the item value.');
    const costMinor = form.type === 'sale' && item.cost !== '' ? minor(item.cost, 'unit cost') : null;
    if (costMinor !== null && !Number.isSafeInteger(costMinor * quantityMilli)) throw new Error('Item cost is too large.');
    const lineCostMinor = costMinor === null ? null : Math.round(costMinor * quantityMilli / 1000);
    totalMinor += lineTotalMinor;
    if (lineCostMinor === null) completeCost = false; else costTotalMinor += lineCostMinor;
    return { id: `${id}-${index + 1}`, invoiceId: id, description, quantityMilli, rateMinor, discountMinor, lineTotalMinor, costMinor, lineCostMinor };
  });
  if (totalMinor <= 0 || totalMinor > MAX_MINOR || costTotalMinor > MAX_MINOR) throw new Error('Invoice total must be positive and within the supported amount limit.');
  return { id, schemaVersion: 1, partyId: form.partyId, type: form.type, invoiceNumber: '', invoiceDate: form.invoiceDate, notes: form.notes.trim(), currency: 'INR', totalMinor, costTotalMinor: completeCost ? costTotalMinor : null, items };
}

export function findParties(parties, query, limit = 8) {
  const clean = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const term = clean(query);
  if (!term) return [...parties].sort((a,b)=>a.name.localeCompare(b.name)).slice(0,limit);
  const tokens = term.split(' ');
  return parties.map(party=>{
    const name=clean(party.name),phone=clean(party.phone);
    const words=name.split(' ');
    let score=0;
    if(name===term)score=1000;
    else if(name.startsWith(term))score=800;
    else if(words.some(word=>word.startsWith(term)))score=650;
    else if(tokens.every(token=>words.some(word=>word.startsWith(token))))score=500;
    else if(name.includes(term))score=350;
    else if(phone.includes(term))score=300;
    else {
      let index=0;
      for(const char of name)if(char===term[index])index++;
      if(index===term.length)score=100;
    }
    return {party,score};
  }).filter(row=>row.score>0).sort((a,b)=>b.score-a.score||a.party.name.localeCompare(b.party.name)).slice(0,limit).map(row=>row.party);
}

export function partyStatement(party, invoices, transactions, start = '0000-01-01', end = '9999-12-31') {
  const events = [];
  if (Number(party.openingBalanceMinor)) events.push({ id: `opening-${party.id}`, date: party.openingDate, sort: '0', description: 'Opening balance', delta: Number(party.openingBalanceMinor) });
  for (const invoice of invoices) {
    if (invoice.partyId !== party.id || invoice.status !== 'issued') continue;
    events.push({ id: invoice.id, date: invoice.invoiceDate, sort: `1-${invoice.createdAt}-${invoice.id}`, description: `${invoice.type === 'sale' ? 'Sales' : 'Purchase'} invoice ${invoice.invoiceNumber}`, delta: Number(invoice.totalMinor) * (invoice.type === 'sale' ? 1 : -1), invoice });
  }
  const duplicates = duplicateTransactionIds(transactions);
  for (const t of transactions) {
    if (t.partyId !== party.id || t.deletedAt || (t.recordType && t.recordType !== 'payment')) continue;
    if (duplicates.has(t.id) || transactionIntegrityIssue(t)) throw new Error('A linked payment is invalid or duplicated. Correct it before using this party balance.');
    events.push({ id: t.id, date: t.transactionDate, sort: `2-${t.transactionTime}-${t.id}`, description: `Payment ${t.direction === 'in' ? 'received' : 'made'} · ${t.method}`, notes: t.notes, delta: Number(t.amountMinor) * (t.direction === 'in' ? -1 : 1) });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.sort.localeCompare(b.sort));
  let balance = 0, opening = 0;
  const entries = [];
  for (const event of events) {
    if (event.date > end) continue;
    balance += event.delta;
    if (event.date < start) opening = balance;
    else entries.push({ ...event, balance });
  }
  return { opening, closing: balance, entries };
}
export function invoiceSummary(invoices, start, end) {
  const result = { sales: 0, purchases: 0, grossProfit: 0, missingCosts: 0, costedSales: 0 };
  for (const inv of invoices) {
    if (inv.status !== 'issued' || inv.invoiceDate < start || inv.invoiceDate > end) continue;
    if (inv.type === 'purchase') result.purchases += Number(inv.totalMinor);
    else {
      result.sales += Number(inv.totalMinor);
      if (inv.costTotalMinor === null || inv.costTotalMinor === '') result.missingCosts++;
      else { result.costedSales++; result.grossProfit += Number(inv.totalMinor) - Number(inv.costTotalMinor); }
    }
  }
  return result;
}

// Index balances once rather than scanning every invoice/payment for every party.
export function accountBalances(parties,invoices,transactions){
  const rows=new Map(parties.map(party=>[party.id,{party,balance:Number(party.openingBalanceMinor)||0,error:''}]));
  const duplicates=duplicateTransactionIds(transactions);
  for(const invoice of invoices){const row=rows.get(invoice.partyId);if(row&&invoice.status==='issued')row.balance+=Number(invoice.totalMinor)*(invoice.type==='sale'?1:-1);}
  for(const payment of transactions){
    const row=rows.get(payment.partyId);
    if(!row||payment.deletedAt||payment.recordType&&payment.recordType!=='payment')continue;
    if(duplicates.has(payment.id)||transactionIntegrityIssue(payment)){row.error='A linked payment is invalid or duplicated.';continue;}
    row.balance+=Number(payment.amountMinor)*(payment.direction==='in'?-1:1);
  }
  return [...rows.values()].map(row=>({...row,balance:row.error?null:row.balance}));
}
export function invoiceDraftFromRecord(saved){
  return {...blankInvoice(),partyId:saved.partyId,type:saved.type,invoiceDate:saved.invoiceDate,notes:saved.notes||'',items:saved.items.map(item=>({description:item.description,quantity:String(item.quantityMilli/1000),rate:(item.rateMinor/100).toFixed(2),discount:(item.discountMinor/100).toFixed(2),cost:item.costMinor==null||item.costMinor===''?'':(item.costMinor/100).toFixed(2)}))};
}
