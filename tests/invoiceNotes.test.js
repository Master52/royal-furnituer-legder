import test from 'node:test';
import assert from 'node:assert/strict';
import {accountBackend} from './helpers/accountBackend.js';
import {makeParty,makeInvoice,makeInvoiceNote,partyStatement,invoiceSummary,accountBalances,historyNotes,invoiceNetValue,invoiceDraftFromRecord,invoiceNeedsCost} from '../src/accounts.js';
import {makeTransaction,paymentMethodBalance} from '../src/ledger.js';
import {businessFigures} from '../src/business.js';
const party=makeParty({name:'Customer',phone:'123',address:'Old address',openingDate:'2026-01-01',openingBalance:'0'},'party-note-0000000000001');
function fixture(type='sale',cost='60'){
 const backend=accountBackend();backend.post('createParty',party);
 const invoice=backend.post('createInvoice',makeInvoice({partyId:party.id,type,invoiceDate:'2026-09-01',notes:'original',items:[{description:'Chair',quantity:'1',rate:'100',discount:'0',cost}]},'invoice-note-00000000001')).record;
 const create=(type,amount,id='credit-note-000000000001',effect='price',cost='')=>makeInvoiceNote({type,amount,effect,cost,noteDate:'2026-09-02',reason:'Correction'},invoice,id);
 return {backend,invoice,create};
}
test('credit/debit notes preserve original invoice, update balances and profit, and never move cash',()=>{
 const {backend,invoice,create}=fixture();
 const receipt=makeTransaction({partyId:party.id,party:party.name,category:'Sale',direction:'in',method:'Cash',amount:'40',dateTime:'2026-09-02T12:00'},'receipt-note-00000000001');backend.post('create',receipt);
 assert.equal(backend.post('createInvoiceNote',create('credit','20')).ok,true);
 const result=backend.post('createInvoiceNote',create('debit','10','debit-note-000000000001'));assert.equal(result.ok,true);assert.equal(result.record.noteNumber,'RF-DN-000001');
 const data=backend.post('listAccounts',{});assert.equal(data.ok,true);assert.equal(data.notes[0].noteNumber,'RF-CN-000001');assert.deepEqual(data.invoices[0],invoice);
 assert.equal(invoiceNetValue(invoice,data.notes),9000);assert.equal(accountBalances(data.parties,data.invoices,data.transactions,data.notes)[0].balance,5000);
 assert.equal(partyStatement(party,data.invoices,data.transactions,'2026-01-01','2026-12-31',data.notes).closing,5000);
 assert.equal(invoiceSummary(data.invoices,'2026-01-01','2026-12-31',data.notes).grossProfit,3000);
 assert.deepEqual(paymentMethodBalance(data.transactions),{Cash:4000,Online:0});
 assert.equal(backend.post('updateInvoice',{...makeInvoice(invoiceDraftFromRecord(invoice),invoice.id),invoiceNumber:invoice.invoiceNumber,_editId:'edit-noted-invoice-00001',_expectedRevision:0}).ok,false);
 assert.equal(backend.post('cancelInvoice',{id:invoice.id,reason:'Wrong'}).ok,false);
});
test('purchase credit reduces payable and debit increases it without affecting sales profit',()=>{
 const {backend,invoice,create}=fixture('purchase');assert.equal(backend.post('createInvoiceNote',create('credit','25')).ok,true);
 assert.equal(backend.post('createInvoiceNote',create('debit','10','debit-note-000000000001')).ok,true);
 const data=backend.post('listAccounts',{});assert.equal(data.ok,true);assert.equal(accountBalances(data.parties,data.invoices,[],data.notes)[0].balance,-8500);
 const summary=invoiceSummary([invoice],'2026-01-01','2026-12-31',data.notes);assert.equal(summary.purchases,8500);assert.equal(summary.grossProfit,0);
});
test('notes are idempotent after lost replies, cancellation, and interrupted writes',()=>{
 const {backend,create}=fixture();const payload=create('credit','20');backend.failNext('InvoiceNotes');assert.equal(backend.post('createInvoiceNote',payload).ok,false);assert.equal(backend.post('listAccounts',{}).notes.length,0);
 const first=backend.post('createInvoiceNote',payload);assert.equal(first.ok,true);assert.deepEqual(backend.post('createInvoiceNote',payload).record,first.record);
 assert.equal(backend.post('createInvoiceNote',{...payload,amountMinor:3000}).ok,false);
 assert.equal(backend.post('cancelInvoiceNote',{id:payload.id,reason:'Mistake',_expectedRevision:0}).ok,true);
 const retry=backend.post('createInvoiceNote',payload);assert.equal(retry.ok,true);assert.equal(retry.record.status,'cancelled');
 assert.equal(backend.post('cancelInvoiceNote',{id:payload.id,reason:'Mistake',_expectedRevision:0}).ok,true);
 assert.equal(backend.post('listAccounts',{}).notes.length,1);
 const next=backend.post('createInvoiceNote',create('credit','10','credit-note-000000000002'));assert.equal(next.record.noteNumber,'RF-CN-000002');
});
test('correction limits, linked revision, date, cost and missing reason are checked on server',()=>{
 const {backend,invoice,create}=fixture();const credit=create('credit','100');assert.equal(backend.post('createInvoiceNote',{...credit,amountMinor:10001}).ok,false);
 assert.equal(backend.post('createInvoiceNote',{...credit,noteDate:'2026-08-31'}).ok,false);
 assert.equal(backend.post('createInvoiceNote',{...credit,_expectedRevision:1}).code,'EDIT_CONFLICT');
 assert.equal(backend.post('createInvoiceNote',{...credit,reason:' '}).ok,false);
 assert.equal(backend.post('createInvoiceNote',create('credit','50','credit-note-000000000001','return','61')).ok,false);
 assert.equal(backend.post('createInvoiceNote',create('credit','100')).ok,true);
 assert.equal(backend.post('createInvoiceNote',create('credit','1','credit-note-000000000002')).ok,false);
 assert.equal(invoiceNetValue(invoice,backend.post('listAccounts',{}).notes),0);
 assert.throws(()=>makeInvoiceNote({type:'credit',effect:'price',amount:'0',reason:'x',noteDate:'2026-09-02'},invoice),/positive/);
});
test('cancelling a debit with dependent credits cannot over-credit the original invoice',()=>{
 const {backend,create}=fixture();const debit=create('debit','50','debit-note-000000000001');backend.post('createInvoiceNote',debit);
 const credit=create('credit','130');backend.post('createInvoiceNote',credit);
 assert.equal(backend.post('cancelInvoiceNote',{id:debit.id,reason:'Mistake',_expectedRevision:0}).ok,false);
 assert.equal(backend.post('cancelInvoiceNote',{id:credit.id,reason:'Mistake',_expectedRevision:0}).ok,true);
 assert.equal(backend.post('cancelInvoiceNote',{id:debit.id,reason:'Mistake',_expectedRevision:0}).ok,true);
});
test('returned costs adjust profit; unknown costs remain unknown and cancelled notes are excluded',()=>{
 const {backend,create}=fixture();backend.post('createInvoiceNote',create('credit','20','credit-note-000000000001','return','12'));
 let data=backend.post('listAccounts',{});assert.equal(invoiceSummary(data.invoices,'2026-01-01','2026-12-31',data.notes).grossProfit,3200);
 backend.post('createInvoiceNote',create('credit','10','credit-note-000000000002','return',''));
 data=backend.post('listAccounts',{});const summary=invoiceSummary(data.invoices,'2026-01-01','2026-12-31',data.notes);assert.equal(summary.missingCosts,1);
 assert.equal(businessFigures(data.invoices,data.notes,[],['2026-01-01','2026-12-31']).operatingResult,null);
 backend.post('cancelInvoiceNote',{id:data.notes[1].id,reason:'Unknown cost correction',_expectedRevision:0});data=backend.post('listAccounts',{});assert.equal(invoiceSummary(data.invoices,'2026-01-01','2026-12-31',data.notes).missingCosts,0);
});
test('legacy sheets need no rewrite; notes snapshot contacts and History retains cancelled corrections',()=>{
 const {backend,create}=fixture();const before=JSON.stringify(backend.tabs.get('Invoices').data);
 assert.deepEqual(Array.from(backend.post('listAccounts',{}).notes),[]);
 backend.post('createInvoiceNote',create('credit','20'));assert.equal(JSON.stringify(backend.tabs.get('Invoices').data),before);
 backend.post('updateParty',{id:party.id,name:'Changed',phone:'456',address:'New',_editId:'edit-note-party-00000001',_expectedRevision:0});
 const notes=backend.post('listAccounts',{}).notes;assert.equal(notes[0].partyName,'Customer');assert.equal(notes[0].partyAddress,'Old address');
 assert.equal(historyNotes(notes,'2026-09-02','2026-09-02','Sale','rf-cn').length,1);assert.equal(historyNotes(notes,'2026-09-02','2026-09-02','Purchase').length,0);
});
test('dashboard distinguishes invoice value, payments, operating expenses and incomplete profit',()=>{
 const {invoice}=fixture();
 const payment=(category,direction,amount,id)=>makeTransaction({category,direction,amount,party:'Test',method:'Cash',dateTime:'2026-09-02T12:00'},id);
 const rows=[payment('Sale','in','40','sale-dashboard-00000001'),payment('Purchase','out','50','purchase-dashboard-0001'),payment('Expense','out','5','expense-dashboard-00001'),payment('Bhara','out','3','bhara-dashboard-0000001'),payment('Expense','in','1','refund-dashboard-000001')];
 const figures=businessFigures([invoice],[],rows,['2026-09-01','2026-09-30']);assert.equal(figures.sales,10000);assert.equal(figures.collected,4100);assert.equal(figures.paid,5800);assert.equal(figures.expenses,400);assert.equal(figures.operatingResult,3600);
 const bharaRefund=payment('Bhara','in','2','bhara-refund-0000000001');assert.equal(businessFigures([invoice],[],[...rows,bharaRefund],['2026-09-01','2026-09-30']).operatingResult,3600);
 assert.equal(businessFigures([{...invoice,costTotalMinor:null}],[],rows,['2026-09-01','2026-09-30']).operatingResult,null);
});

