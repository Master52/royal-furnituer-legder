import test from 'node:test';
import assert from 'node:assert/strict';
import {accountBackend} from './helpers/accountBackend.js';
import {makeParty,makeInvoice,makeInvoiceNote,invoiceNoteRevision,invoiceSummary,partyStatement,accountBalances,invoiceDraftFromRecord} from '../src/accounts.js';
import {makeTransaction,paymentMethodBalance} from '../src/ledger.js';
import {partyPaymentEntry,hasDraft} from '../src/entry.js';
const party=makeParty({name:'Delete test',phone:'123',address:'Original',openingDate:'2026-01-01',openingBalance:'0'},'party-delete-00000000001');
const invoiceDraft={partyId:party.id,type:'sale',invoiceDate:'2026-09-01',notes:'Original',items:[{description:'Chair',quantity:'1',rate:'100',discount:'0',cost:'60'}]};
function fixture(){const backend=accountBackend();backend.post('createParty',party);const invoice=backend.post('createInvoice',makeInvoice(invoiceDraft,'invoice-delete-000000001')).record;return {backend,invoice};}
function receipt(){return makeTransaction({partyId:party.id,party:party.name,category:'Sale',direction:'in',method:'Cash',amount:'30',dateTime:'2026-09-02T12:00'},'receipt-delete-000000001');}
function deleteRequest(invoice,notes=[]){return {id:invoice.id,reason:'Entered by mistake',_expectedRevision:Number(invoice.revision||0),_expectedNotes:invoiceNoteRevision(notes,invoice.id)};}
test('invoice deletion removes its effect and notes without deleting their rows or payments',()=>{
 const {backend,invoice}=fixture();const payment=receipt();backend.post('create',payment);
 const note=backend.post('createInvoiceNote',makeInvoiceNote({type:'credit',effect:'price',amount:'20',noteDate:'2026-09-02',reason:'Discount'},invoice,'note-delete-000000000001')).record;
 const before=JSON.stringify(backend.tabs.get('InvoiceNotes').data),items=JSON.stringify(backend.tabs.get('InvoiceItems').data);
 const result=backend.post('deleteInvoice',deleteRequest(invoice,[note]));assert.equal(result.ok,true);assert.equal(result.record.status,'deleted');assert.ok(result.record.deletedAt);
 const data=backend.post('listAccounts',{});assert.equal(data.ok,true);assert.equal(data.notes[0].status,'deleted');assert.equal(JSON.stringify(backend.tabs.get('InvoiceNotes').data),before);assert.equal(JSON.stringify(backend.tabs.get('InvoiceItems').data),items);
 assert.equal(invoiceSummary(data.invoices,'2026-01-01','2026-12-31',data.notes).sales,0);assert.equal(partyStatement(party,data.invoices,data.transactions,'2026-01-01','2026-12-31',data.notes).closing,-3000);
 assert.equal(accountBalances(data.parties,data.invoices,data.transactions,data.notes)[0].balance,-3000);assert.deepEqual(paymentMethodBalance(data.transactions),{Cash:3000,Online:0});
 assert.equal(backend.post('cancelInvoice',{id:invoice.id,reason:'Old client request'}).ok,false);
 assert.equal(backend.post('updateInvoice',{...makeInvoice(invoiceDraftFromRecord(invoice),invoice.id),invoiceNumber:invoice.invoiceNumber,_editId:'edit-deleted-00000000001',_expectedRevision:0}).ok,false);
});
test('lost replies and interrupted deletes retry safely; deleted invoice numbers are never reused',()=>{
 const {backend,invoice}=fixture();const request=deleteRequest(invoice);backend.failNext('Invoices');assert.equal(backend.post('deleteInvoice',request).ok,false);assert.equal(backend.post('listAccounts',{}).invoices[0].status,'issued');
 assert.equal(backend.post('deleteInvoice',request).ok,true);assert.equal(backend.post('deleteInvoice',request).ok,true);assert.equal(backend.post('listAccounts',{}).invoices.length,1);
 const next=backend.post('createInvoice',makeInvoice(invoiceDraft,'invoice-delete-000000002'));assert.equal(next.record.invoiceNumber,'RF-S-000002');
 assert.equal(backend.post('createInvoice',makeInvoice(invoiceDraft,invoice.id)).record.status,'deleted');
});
test('stale invoice revisions and changed note sets cannot be deleted using an old screen',()=>{
 const {backend,invoice}=fixture();assert.equal(backend.post('deleteInvoice',{...deleteRequest(invoice),_expectedRevision:1}).code,'EDIT_CONFLICT');
 const note=backend.post('createInvoiceNote',makeInvoiceNote({type:'credit',effect:'price',amount:'20',noteDate:'2026-09-02',reason:'Discount'},invoice,'note-delete-000000000001')).record;
 assert.equal(backend.post('deleteInvoice',deleteRequest(invoice)).code,'EDIT_CONFLICT');
 const stale=deleteRequest(invoice,[note]);backend.post('cancelInvoiceNote',{id:note.id,reason:'Mistake',_expectedRevision:0});assert.equal(backend.post('deleteInvoice',stale).code,'EDIT_CONFLICT');
 assert.equal(backend.post('listAccounts',{}).invoices[0].status,'issued');
});
test('empty parties can be deleted but active invoices, payments and opening balances are protected',()=>{
 const {backend,invoice}=fixture();const removeParty={id:party.id,_expectedRevision:0};assert.equal(backend.post('deleteParty',removeParty).ok,false);
 backend.post('deleteInvoice',deleteRequest(invoice));backend.post('create',receipt());assert.equal(backend.post('deleteParty',removeParty).ok,false);
 backend.post('delete',{id:receipt().id});assert.equal(backend.post('deleteParty',removeParty).ok,true);
 const data=backend.post('listAccounts',{});assert.equal(data.ok,true);assert.ok(data.parties[0].archivedAt);assert.equal(data.invoices[0].status,'deleted');assert.equal(backend.post('deleteParty',removeParty).ok,true);
 assert.equal(backend.post('create',receipt()).ok,false);
 const deletedPayment=backend.post('listDeleted',{}).transactions[0];assert.equal(backend.post('restore',{id:deletedPayment.id,deletedAt:deletedPayment.deletedAt,_expectedRevision:Number(deletedPayment.revision)}).ok,false);
 assert.equal(backend.post('createInvoice',makeInvoice(invoiceDraft,'invoice-delete-000000002')).ok,false);
 const withBalance={...party,id:'party-opening-0000000001',openingBalanceMinor:1000};backend.post('createParty',withBalance);assert.equal(backend.post('deleteParty',{id:withBalance.id,_expectedRevision:0}).ok,false);
});
test('party deletion checks current contact revision and preserves old/unknown columns',()=>{
 const backend=accountBackend();backend.post('createParty',party);const sheet=backend.tabs.get('Parties');sheet.data[0].push('futureColumn');sheet.data[1].push('untouched');
 backend.post('updateParty',{id:party.id,name:'New name',phone:'123',address:'New',_expectedRevision:0,_editId:'edit-party-delete-000001'});
 assert.equal(backend.post('deleteParty',{id:party.id,_expectedRevision:0}).ok,false);
 assert.equal(backend.post('deleteParty',{id:party.id,_expectedRevision:1}).ok,true);assert.equal(sheet.data[1].at(-1),'untouched');assert.equal(backend.post('listAccounts',{}).parties[0].name,'New name');
});
test('legacy invoices without deletion columns read normally until the additive delete upgrade',()=>{
 const {backend,invoice}=fixture();const sheet=backend.tabs.get('Invoices');for(const key of ['deletedAt','deleteReason']){const index=sheet.data[0].indexOf(key);sheet.data.forEach(row=>row.splice(index,1));}
 assert.equal(backend.post('listAccounts',{}).ok,true);assert.equal(backend.post('deleteInvoice',deleteRequest(invoice)).ok,true);assert.ok(sheet.data[0].includes('deletedAt'));
 assert.equal(backend.post('listAccounts',{}).invoices[0].totalMinor,10000);
});
test('party payment keeps party context but starts with no selected direction, category or method',()=>{
 const form=partyPaymentEntry(party);assert.equal(form.partyId,party.id);assert.equal(form.party,party.name);for(const key of ['direction','category','method','amount'])assert.equal(form[key],'');assert.equal(hasDraft(form),false);
 assert.throws(()=>makeTransaction({...form,amount:'10'}),/Choose a valid category, payment method and direction/);
 for(const key of ['direction','category','method'])assert.equal(hasDraft({...form,[key]:key==='direction'?'in':key==='category'?'Sale':'Cash'}),true);
 const payment=makeTransaction({...form,direction:'out',category:'Sale',method:'Cash',amount:'10'});assert.equal(payment.direction,'out');assert.equal(payment.category,'Sale');assert.equal(payment.partyId,party.id);
});
