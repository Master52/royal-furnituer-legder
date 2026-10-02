import {blankCheckout} from './invoiceCheckout.js';
import {MAX_MINOR,minor,invoiceDiscount} from './invoiceAmounts.js';
import {scaledInput,draftMeasurements,billingQuantity_,billingPrice_,measurementDraftFromItem} from './measurements.js';
import { localNow, transactionIntegrityIssue, duplicateTransactionIds, hasSettlement, SHOP_TIMEZONE } from './ledger.js';

export const ACCOUNTS_VERSION = '1.8.0';
export {MAX_MINOR,minor} from './invoiceAmounts.js';
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export const blankItem = () => ({ description: '', quantity: '1', rate: '', discount: '0', cost: '',itemNote:'',grouped:false,billingUnit:'',measurementUnit:'feet',measurementMode:'quantity',measurements:[] });
export const blankInvoice = () => ({ partyId: '', walkIn:false, paymentWithInvoice:false, discountMode:'amount', discount:'0', checkout:blankCheckout(), type: 'sale', invoiceNumber: '', challanNumber:'', invoiceDate: localNow().slice(0, 10), notes: '', items: [blankItem()] });
export function makeParty(form, id = crypto.randomUUID()) {
  const name = form.name.trim();
  if (!name || name.length > 150) throw new Error('Enter a party name (up to 150 characters).');
  if (!validDate(form.openingDate)) throw new Error('Choose the opening balance date.');
  return { id, schemaVersion: 1, name, phone: form.phone.trim(), address: form.address.trim(), openingDate: form.openingDate, openingBalanceMinor: minor(form.openingBalance || '0', 'opening balance') * (form.openingDirection === 'payable' ? -1 : 1) };
}
export function makeInvoice(form, id = crypto.randomUUID()) {
  if ((!form.partyId&&!form.walkIn) || !['sale', 'purchase'].includes(form.type) || form.walkIn&&form.type!=='sale') throw new Error('Choose a party and invoice type.');
  if (form.invoiceNumber && form.invoiceNumber.trim().length > 80) throw new Error('Invoice number is too long.');
  if(typeof (form.challanNumber??'')!=='string'||(form.challanNumber??'').trim().length>80)throw new Error('Challan number must be at most 80 characters.');
  if (!validDate(form.invoiceDate)) throw new Error('Choose a valid invoice date.');
  if (!form.items.length || form.items.length > 50) throw new Error('Add between 1 and 50 invoice items.');
  let totalMinor = 0, costTotalMinor = 0, completeCost = true;
  const items = form.items.map((item, index) => {
    const description = item.description.trim();
    if(typeof (item.itemNote??'')!=='string'||(item.itemNote??'').trim().length>500)throw new Error(`Item ${index+1} description must be at most 500 characters.`);
    const itemNote=(item.itemNote||'').trim();
    if (!description || description.length > 300) throw new Error(`Enter a description for item ${index + 1}.`);
    const measurements=draftMeasurements(item),unit=item.billingUnit||'';
    const quantity=billingQuantity_({...item,quantityMilli:measurements.length?0:scaledInput(item.quantity,'Quantity'),measurements});
    const quantityMilli=quantity.quantityMilli;
    const rateMinor = minor(item.rate, 'rate'), discountMinor = minor(item.discount || '0', 'line discount');
    const lineTotalMinor = billingPrice_(rateMinor,quantity) - discountMinor;
    if (lineTotalMinor < 0 || lineTotalMinor > MAX_MINOR) throw new Error('Line discount cannot exceed the item value.');
    const costMinor = form.type === 'sale' && item.cost !== '' && item.cost!=null ? minor(item.cost, 'unit cost') : null;
    const lineCostMinor = costMinor === null ? null : billingPrice_(costMinor,quantity);
    totalMinor += lineTotalMinor;
    if (lineCostMinor === null) completeCost = false; else costTotalMinor += lineCostMinor;
    return { id: `${id}-${index + 1}`, invoiceId: id, description,...(itemNote?{itemNote}:{}), quantityMilli, rateMinor, discountMinor, lineTotalMinor, costMinor, lineCostMinor,...(unit?{billingUnit:unit,measurementUnit:['sqft','rft'].includes(unit)?item.measurementUnit:'',measurementMode:item.measurementMode||'quantity',measurementCount:measurements.length,measurements}: {}) };
  });
  if(items.reduce((sum,item)=>sum+(item.measurements?.length||0),0)>1000)throw new Error('An invoice supports at most 1,000 measurement rows.');
  if (totalMinor <= 0 || totalMinor > MAX_MINOR || costTotalMinor > MAX_MINOR) throw new Error('Invoice total must be positive and within the supported amount limit.');
  const discount=invoiceDiscount(totalMinor,form.discountMode||'amount',form.discount||'0');
  totalMinor-=discount.invoiceDiscountMinor;
  if(totalMinor<=0)throw new Error('Invoice total after discount must be positive.');
  return { id, schemaVersion: 1, invoiceDiscountSchemaVersion:1,...discount,invoicePaymentSchemaVersion:1,...(form.walkIn?{walkIn:true}:{}),...(form.walkIn||form.paymentWithInvoice||form.paymentId===`${id}-payment`?{paymentId:`${id}-payment`}:{}), measurementSchemaVersion: 1, itemDescriptionSchemaVersion: 1, partyId: form.walkIn?'':form.partyId, type: form.type, invoiceNumber: '', challanNumber:(form.challanNumber||'').trim(), invoiceDate: form.invoiceDate, notes: form.notes.trim(), currency: 'INR', totalMinor, costTotalMinor: completeCost ? costTotalMinor : null, items };
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

const statementTimeFormatter = new Intl.DateTimeFormat('en-GB', {timeZone: SHOP_TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});
function statementTime(createdAt) {
  const timestamp = Date.parse(createdAt);
  return Number.isFinite(timestamp) ? statementTimeFormatter.format(new Date(timestamp)) : '00:00:00';
}
export function historyInvoices(invoices, start, end, category = '', query = '') {
  const search = query.trim().toLowerCase();
  return invoices.filter(invoice => invoice.invoiceDate >= start && invoice.invoiceDate <= end
    && (!category || category === (invoice.type === 'sale' ? 'Sale' : 'Purchase'))
    && (!search || [invoice.invoiceNumber, invoice.partyName, invoice.notes,invoice.challanNumber,invoice.itemSearch, ...(invoice.items || []).flatMap(item => [item.description,item.itemNote,...(item.measurements||[]).map(row=>row.description)])].join(' ').toLowerCase().includes(search)))
    .sort((a,b) => b.invoiceDate.localeCompare(a.invoiceDate) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || b.id.localeCompare(a.id));
}
export function partyStatement(party, invoices, transactions, start = '0000-01-01', end = '9999-12-31', notes = []) {
  const events = [];
  if (Number(party.openingBalanceMinor)) events.push({ id: `opening-${party.id}`, date: party.openingDate, sort: '', description: 'Opening balance', delta: Number(party.openingBalanceMinor) });
  for (const invoice of invoices) {
    if (invoice.partyId !== party.id || invoice.status !== 'issued') continue;
    events.push({ id: invoice.id, date: invoice.invoiceDate, sort: `${statementTime(invoice.createdAt)}-${invoice.createdAt || ''}-${invoice.id}`, description: `${invoice.type === 'sale' ? 'Sales' : 'Purchase'} invoice ${invoice.invoiceNumber}`, delta: Number(invoice.totalMinor) * (invoice.type === 'sale' ? 1 : -1), invoice });
  }
  for(const note of notes){
    if(note.partyId!==party.id||note.status!=='issued')continue;
    events.push({id:note.id,date:note.noteDate,sort:`${statementTime(note.createdAt)}-${note.createdAt || ''}-${note.id}`,description:`${note.type==='credit'?'Credit':'Debit'} note ${note.noteNumber} · ${note.invoiceNumber}`,notes:note.reason,delta:notePartyDelta(note)});
  }
  const duplicates = duplicateTransactionIds(transactions);
  for (const t of transactions) {
    if (t.partyId !== party.id || t.deletedAt || (t.recordType && t.recordType !== 'payment')) continue;
    if (duplicates.has(t.id) || transactionIntegrityIssue(t)) throw new Error('A linked payment is invalid or duplicated. Correct it before using this party balance.');
    if(hasSettlement(t)&&Number(t.settlementDiscountMinor)>0)events.push({id:`${t.id}-settlement`,date:t.transactionDate,sort:`${t.transactionTime.length===5?t.transactionTime+':00':t.transactionTime}-${t.createdAt||''}-${t.id}-settlement`,description:'Full & final settlement discount',notes:t.notes,delta:-Number(t.settlementDiscountMinor)});
    events.push({ id: t.id, date: t.transactionDate, sort: `${t.transactionTime.length === 5 ? t.transactionTime + ':00' : t.transactionTime}-${t.createdAt || ''}-${t.id}`, description: `Payment ${t.direction === 'in' ? 'received' : 'made'} · ${t.method}`, notes: t.notes, delta: Number(t.amountMinor) * (t.direction === 'in' ? -1 : 1) });
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
export function invoiceSummary(invoices, start, end, notes = []) {
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
  for(const note of notes){
    if(note.status!=='issued'||note.noteDate<start||note.noteDate>end)continue;
    const value=noteValueSign(note)*Number(note.amountMinor);
    if(note.invoiceType==='purchase')result.purchases+=value;
    else {
      result.sales+=value;
      if(note.costAdjustmentMinor===null||note.costAdjustmentMinor==='')result.missingCosts++;
      else result.grossProfit+=value-noteValueSign(note)*Number(note.costAdjustmentMinor);
    }
  }
  return result;
}

// Index balances once rather than scanning every invoice/payment for every party.
export function accountBalances(parties,invoices,transactions,notes=[]){
  const rows=new Map(parties.map(party=>[party.id,{party,balance:Number(party.openingBalanceMinor)||0,error:''}]));
  const duplicates=duplicateTransactionIds(transactions);
  for(const invoice of invoices){const row=rows.get(invoice.partyId);if(row&&invoice.status==='issued')row.balance+=Number(invoice.totalMinor)*(invoice.type==='sale'?1:-1);}
  for(const note of notes){const row=rows.get(note.partyId);if(row&&note.status==='issued')row.balance+=notePartyDelta(note);}
  for(const payment of transactions){
    const row=rows.get(payment.partyId);
    if(!row||payment.deletedAt||payment.recordType&&payment.recordType!=='payment')continue;
    if(duplicates.has(payment.id)||transactionIntegrityIssue(payment)){row.error='A linked payment is invalid or duplicated.';continue;}
    row.balance+=Number(payment.amountMinor)*(payment.direction==='in'?-1:1)-Number(payment.settlementDiscountMinor||0);
  }
  return [...rows.values()].map(row=>({...row,balance:row.error?null:row.balance}));
}
export function invoiceDraftFromRecord(saved){
  return {...blankInvoice(),partyId:saved.partyId,walkIn:Boolean(saved.walkIn),paymentWithInvoice:Boolean(saved.payment&&!saved.walkIn),paymentId:saved.paymentId||'',discountMode:saved.discountMode||'amount',discount:String(Number(saved.discountValue||0)/100),checkout:saved.payment?{amount:String(Number(saved.payment.amountMinor)/100),method:saved.payment.method,cashReceived:saved.payment.cashReceivedMinor===''?'':String(Number(saved.payment.cashReceivedMinor)/100),cashChange:saved.payment.cashChangeMinor===''?'':String(Number(saved.payment.cashChangeMinor)/100),onlineChange:saved.payment.onlineChangeMinor===''?'':String(Number(saved.payment.onlineChangeMinor)/100)}:blankCheckout(),type:saved.type,invoiceDate:saved.invoiceDate,challanNumber:saved.challanNumber||'',notes:saved.notes||'',items:saved.items.map(item=>({description:item.description,itemNote:item.itemNote||'',quantity:String(item.quantityMilli/1000),rate:(item.rateMinor/100).toFixed(2),discount:(item.discountMinor/100).toFixed(2),cost:item.costMinor==null||item.costMinor===''?'':(item.costMinor/100).toFixed(2),...measurementDraftFromItem(item)}))};
}


export const noteValueSign = note => note.type === 'credit' ? -1 : 1;
export const notePartyDelta = note => noteValueSign(note) * Number(note.amountMinor) * (note.invoiceType === 'sale' ? 1 : -1);
export function makeInvoiceNote(form, invoice, id = crypto.randomUUID()) {
  if(!invoice || invoice.status!=='issued' || !['credit','debit'].includes(form.type) || !['price','return'].includes(form.effect))throw new Error('Choose an issued invoice and correction type.');
  if(!validDate(form.noteDate) || form.noteDate<invoice.invoiceDate)throw new Error('A correction note cannot predate its invoice.');
  const reason=String(form.reason||'').trim();
  if(!reason || reason.length>1000)throw new Error('Enter a reason for this correction (up to 1000 characters).');
  const amountMinor=minor(form.amount,'correction amount');
  if(!amountMinor)throw new Error('Correction amount must be positive.');
  const costAdjustmentMinor=invoice.type==='purchase'||form.effect==='price'?0:form.cost===''?null:minor(form.cost,'cost correction');
  return {id,schemaVersion:1,invoiceId:invoice.id,type:form.type,noteDate:form.noteDate,reason,effect:form.effect,amountMinor,costAdjustmentMinor,currency:'INR',_expectedRevision:Number(invoice.revision||0)};
}
export function invoiceNetValue(invoice, notes = []) {
  return Number(invoice.totalMinor)+notes.filter(note=>note.invoiceId===invoice.id&&note.status==='issued').reduce((sum,note)=>sum+noteValueSign(note)*Number(note.amountMinor),0);
}
export function historyNotes(notes, start, end, category='', query='') {
  const search=query.trim().toLowerCase();
  return notes.filter(note=>note.status!=='deleted'&&note.noteDate>=start&&note.noteDate<=end&&(!category||category===(note.invoiceType==='sale'?'Sale':'Purchase'))&&(!search||[note.noteNumber,note.invoiceNumber,note.partyName,note.reason].join(' ').toLowerCase().includes(search)))
    .sort((a,b)=>b.noteDate.localeCompare(a.noteDate)||String(b.createdAt||'').localeCompare(String(a.createdAt||''))||b.id.localeCompare(a.id));
}

export function invoiceNoteRevision(notes,invoiceId){return notes.filter(note=>note.invoiceId===invoiceId&&note.status!=='deleted').map(note=>note.id+':'+Number(note.revision||0)).sort().join('|');}

export function invoiceNeedsCost(invoice){return invoice.type==='sale'&&['issued','pending'].includes(invoice.status)&&(invoice.costTotalMinor==null||invoice.costTotalMinor==='');}
export function blankNoteForm(type='credit'){return {type,invoiceId:'',effect:'price',noteDate:localNow().slice(0,10),amount:'',cost:'',reason:''};}
export function noteDraftFromRecord(note){return {type:note.type,invoiceId:note.invoiceId,effect:note.effect,noteDate:note.noteDate,amount:(Number(note.amountMinor)/100).toFixed(2),cost:note.costAdjustmentMinor==null||note.costAdjustmentMinor===''?'':(Number(note.costAdjustmentMinor)/100).toFixed(2),reason:note.reason};}