test('notes appear in ledger chronology and corrupted Sheet note values fail closed',()=>{
 const {backend,invoice,create}=fixture();const result=backend.post('createInvoiceNote',create('credit','20'));
 const note={...result.record,createdAt:'2026-09-02T05:30:00Z'}; // 11:00 India
 const receipt=makeTransaction({partyId:party.id,party:'Customer',category:'Sale',direction:'in',method:'Cash',amount:'10',dateTime:'2026-09-02T12:00'},'receipt-note-00000000001');
 assert.deepEqual(partyStatement(party,[invoice],[receipt],'2026-01-01','2026-12-31',[note]).entries.map(row=>row.id),[invoice.id,note.id,receipt.id]);
 const tab=backend.tabs.get('InvoiceNotes');tab.data[1][tab.data[0].indexOf('amountMinor')]=20000;
 assert.equal(backend.post('listAccounts',{}).ok,false);
});
test('dependent cost notes must be cancelled before their supporting debit, preserving unknown columns',()=>{
 const {backend,create}=fixture();const debit=backend.post('createInvoiceNote',create('debit','20','debit-note-000000000001','return','10')).record;
 const credit=backend.post('createInvoiceNote',create('credit','50','credit-note-000000000001','return','65')).record;
 assert.equal(backend.post('cancelInvoiceNote',{id:debit.id,reason:'Wrong cost',_expectedRevision:0}).ok,false);
 const tab=backend.tabs.get('InvoiceNotes');tab.data[0].push('futureField');tab.data[1].push('unchanged');tab.data[2].push('keep too');
 assert.equal(backend.post('cancelInvoiceNote',{id:credit.id,reason:'Wrong credit',_expectedRevision:0}).ok,true);
 assert.equal(tab.data[1].at(-1),'unchanged');assert.equal(tab.data[2].at(-1),'keep too');
 assert.equal(backend.post('cancelInvoiceNote',{id:debit.id,reason:'Wrong cost',_expectedRevision:0}).ok,true);
});

