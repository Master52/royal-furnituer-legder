import test from 'node:test';
import assert from 'node:assert/strict';
import { accountBackend } from './helpers/accountBackend.js';
import { makeParty, makeInvoice, partyStatement, invoiceSummary } from '../src/accounts.js';
import { makeTransaction, paymentMethodBalance } from '../src/ledger.js';
const partyId='party-000000000000000001';
const invoiceId='invoice-00000000000000001';
const party=makeParty({name:'Rahul',phone:'123',address:'Test',openingDate:'2026-01-01',openingBalance:'0'},partyId);
const draft={partyId,type:'sale',invoiceNumber:'S-1',invoiceDate:'2026-09-01',notes:'',items:[{description:'Sofa',quantity:'1',rate:'20000',discount:'0',cost:'14000'}]};
const payment=(direction='in',amount='5000')=>makeTransaction({recordType:'payment',partyId,party:'Rahul',direction,category:direction==='in'?'Sale':'Purchase',method:'Cash',amount,dateTime:'2026-09-02T12:00'},'payment-00000000000000001');

test('party balance separates invoices from money movement and handles both directions',()=>{
  const invoice={...makeInvoice(draft,invoiceId),status:'issued'};
  const receipt=payment();
  assert.equal(partyStatement(party,[invoice],[receipt]).closing,1500000);
  assert.deepEqual(paymentMethodBalance([receipt]),{Cash:500000,Online:0});
  const purchase={...invoice,id:'purchase',type:'purchase',totalMinor:3000000};
  assert.equal(partyStatement(party,[purchase],[payment('out','10000')]).closing,-2000000);
  assert.equal(invoiceSummary([invoice],'2026-09-01','2026-09-30').grossProfit,600000);
  assert.equal(partyStatement(party,[invoice],[{...receipt,partyId:''}]).closing,2000000);
});
test('statement carries opening balance, ignores cancelled/deleted records, and never infers parties from names',()=>{
  const opening={...party,openingBalanceMinor:10000};
  const invoice={...makeInvoice(draft,invoiceId),status:'issued'};
  const result=partyStatement(opening,[invoice],[payment()],'2026-09-02','2026-09-30');
  assert.equal(result.opening,2010000);assert.equal(result.closing,1510000);assert.equal(result.entries.length,1);
  assert.equal(partyStatement(party,[{...invoice,status:'cancelled'}],[{...payment(),deletedAt:'now'}]).closing,0);
  assert.throws(()=>partyStatement(party,[],[payment(),payment()]),/duplicated/);
});
test('fractional quantities, line discounts and missing costs produce honest profit',()=>{
  const invoice=makeInvoice({...draft,items:[{description:'Wood',quantity:'1.125',rate:'10.01',discount:'0.01',cost:''}]},invoiceId);
  assert.equal(invoice.totalMinor,1125);assert.equal(invoice.costTotalMinor,null);
  const summary=invoiceSummary([{...invoice,status:'issued'}],'2026-01-01','2026-12-31');
  assert.equal(summary.missingCosts,1);assert.equal(summary.grossProfit,0);
  assert.throws(()=>makeInvoice({...draft,items:[{...draft.items[0],discount:'20001'}]},invoiceId));
  assert.throws(()=>makeInvoice({...draft,invoiceDate:'2026-02-30'},invoiceId));
});
test('schema upgrade preserves legacy rows and unknown columns; old payments remain unlinked',()=>{
  const b=accountBackend();assert.equal(b.post('create',{...payment(),partyId:''}).ok,true);
  const sheet=b.tabs.get('Transactions'),before=[...sheet.data[1]];
  sheet.data[0].push('futureColumn');sheet.data[1].push('untouched');
  assert.equal(b.post('listAccounts',{}).ok,true);
  assert.deepEqual(sheet.data[1],[...before,'untouched']);
  assert.equal(b.post('createParty',party).ok,true);
  assert.equal(b.post('listAccounts',{}).transactions[0].partyId,'');
});
test('backend recomputes totals, rejects duplicates, and retains invoice snapshots after contact edits',()=>{
  const b=accountBackend();assert.equal(b.post('createParty',party).ok,true);assert.equal(b.post('createParty',party).ok,true);
  const invoice=makeInvoice(draft,invoiceId);
  assert.equal(b.post('createInvoice',{...invoice,totalMinor:1,costTotalMinor:1}).ok,true);
  assert.equal(b.post('createInvoice',invoice).ok,true);
  const second=makeInvoice(draft,'invoice-00000000000000002');assert.equal(b.post('createInvoice',second).ok,false);
  assert.equal(b.post('updateParty',{id:partyId,name:'New name',phone:'456',address:'New address',_editId:'edit-0000000000000000001',_expectedRevision:0}).ok,true);
  assert.equal(b.post('updateParty',{id:partyId,name:'Stale',phone:'',address:'',_editId:'edit-0000000000000000002',_expectedRevision:0}).ok,false);
  const result=b.post('listAccounts',{});assert.equal(result.ok,true);assert.equal(result.invoices.length,1);
  assert.equal(result.invoices[0].totalMinor,2000000);assert.equal(result.invoices[0].partyName,'Rahul');assert.equal(result.parties[0].name,'New name');
});
test('partial invoice writes are invisible and recover with original IDs',()=>{
  const b=accountBackend();b.post('createParty',party);const invoice=makeInvoice(draft,invoiceId);
  b.failNext('Invoices');assert.equal(b.post('createInvoice',invoice).ok,false);
  assert.equal(b.post('listAccounts',{}).invoices.length,0);
  assert.equal(b.post('createInvoice',invoice).ok,true);
  assert.equal(b.post('listAccounts',{}).invoices.length,1);assert.equal(b.tabs.get('InvoiceItems').data.length,2);
});
test('party validation blocks missing parties and entries before opening; old clients cannot detach linked payments',()=>{
  const b=accountBackend();assert.equal(b.post('create',payment()).ok,false);
  b.post('createParty',party);assert.equal(b.post('create',{...payment(),transactionDate:'2025-12-31'}).ok,false);
  assert.equal(b.post('create',payment()).ok,true);
  const oldClient={...payment(),_editId:'edit-0000000000000000001',_expectedRevision:0};delete oldClient.partyId;
  assert.equal(b.post('update',oldClient).ok,false);
  const before=makeInvoice({...draft,invoiceDate:'2025-12-31'},invoiceId);assert.equal(b.post('createInvoice',before).ok,false);
});
test('cancelled invoices remain recoverable in Sheets and retries do not recreate them',()=>{
  const b=accountBackend();b.post('createParty',party);const inv=makeInvoice(draft,invoiceId);b.post('createInvoice',inv);b.post('create',payment());
  assert.equal(b.post('cancelInvoice',{id:invoiceId,reason:'Wrong order'}).ok,true);
  assert.equal(b.post('cancelInvoice',{id:invoiceId,reason:'Wrong order'}).ok,true);
  assert.equal(b.post('createInvoice',inv).ok,true);
  const result=b.post('listAccounts',{});assert.equal(result.invoices[0].status,'cancelled');assert.equal(result.transactions.length,1);
  assert.equal(partyStatement(party,result.invoices,result.transactions).closing,-500000);
});
