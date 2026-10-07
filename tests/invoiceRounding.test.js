import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceRounding} from '../src/invoiceAmounts.js';
import {blankInvoice,makeInvoice,makeParty,invoiceDraftFromRecord,accountBalances,invoiceSummary} from '../src/accounts.js';
import {invoicePayment} from '../src/invoiceCheckout.js';
import {readInvoiceDraft,invoiceDraftKey} from '../src/invoiceDraft.js';
import {accountBackend} from './helpers/accountBackend.js';

const partyId='rounding-party-000000001',id='rounding-invoice-0000001';
const draft=()=>({...blankInvoice(),partyId,invoiceDate:'2026-10-07',autoRoundOff:true,discount:'0.20',items:[{description:'WINDOW',quantity:'1',rate:'100.69',cost:'60',discount:'0'}]});
function backend(){const b=accountBackend();assert.equal(b.post('createParty',makeParty({name:'Ali',phone:'',address:'',openingDate:'2026-01-01',openingBalance:'0'},partyId)).ok,true);return b;}

test('nearest rupee rounding preserves paise when disabled and handles ties and small totals',()=>{
 for(const [total,expected] of [[10049,10000],[10050,10100],[10099,10100],[10000,10000],[50,100],[100000000000,100000000000]])assert.equal(invoiceRounding(total,true).totalMinor,expected);
 assert.deepEqual(invoiceRounding(10049),{autoRoundOff:false,roundOffMinor:0,totalMinor:10049});
 assert.throws(()=>invoiceRounding(49,true),/positive/);assert.throws(()=>invoiceRounding(100,'true'),/option/);
});
test('discount precedes rounding; Sheets, balance, profit and editing use the same rounded total',()=>{
 const b=backend(),invoice=makeInvoice(draft(),id),saved=b.post('createInvoice',invoice);assert.equal(saved.ok,true,saved.error);
 assert.equal(saved.record.totalMinor,10000);assert.equal(saved.record.roundOffMinor,-49);
 let data=b.post('listAccounts',{});assert.equal(data.ok,true,data.error);
 assert.equal(accountBalances(data.parties,data.invoices,data.transactions)[0].balance,10000);
 assert.equal(invoiceSummary(data.invoices,'2026-10-01','2026-10-31').grossProfit,4000);
 const restored=invoiceDraftFromRecord(data.invoices[0]);assert.equal(restored.autoRoundOff,true);
 const edit={...makeInvoice({...restored,discount:'0.19'},id),invoiceNumber:saved.record.invoiceNumber,_editId:'rounding-edit-0000000001',_expectedRevision:0};
 const result=b.post('updateInvoice',edit);assert.equal(result.ok,true,result.error);assert.equal(result.record.totalMinor,10100);assert.equal(result.record.roundOffMinor,50);
 assert.equal(b.post('updateInvoice',edit).ok,true);data=b.post('listAccounts',{});assert.equal(data.ok,true,data.error);assert.equal(data.invoices[0].totalMinor,10100);
});
test('rounding is durable in drafts; ordinary and legacy invoices retain their exact totals',()=>{
 const values=new Map([[invoiceDraftKey('test'),JSON.stringify(draft())]]);const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 assert.equal(readInvoiceDraft(storage,'test').draft.autoRoundOff,true);
 const b=backend(),invoice=makeInvoice({...draft(),autoRoundOff:false},id);
 delete invoice.autoRoundOff;delete invoice.roundOffMinor;delete invoice.invoiceRoundingSchemaVersion;
 assert.equal(b.post('createInvoice',invoice).ok,true);const data=b.post('listAccounts',{});assert.equal(data.ok,true,data.error);assert.equal(data.invoices[0].totalMinor,10049);assert.equal(data.invoices[0].autoRoundOff,false);
 assert.equal(invoiceDraftFromRecord(data.invoices[0]).autoRoundOff,false);
});
test('rounded walk-in checkout pays exactly once and tampered adjustments are rejected',()=>{
 const b=accountBackend(),invoice=makeInvoice({...draft(),partyId:'',walkIn:true},id);invoice.payment=invoicePayment(invoice,{method:'Online'});
 assert.equal(b.post('createInvoice',{...invoice,roundOffMinor:0}).ok,false);
 const saved=b.post('createInvoice',invoice);assert.equal(saved.ok,true,saved.error);assert.equal(saved.transaction.amountMinor,10000);
 assert.equal(b.post('createInvoice',invoice).ok,true);assert.equal(b.post('listAccounts',{}).transactions.length,1);
});