test('note edits preserve originals and contacts, audit previous revisions and retry committed edits',()=>{
 const {backend,create,invoice}=fixture();const payload=create('credit','20');const first=backend.post('createInvoiceNote',payload).record;
 const tab=backend.tabs.get('InvoiceNotes');tab.data[0].push('futureField');tab.data[1].push('keep');
 const edit={...payload,amountMinor:1500,reason:'Corrected reason',_expectedRevision:0,_editId:'note-edit-00000000000001'};
 let result=backend.post('updateInvoiceNote',edit);assert.equal(result.ok,true);assert.equal(result.record.revision,1);assert.equal(result.record.noteNumber,first.noteNumber);assert.equal(result.record.partyName,first.partyName);assert.equal(tab.data[1].at(-1),'keep');
 assert.equal(JSON.parse(backend.tabs.get('InvoiceNoteHistory').data[1].at(-1)).amountMinor,2000);
 assert.deepEqual(backend.post('updateInvoiceNote',edit).record,result.record);assert.equal(backend.post('updateInvoiceNote',{...edit,amountMinor:1600}).ok,false);
 assert.equal(backend.post('updateInvoiceNote',{...edit,_editId:'note-edit-00000000000002'}).code,'EDIT_CONFLICT');
 result=backend.post('updateInvoiceNote',{...edit,amountMinor:1000,_expectedRevision:1,_editId:'note-edit-00000000000002'});assert.equal(result.ok,true);
 assert.equal(backend.post('updateInvoiceNote',edit).record.amountMinor,1000);assert.equal(backend.post('createInvoiceNote',payload).record.amountMinor,1000);assert.equal(backend.post('createInvoiceNote',{...payload,amountMinor:3000}).ok,false);
 assert.deepEqual(backend.post('listAccounts',{}).invoices[0],invoice);
 assert.equal(backend.post('updateInvoiceNote',{...edit,type:'debit',_expectedRevision:2}).ok,false);
});
test('interrupted note edits do not change the balance, retries use a single previous snapshot',()=>{
 const {backend,create}=fixture();const payload=create('credit','20');backend.post('createInvoiceNote',payload);
 const edit={...payload,amountMinor:1000,_expectedRevision:0,_editId:'note-edit-00000000000001'};
 backend.failNext('InvoiceNoteHistory');assert.equal(backend.post('updateInvoiceNote',edit).ok,false);assert.equal(backend.post('listAccounts',{}).notes[0].amountMinor,2000);
 backend.failNext('InvoiceNotes');assert.equal(backend.post('updateInvoiceNote',edit).ok,false);assert.equal(backend.post('listAccounts',{}).notes[0].amountMinor,2000);
 assert.equal(backend.post('updateInvoiceNote',edit).ok,true);assert.equal(backend.tabs.get('InvoiceNoteHistory').data.length,2);
});
test('note deletion reverses ledger effects, retains rows and does not reuse numbers',()=>{
 const {backend,create,invoice}=fixture();const payload=create('credit','20');backend.post('createInvoiceNote',payload);
 const deletion={id:payload.id,reason:'Duplicate correction',_expectedRevision:0};const result=backend.post('deleteInvoiceNote',deletion);assert.equal(result.ok,true);assert.equal(result.record.status,'deleted');assert.ok(result.record.deletedAt);assert.equal(result.record.deleteReason,deletion.reason);
 assert.equal(backend.post('cancelInvoiceNote',{id:payload.id,reason:'Stale cancellation',_expectedRevision:1}).ok,false);
 assert.equal(backend.post('deleteInvoiceNote',deletion).ok,true);assert.equal(backend.post('createInvoiceNote',payload).record.status,'deleted');assert.equal(backend.tabs.get('InvoiceNotes').data.length,2);
 const data=backend.post('listAccounts',{});assert.equal(data.ok,true);assert.equal(invoiceNetValue(invoice,data.notes),10000);assert.equal(accountBalances(data.parties,data.invoices,[],data.notes)[0].balance,10000);
 assert.equal(backend.post('createInvoiceNote',create('credit','10','credit-note-000000000002')).record.noteNumber,'RF-CN-000002');
});
test('note changes reject negative dependent totals and costs, stale revisions and invalid dates',()=>{
 const {backend,create}=fixture();const debit=backend.post('createInvoiceNote',create('debit','50','debit-note-000000000001','return','10')).record;
 backend.post('createInvoiceNote',create('credit','130','credit-note-000000000001','return','65'));
 assert.equal(backend.post('deleteInvoiceNote',{id:debit.id,reason:'Mistake',_expectedRevision:0}).ok,false);
 const edit={...create('debit','50',debit.id,'return','10'),_expectedRevision:0,_editId:'note-edit-00000000000001'};
 assert.equal(backend.post('updateInvoiceNote',{...edit,amountMinor:1000}).ok,false);
 assert.equal(backend.post('updateInvoiceNote',{...edit,costAdjustmentMinor:0}).ok,false);
 assert.equal(backend.post('updateInvoiceNote',{...edit,noteDate:'2026-08-31'}).ok,false);
 assert.equal(backend.post('deleteInvoiceNote',{id:debit.id,reason:'Mistake',_expectedRevision:1}).code,'EDIT_CONFLICT');
 assert.equal(backend.post('listAccounts',{}).notes.find(note=>note.id===debit.id).revision,0);
});


