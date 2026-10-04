import test from 'node:test';
import assert from 'node:assert/strict';
import { accountBackend } from './helpers/accountBackend.js';
import { makeParty, makeInvoice, partyStatement, invoiceSummary, accountBalances, findParties, invoiceDraftFromRecord, historyInvoices, MAX_MINOR } from '../src/accounts.js';
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

const invoiceEdit=(invoice,revision=0,editId='edit-invoice-000000000001',rate='25000')=>({...makeInvoice({...draft,items:[{...draft.items[0],rate}]},invoice.id),invoiceNumber:invoice.invoiceNumber,_expectedRevision:revision,_editId:editId});
test('invoice edits retain number, identity and contact snapshot; totals change without changing payments',()=>{
  const b=accountBackend();b.post('createParty',party);const original=makeInvoice(draft,invoiceId),issued=b.post('createInvoice',original).record;b.post('create',payment());
  const sheet=b.tabs.get('Invoices');sheet.data[0].push('futureColumn');sheet.data[1].push('untouched');
  const result=b.post('updateInvoice',invoiceEdit(issued));assert.equal(result.ok,true);assert.equal(result.record.id,invoiceId);assert.equal(result.record.invoiceNumber,issued.invoiceNumber);assert.equal(result.record.revision,1);assert.equal(result.record.createdAt,issued.createdAt);assert.equal(result.record.partyName,issued.partyName);assert.equal(result.record.totalMinor,2500000);
  const current=b.post('listAccounts',{});assert.equal(current.ok,true);assert.equal(current.transactions.length,1);assert.equal(partyStatement(party,current.invoices,current.transactions).closing,2000000);assert.equal(invoiceSummary(current.invoices,'2026-01-01','2026-12-31').grossProfit,1100000);
  assert.equal(current.invoices[0].futureColumn,'untouched');assert.equal(b.tabs.get('InvoiceItems').data.length,3);
  const history=b.tabs.get('InvoiceHistory');assert.equal(history.data.length,2);assert.equal(JSON.parse(history.data[1][history.data[0].indexOf('snapshot')]).totalMinor,2000000);
  assert.equal(b.post('createInvoice',original).ok,true);assert.equal(b.post('createInvoice',original).record.totalMinor,2500000);
});
test('invoice edit retries are idempotent and stale or reused edits cannot overwrite another revision',()=>{
  const b=accountBackend();b.post('createParty',party);const issued=b.post('createInvoice',makeInvoice(draft,invoiceId)).record,edit=invoiceEdit(issued);
  assert.equal(b.post('updateInvoice',edit).ok,true);assert.equal(b.post('updateInvoice',edit).record.revision,1);assert.equal(b.tabs.get('InvoiceItems').data.length,3);assert.equal(b.tabs.get('InvoiceHistory').data.length,2);
  assert.equal(b.post('updateInvoice',invoiceEdit(issued,0,'edit-invoice-000000000002')).code,'EDIT_CONFLICT');
  assert.equal(b.post('updateInvoice',invoiceEdit(issued,0,edit._editId,'26000')).ok,false);
  const second=b.post('updateInvoice',invoiceEdit(issued,1,'edit-invoice-000000000003','27000'));assert.equal(second.record.revision,2);assert.equal(b.post('listAccounts',{}).invoices[0].items.length,1);assert.equal(b.post('listAccounts',{}).invoices[0].totalMinor,2700000);
  assert.equal(b.post('updateInvoice',edit).record.revision,2);assert.equal(b.post('updateInvoice',edit).record.totalMinor,2700000);
  b.post('cancelInvoice',{id:invoiceId,reason:'Cancelled'});assert.equal(b.post('updateInvoice',invoiceEdit(issued,3,'edit-invoice-000000000004')).ok,false);assert.equal(b.post('updateInvoice',invoiceEdit(issued,1,'edit-invoice-000000000003','27000')).record.status,'cancelled');
});
test('interrupted invoice edits leave the original usable and recover with exactly one committed version',()=>{
  for(const tab of ['InvoiceHistory','InvoiceItems','Invoices']){
    const b=accountBackend();b.post('createParty',party);const issued=b.post('createInvoice',makeInvoice(draft,invoiceId)).record,edit=invoiceEdit(issued);
    b.failNext(tab);assert.equal(b.post('updateInvoice',edit).ok,false,tab);let result=b.post('listAccounts',{});assert.equal(result.ok,true);assert.equal(result.invoices[0].totalMinor,issued.totalMinor);assert.equal(result.invoices[0].revision,0);
    assert.equal(b.post('updateInvoice',edit).ok,true);result=b.post('listAccounts',{});assert.equal(result.invoices[0].totalMinor,2500000);assert.equal(result.invoices[0].items.length,1);assert.equal(b.tabs.get('InvoiceHistory').data.length,2);
  }
});
test('old invoice headers remain readable and edits append schema without changing historical item rows',()=>{
  const b=accountBackend();b.post('createParty',party);const issued=b.post('createInvoice',makeInvoice(draft,invoiceId)).record;
  for(const [tab,fields] of [['Invoices',['revision','lastEditId','updatedAt','itemVersion']],['InvoiceItems',['versionId']]]){
    const sheet=b.tabs.get(tab);for(const field of fields){const index=sheet.data[0].indexOf(field);sheet.data.forEach(row=>row.splice(index,1));}
  }
  const before=[...b.tabs.get('InvoiceItems').data[1]];assert.equal(b.post('listAccounts',{}).ok,true);assert.equal(b.post('updateInvoice',invoiceEdit(issued)).ok,true);assert.deepEqual(b.tabs.get('InvoiceItems').data[1].slice(0,before.length),before);assert.equal(b.post('listAccounts',{}).invoices[0].revision,1);
});
test('invoice edits validate dates and fixed fields before staging any new version',()=>{
  const b=accountBackend();b.post('createParty',party);const issued=b.post('createInvoice',makeInvoice(draft,invoiceId)).record;
  for(const patch of [{partyId:'party-000000000000000002'},{type:'purchase'},{invoiceNumber:'RF-S-999999'},{invoiceDate:'2025-12-31'},{items:[]}])assert.equal(b.post('updateInvoice',{...invoiceEdit(issued),...patch}).ok,false);
  assert.equal(b.tabs.get('InvoiceItems').data.length,2);assert.equal(b.post('listAccounts',{}).invoices[0].totalMinor,2000000);
});


