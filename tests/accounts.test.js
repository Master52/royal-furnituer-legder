import test from 'node:test';
import assert from 'node:assert/strict';
import { accountBackend } from './helpers/accountBackend.js';
import { makeParty, makeInvoice, partyStatement, invoiceSummary, accountBalances, findParties, invoiceDraftFromRecord, MAX_MINOR } from '../src/accounts.js';
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
  const second=makeInvoice(draft,'invoice-00000000000000002');assert.equal(b.post('createInvoice',second).ok,true);
  assert.equal(b.post('createInvoice',{...second,id:'invoice-00000000000000003',items:second.items.map((item,index)=>({...item,id:'invoice-00000000000000003-'+(index+1),invoiceId:'invoice-00000000000000003'})),invoiceNumber:'RF-S-000001'}).ok,false);
  assert.equal(b.post('updateParty',{id:partyId,name:'New name',phone:'456',address:'New address',_editId:'edit-0000000000000000001',_expectedRevision:0}).ok,true);
  assert.equal(b.post('updateParty',{id:partyId,name:'Stale',phone:'',address:'',_editId:'edit-0000000000000000002',_expectedRevision:0}).ok,false);
  const result=b.post('listAccounts',{});assert.equal(result.ok,true);assert.equal(result.invoices.length,2);
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

test('write acknowledgements include confirmed records, snapshots, items and original numbers on retry',()=>{
  const b=accountBackend();
  const created=b.post('createParty',party);
  assert.equal(created.record.id,partyId);assert.ok(created.record.createdAt);
  const payload=makeInvoice(draft,invoiceId),issued=b.post('createInvoice',payload);
  assert.equal(issued.record.invoiceNumber,'RF-S-000001');assert.equal(issued.record.partyName,party.name);
  assert.equal(issued.record.items.length,1);assert.equal(issued.record.status,'issued');
  assert.equal(b.post('createInvoice',payload).record.invoiceNumber,issued.record.invoiceNumber);
  const edited=b.post('updateParty',{id:partyId,name:'Edited',phone:'456',address:'New',_editId:'edit-0000000000000000001',_expectedRevision:0});
  assert.equal(edited.record.revision,1);assert.equal(edited.record.name,'Edited');
  assert.equal(b.post('createInvoice',payload).record.partyName,party.name);
  assert.equal(b.post('cancelInvoice',{id:invoiceId,reason:'Correction'}).record.status,'cancelled');
  assert.equal(b.post('createInvoice',payload).record.status,'cancelled');
});

test('numbering separates sale and purchase, skips cancelled numbers and preserves legacy invoices',()=>{
  const b=accountBackend();b.post('createParty',party);
  const issue=(suffix,type='sale',number='')=>b.post('createInvoice',{...makeInvoice({...draft,type},`invoice-000000000000000${suffix}`),invoiceNumber:number});
  assert.equal(issue('01','sale','RF-S-000040').record.invoiceNumber,'RF-S-000040');
  b.post('cancelInvoice',{id:'invoice-00000000000000001',reason:'Cancelled'});
  assert.equal(issue('02').record.invoiceNumber,'RF-S-000041');
  assert.equal(issue('03','purchase').record.invoiceNumber,'RF-P-000001');
  assert.equal(issue('04','sale','OLD-9').record.invoiceNumber,'OLD-9');
  assert.equal(issue('05').record.invoiceNumber,'RF-S-000042');
  assert.equal(issue('02').record.invoiceNumber,'RF-S-000041');
  assert.equal(b.post('listAccounts',{}).invoices.length,5);
});

test('indexed balances agree with statements across openings, payments, cancellations and unrelated records',()=>{
  const other={...party,id:'party-000000000000000002',openingBalanceMinor:-20000};
  const invoices=[{...makeInvoice(draft,invoiceId),status:'issued'},{...makeInvoice({...draft,partyId:other.id,type:'purchase'},'invoice-00000000000000002'),status:'issued'},{...makeInvoice(draft,'invoice-00000000000000003'),status:'cancelled'}];
  const transactions=[payment(),{...payment('out'),id:'payment-00000000000000002',partyId:other.id},{...payment(),id:'payment-00000000000000003',partyId:''},{...payment(),id:'payment-00000000000000004',deletedAt:'now'}];
  for(const row of accountBalances([party,other],invoices,transactions))assert.equal(row.balance,partyStatement(row.party,invoices,transactions).closing);
  const invalid=accountBalances([party,other],invoices,[payment(),payment()]);
  assert.equal(invalid[0].balance,null);assert.ok(invalid[0].error);assert.equal(invalid[1].error,'');
});

test('party search ranks exact, prefix, token and phone matches and retains non-Latin names',()=>{
  const parties=[{id:'1',name:'Ram Furniture',phone:'98765'},{id:'2',name:'Ram',phone:''},{id:'3',name:'Royal Ram',phone:''},{id:'4',name:'राम कुमार',phone:'12345'}];
  assert.equal(findParties(parties,'Ram')[0].id,'2');
  assert.equal(findParties(parties,'987')[0].id,'1');
  assert.equal(findParties(parties,'राम')[0].id,'4');
  assert.equal(findParties(parties,'rf')[0].id,'1');
  assert.equal(findParties(parties,'Nobody').length,0);
  assert.equal(findParties(parties,'Ram',1).length,1);
});

test('invoice limits and draft restoration preserve precise values and unknown costs',()=>{
  const valid=makeInvoice({...draft,items:[{description:'Fraction',quantity:'1.125',rate:'10.01',discount:'0.01',cost:''}]},invoiceId);
  const restored=invoiceDraftFromRecord(valid),again=makeInvoice(restored,invoiceId);
  assert.deepEqual(again,valid);assert.equal(restored.items[0].cost,'');
  for(const quantity of ['0','-1','NaN','1.0001','1000001'])assert.throws(()=>makeInvoice({...draft,items:[{...draft.items[0],quantity}]},invoiceId));
  for(const rate of ['-1','NaN','1.001',String(MAX_MINOR/100+1)])assert.throws(()=>makeInvoice({...draft,items:[{...draft.items[0],rate}]},invoiceId));
  assert.throws(()=>makeInvoice({...draft,items:[]},invoiceId));
  assert.throws(()=>makeInvoice({...draft,items:Array(51).fill(draft.items[0])},invoiceId));
  assert.equal(makeInvoice({...draft,items:Array(50).fill({...draft.items[0],rate:'1',cost:'0'})},invoiceId).items.length,50);
  assert.throws(()=>makeParty({...party,name:' ',openingBalance:'0'},partyId));
});