test('legacy note columns are upgraded additively and missing CP excludes explicit zero and purchases',()=>{
 const {backend,create,invoice}=fixture();const payload=create('credit','20');backend.post('createInvoiceNote',payload);
 const tab=backend.tabs.get('InvoiceNotes');for(const key of ['lastEditId','updatedAt','deletedAt','deleteReason']){const index=tab.data[0].indexOf(key);tab.data.forEach(row=>row.splice(index,1));}
 assert.equal(backend.post('listAccounts',{}).ok,true);assert.equal(tab.data[0].includes('lastEditId'),false);
 assert.equal(backend.post('updateInvoiceNote',{...payload,reason:'Legacy corrected',_editId:'legacy-note-edit-0000001',_expectedRevision:0}).ok,true);assert.equal(tab.data[0].includes('lastEditId'),true);assert.equal(backend.post('listAccounts',{}).notes[0].reason,'Legacy corrected');
 assert.equal(invoiceNeedsCost({...invoice,costTotalMinor:null}),true);assert.equal(invoiceNeedsCost({...invoice,costTotalMinor:0}),false);assert.equal(invoiceNeedsCost({...invoice,type:'purchase',costTotalMinor:null}),false);assert.equal(invoiceNeedsCost({...invoice,status:'deleted',costTotalMinor:null}),false);
 assert.equal(historyNotes([{...backend.post('listAccounts',{}).notes[0],status:'deleted'}],'2026-01-01','2026-12-31').length,0);
});