test('ledger interleaves invoices and payments by date and shop time, with correct running balances',()=>{
  const day='2026-09-02';
  const sale={...makeInvoice({...draft,invoiceDate:day},invoiceId),status:'issued',createdAt:'2026-09-02T04:30:00Z',totalMinor:10000}; // 10:00 in India
  const purchase={...sale,id:'purchase-order',type:'purchase',createdAt:'2026-09-02T06:30:00Z',totalMinor:3000}; // 12:00
  const receipt={...payment('in','20'),id:'receipt-middle',transactionTime:'11:00',amountMinor:2000};
  const early={...payment('out','10'),id:'payment-first',transactionTime:'09:00',amountMinor:1000};
  const late={...payment('in','40'),id:'receipt-last',transactionTime:'13:00',amountMinor:4000};
  const opening={...party,openingDate:day,openingBalanceMinor:500};
  const statement=partyStatement(opening,[purchase,sale],[late,early,receipt]);
  assert.deepEqual(statement.entries.map(row=>row.id),['opening-'+party.id,'payment-first',sale.id,'receipt-middle','purchase-order','receipt-last']);
  assert.deepEqual(statement.entries.map(row=>row.balance),[500,1500,11500,9500,6500,2500]);
  assert.equal(statement.closing,2500);
  assert.equal(partyStatement(opening,[purchase,sale],[late,early,receipt],'2026-09-03').opening,2500);
  const nextDay={...sale,id:'next-day',invoiceDate:'2026-09-03',createdAt:'2026-09-02T00:00:00Z'};
  assert.equal(partyStatement(party,[nextDay,sale],[]).entries.at(-1).id,'next-day');
  const legacy={...sale,id:'legacy',createdAt:''};
  assert.equal(partyStatement(party,[sale,legacy],[early]).entries[0].id,'legacy');
});
test('invoice History filters dates, category, number, party, item and notes while retaining cancellations',()=>{
  const sale={...makeInvoice(draft,invoiceId),partyName:'Rahul',invoiceNumber:'RF-S-000001',status:'issued',createdAt:'2026-09-01T05:00:00Z'};
  const purchase={...sale,id:'purchase-history',type:'purchase',invoiceNumber:'RF-P-000001',status:'cancelled',notes:'Returned wood',createdAt:'2026-09-01T06:00:00Z'};
  const invoices=[sale,purchase,{...sale,id:'older',invoiceDate:'2026-08-31'}];
  const filter=(category='',query='')=>historyInvoices(invoices,'2026-09-01','2026-09-30',category,query);
  assert.deepEqual(filter().map(row=>row.id),[purchase.id,sale.id]);
  assert.equal(filter('Sale').length,1);assert.equal(filter('Purchase')[0].status,'cancelled');
  assert.equal(filter('Expense').length,0);assert.equal(filter('Bhara').length,0);
  assert.equal(filter('','rf-p')[0].id,purchase.id);assert.equal(filter('','rahul').length,2);
  assert.equal(filter('','sofa').length,2);assert.equal(filter('','returned')[0].id,purchase.id);
  assert.equal(filter('','missing').length,0);
});

