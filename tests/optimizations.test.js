import test from 'node:test';
import assert from 'node:assert/strict';
import {accountBackend} from './helpers/accountBackend.js';
import {makeParty,makeInvoice,invoiceDraftFromRecord} from '../src/accounts.js';
import {activityRecords} from '../src/activity.js';
const party=makeParty({name:'Batch client',phone:'',address:'',openingDate:'2026-01-01',openingBalance:'0'},'batch-party-000000000001');
function fixture(){const backend=accountBackend();backend.post('createParty',party);const draft={partyId:party.id,type:'sale',invoiceDate:'2026-09-01',challanNumber:'DC / 123',notes:'',items:Array.from({length:50},(_,i)=>({description:`Item ${i}`,quantity:'1',rate:'100',discount:'0',cost:'60'}))};return {backend,draft};}
test('50 item invoices batch writes, reuse row reads and preserve challan on edit and retries',()=>{
 const {backend,draft}=fixture();backend.calls.length=0;const payload=makeInvoice(draft,'batch-invoice-0000000001');const result=backend.post('createInvoice',payload);assert.equal(result.ok,true);assert.equal(result.record.challanNumber,'DC / 123');
 const writes=backend.calls.filter(call=>call.name==='InvoiceItems'&&call.operation==='write'&&call.r>1);assert.equal(writes.length,1);assert.equal(writes[0].n,50);
 assert.ok(result.performance.reads<=3);assert.equal(result.performance.writes,2);assert.ok(result.performance.elapsedMs>=0);
 assert.deepEqual(backend.post('createInvoice',payload).record,result.record);
 const editDraft=invoiceDraftFromRecord(result.record);editDraft.challanNumber='DC / 124';editDraft.items[0].rate='120';backend.calls.length=0;
 const edit={...makeInvoice(editDraft,payload.id),invoiceNumber:result.record.invoiceNumber,_expectedRevision:0,_editId:'batch-edit-0000000000001'};const changed=backend.post('updateInvoice',edit);assert.equal(changed.ok,true);assert.equal(changed.record.challanNumber,'DC / 124');assert.equal(backend.calls.filter(call=>call.name==='InvoiceItems'&&call.operation==='write'&&call.r>1).length,1);
 assert.deepEqual(backend.post('updateInvoice',edit).record,changed.record);assert.equal(JSON.parse(backend.tabs.get('InvoiceHistory').data[1].at(-1)).challanNumber,'DC / 123');
});
test('failed batched item writes leave no issued invoice and retry recovers without duplicates',()=>{
 const {backend,draft}=fixture();const payload=makeInvoice(draft,'batch-invoice-0000000001');backend.failNext('InvoiceItems');assert.equal(backend.post('createInvoice',payload).ok,false);assert.equal(backend.post('listAccounts',{}).invoices.length,0);
 backend.failNext('Invoices');assert.equal(backend.post('createInvoice',payload).ok,false);assert.equal(backend.post('listAccounts',{}).invoices.length,0);
 assert.equal(backend.post('createInvoice',payload).ok,true);assert.equal(backend.tabs.get('InvoiceItems').data.length,51);
});
test('summary responses preserve totals and item search, full details validate and legacy invoices read without challan',()=>{
 const {backend,draft}=fixture();const record=backend.post('createInvoice',makeInvoice(draft,'batch-invoice-0000000001')).record;
 const summary=backend.post('listAccounts',{summary:true});assert.equal(summary.ok,true);assert.equal(summary.invoices[0].items,undefined);assert.match(summary.invoices[0].itemSearch,/Item 49/);assert.equal(summary.invoices[0].totalMinor,record.totalMinor);
 assert.equal(backend.post('getInvoices',{ids:[record.id]}).invoices[0].items.length,50);assert.equal(backend.post('getInvoices',{ids:['missing-invoice-000000001']}).ok,false);
 const tab=backend.tabs.get('Invoices'),index=tab.data[0].indexOf('challanNumber');tab.data.forEach(row=>row.splice(index,1));assert.equal(backend.post('listAccounts',{summary:true}).invoices[0].challanNumber,'');assert.equal(tab.data[0].includes('challanNumber'),false);
 const items=backend.tabs.get('InvoiceItems');items.data[1][items.data[0].indexOf('rateMinor')]='broken';assert.equal(backend.post('listAccounts',{summary:true}).ok,false);assert.equal(backend.post('getInvoices',{ids:[record.id]}).ok,false);
});
test('unified activity orders mixed records chronologically and applies category, method and record type independently',()=>{
 const invoices=[{id:'invoice-activity-000001',invoiceDate:'2026-09-01',createdAt:'2026-09-01T03:00:00Z',type:'sale',partyName:'Client',invoiceNumber:'RF-S-1',totalMinor:1000,status:'issued',challanNumber:'DC-123'}];
 const notes=[{id:'credit-activity-0000001',invoiceId:invoices[0].id,noteDate:'2026-09-01',createdAt:'2026-09-01T03:30:00Z',type:'credit',invoiceType:'sale',partyName:'Client',noteNumber:'RF-CN-1',amountMinor:100,status:'issued'}];
 const transactions=[{id:'payment-activity-000001',transactionDate:'2026-09-01',transactionTime:'08:45',category:'Sale',party:'Client',method:'Cash',amountMinor:200,direction:'in'}];
 const options={invoices,notes,transactions,range:['2026-09-01','2026-09-30']};assert.deepEqual(activityRecords(options).map(row=>row.kind),['note','payment','invoice']);assert.deepEqual(activityRecords({...options,kind:'credit'}).map(row=>row.kind),['note']);assert.equal(activityRecords({...options,method:'Online'}).length,2);assert.equal(activityRecords({...options,category:'Purchase'}).length,0);assert.equal(activityRecords({...options,query:'DC-123'}).length,1);
});