test('party types are validated, editable, retry safe and preserve balances',()=>{
 const b=accountBackend(),customer={...party,partyType:'customer'};
 assert.equal(b.post('createParty',customer).ok,true);
 assert.equal(b.post('createParty',customer).ok,true);
 assert.equal(b.post('createParty',{...customer,partyType:'supplier'}).ok,false);
 const update={id:partyId,name:party.name,phone:party.phone,address:party.address,partyType:'lead',_editId:'edit-party-type-00000001',_expectedRevision:0};
 const saved=b.post('updateParty',update);assert.equal(saved.ok,true,saved.error);assert.equal(saved.record.partyType,'lead');assert.equal(saved.record.openingBalanceMinor,party.openingBalanceMinor);
 assert.equal(b.post('updateParty',update).ok,true);
 assert.equal(b.post('updateParty',{...update,partyType:'supplier'}).ok,false);
 const legacy=b.post('updateParty',{...update,partyType:undefined,_editId:'edit-party-type-00000002',_expectedRevision:1});assert.equal(legacy.ok,true,legacy.error);assert.equal(legacy.record.partyType,'lead');
 assert.equal(b.post('createParty',{...party,id:'party-invalid-type-000001',partyType:'unknown'}).ok,false);
 assert.throws(()=>makeParty({...party,openingBalance:'0',partyType:'unknown'}),/valid party type/);
});
test('legacy party headers remain readable and get an additive type column only on write',()=>{
 const b=accountBackend();const {partyType,...legacy}=party;b.post('createParty',legacy);
 const tab=b.tabs.get('Parties'),column=tab.data[0].indexOf('partyType');tab.data.forEach(row=>row.splice(column,1));
 assert.equal(b.post('listAccounts',{}).ok,true);assert.equal(tab.data[0].includes('partyType'),false);
 assert.equal(b.post('createParty',legacy).ok,true);assert.equal(tab.data[0].includes('partyType'),true);
 assert.equal(b.post('listAccounts',{}).parties[0].openingBalanceMinor,party.openingBalanceMinor);
});
