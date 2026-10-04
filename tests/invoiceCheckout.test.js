import test from 'node:test';
import assert from 'node:assert/strict';
import {accountBackend} from './helpers/accountBackend.js';
import {blankInvoice,makeInvoice,makeParty,invoiceDraftFromRecord,invoiceSummary,accountBalances} from '../src/accounts.js';
import {invoiceDiscount} from '../src/invoiceAmounts.js';
import {walkInPayment} from '../src/invoiceCheckout.js';
import {invoiceMessage,whatsappRecipient} from '../src/invoiceMessage.js';
import {paymentMethodBalance} from '../src/ledger.js';
import {readInvoiceDraft,invoiceDraftKey} from '../src/invoiceDraft.js';
import {dashboardInsights,comparisonPeriods} from '../src/dashboardInsights.js';
const id='invoice-checkout-000000001',partyId='party-checkout-0000000001';
const draft=()=>({...blankInvoice(),walkIn:true,invoiceDate:'2026-10-02',discount:'50',items:[{description:'WINDOW',quantity:'1',rate:'1000',cost:'600',discount:'0'}]});
function payload(method='Cash',details={}){const invoice=makeInvoice(draft(),id);return {...invoice,payment:walkInPayment(invoice,{method,cashReceived:'1000',onlineChange:'50',...details})};}
const snapshot=b=>b.post('listAccounts',{});

test('global discount rounds once, defaults to amount and validates input',()=>{
 assert.equal(invoiceDiscount(10001,'percent','12.34').invoiceDiscountMinor,1234);
 assert.equal(invoiceDiscount(1,'percent','50').invoiceDiscountMinor,1);
 assert.equal(invoiceDiscount(10000,undefined,'25').invoiceDiscountMinor,2500);
 for(const [mode,value] of [['percent','100.01'],['amount','101'],['amount','-1'],['amount','1.001'],['other','1']])assert.throws(()=>invoiceDiscount(10000,mode,value));
 assert.throws(()=>makeInvoice({...draft(),discount:'1000'},id),/positive/);
});
test('cash checkout keeps gross cash received and online change while profit uses the discounted invoice only',()=>{
 const b=accountBackend(),p=payload(),saved=b.post('createInvoice',p);assert.equal(saved.ok,true,saved.error);
 assert.equal(saved.record.totalMinor,95000);assert.equal(saved.transaction.amountMinor,95000);
 const data=snapshot(b);assert.equal(data.ok,true,data.error);assert.equal(data.parties.length,0);assert.equal(data.transactions.length,1);
 assert.deepEqual(paymentMethodBalance(data.transactions),{Cash:100000,Online:-5000});
 assert.equal(invoiceSummary(data.invoices,'2026-10-01','2026-10-31').grossProfit,35000);
 assert.deepEqual(accountBalances(data.parties,data.invoices,data.transactions),[]);
 assert.deepEqual(b.post('createInvoice',p).record,saved.record);assert.equal(snapshot(b).transactions.length,1);
 const message=invoiceMessage(data.invoices[0],{shopName:'Royal'},{transactions:data.transactions});
 assert.match(message,/Paid in full/);assert.doesNotMatch(message,/600|Cost|CP|profit/i);
});
test('online checkout creates one normal Sale receipt, without cash-change fields or a party',()=>{
 const b=accountBackend(),saved=b.post('createInvoice',payload('Online'));assert.equal(saved.ok,true,saved.error);
 assert.equal(saved.transaction.method,'Online');assert.equal(saved.transaction.cashReceivedMinor,'');
 assert.deepEqual(paymentMethodBalance(snapshot(b).transactions),{Cash:0,Online:95000});
});
test('interrupted parent commit hides the staged payment in every reader and retry recovers both records',()=>{
 const b=accountBackend(),p=payload();b.failNext('Invoices');assert.equal(b.post('createInvoice',p).ok,false);
 assert.equal(snapshot(b).invoices.length,0);assert.equal(snapshot(b).transactions.length,0);assert.equal(b.post('list',{}).transactions.length,0);
 assert.equal(b.tabs.get('Transactions').data.length,2);
 assert.equal(b.post('createInvoice',p).ok,true);assert.equal(snapshot(b).invoices.length,1);assert.equal(snapshot(b).transactions.length,1);assert.equal(b.tabs.get('Transactions').data.length,2);
});
test('interrupted payment commit exposes no invoice and retry does not duplicate items',()=>{
 const b=accountBackend(),p=payload();b.failNext('Transactions');assert.equal(b.post('createInvoice',p).ok,false);
 assert.equal(snapshot(b).invoices.length,0);assert.equal(snapshot(b).transactions.length,0);
 assert.equal(b.post('createInvoice',p).ok,true);assert.equal(b.tabs.get('InvoiceItems').data.length,2);
});
test('walk-in creation rejects missing, mismatched, short and cheque payments before writing',()=>{
 for(const change of [p=>delete p.payment,p=>p.payment.amountMinor--,p=>p.payment.invoiceId='other-invoice-00000000001',p=>p.payment.method='Cheque',p=>p.payment.cashReceivedMinor=90000,p=>p.payment.partyId=partyId]){
  const b=accountBackend(),p=payload();change(p);assert.equal(b.post('createInvoice',p).ok,false);assert.equal(snapshot(b).invoices.length,0);assert.equal(snapshot(b).transactions.length,0);
 }
 assert.throws(()=>walkInPayment(makeInvoice(draft(),id),{method:'Cash',cashReceived:'900'}),/less|short|received/i);
});
test('changed retry payload cannot overwrite an already-staged payment',()=>{
 const b=accountBackend(),p=payload();b.failNext('Invoices');b.post('createInvoice',p);
 const changed=structuredClone(p);changed.payment.transactionTime='00:01';assert.equal(b.post('createInvoice',changed).ok,false);
 assert.equal(snapshot(b).transactions.length,0);assert.equal(b.post('createInvoice',p).ok,true);
});
test('party and legacy discounts survive edit, summary reads and additive schema upgrades',()=>{
 const b=accountBackend();b.post('createParty',makeParty({name:'Regular',phone:'',address:'',openingDate:'2026-01-01',openingBalance:'0'},partyId));
 const p=makeInvoice({...draft(),walkIn:false,partyId,discountMode:'percent',discount:'10',items:[{...draft().items[0],discount:'20'}]},id);
 const saved=b.post('createInvoice',p);assert.equal(saved.ok,true);assert.equal(saved.record.totalMinor,88200);
 const restore=invoiceDraftFromRecord(saved.record);assert.equal(restore.items[0].discount,'20.00');assert.equal(restore.discount,'10');
 const edited=b.post('updateInvoice',{...makeInvoice(restore,id),invoiceNumber:saved.record.invoiceNumber,_editId:'edit-checkout-00000000001',_expectedRevision:0});assert.equal(edited.ok,true,edited.error);assert.equal(edited.record.totalMinor,88200);
 const summary=b.post('listAccounts',{summary:true}).invoices[0];assert.equal(summary.itemDiscountMinor,2000);assert.equal(summary.invoiceDiscountMinor,9800);assert.equal(summary.paymentSnapshot,undefined);
 const tab=b.tabs.get('Invoices'),untouched=[...tab.data[1]];b.post('listAccounts',{});assert.deepEqual(tab.data[1],untouched);
});
test('walk-in cost edits preserve the payment; amount/date edits are rejected',()=>{
 const b=accountBackend(),saved=b.post('createInvoice',payload()),restore=invoiceDraftFromRecord(saved.record);restore.items[0].cost='500';
 const edit={...makeInvoice(restore,id),invoiceNumber:saved.record.invoiceNumber,_editId:'edit-checkout-00000000001',_expectedRevision:0};
 assert.equal(b.post('updateInvoice',edit).ok,true);assert.equal(snapshot(b).transactions.length,1);assert.equal(snapshot(b).invoices[0].costTotalMinor,50000);
 restore.items[0].rate='1100';assert.equal(b.post('updateInvoice',{...edit,...makeInvoice(restore,id),invoiceNumber:edit.invoiceNumber,_editId:'edit-checkout-00000000002',_expectedRevision:1}).ok,false);
});
test('deleted payment is not described as paid, and original invoice retry cannot recreate it',()=>{
 const b=accountBackend(),p=payload(),saved=b.post('createInvoice',p);assert.equal(b.post('deletePayment',{id:saved.transaction.id,_expectedRevision:0}).ok,true);
 const data=snapshot(b);assert.match(invoiceMessage(data.invoices[0],{shopName:'Royal'},{transactions:data.transactions}),/unavailable/);
 assert.equal(b.post('createInvoice',p).ok,true);assert.equal(snapshot(b).transactions.length,0);
});
test('messages use overall party balance, hide private figures, sanitize markup and format recipient numbers',()=>{
 const invoice={...makeInvoice({...draft(),walkIn:false,partyId},id),partyName:'Ali*\nFake',invoiceNumber:'RF-S-000001',status:'issued'};
 const msg=invoiceMessage(invoice,{shopName:'Royal'},{partyBalance:250000,checkedAt:'2026-10-02T10:00:00Z'});
 assert.match(msg,/Current party balance: ₹2,500.00 to receive/);assert.match(msg,/overall account balance, including other invoices/);assert.doesNotMatch(msg,/Pending:|CP|profit|600|\nFake/);
 assert.equal(whatsappRecipient('9876543210'),'919876543210');assert.equal(whatsappRecipient('+44 7700 900123'),'447700900123');assert.equal(whatsappRecipient(''),'');assert.throws(()=>whatsappRecipient('abc123'));
});
test('checkout drafts preserve fields, but restored rejected invoices get fresh payment identities',()=>{
 const source={...draft(),checkout:{method:'Cash',cashReceived:'1000',cashChange:'',onlineChange:'50'}},map=new Map([[invoiceDraftKey('test'),JSON.stringify(source)]]);
 const storage={getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};
 assert.deepEqual(readInvoiceDraft(storage,'test').draft.checkout,{amount:'',...source.checkout});
 const old=payload(),restored=invoiceDraftFromRecord(old),fresh=makeInvoice(restored,'invoice-checkout-000000002');assert.equal(fresh.paymentId,'invoice-checkout-000000002-payment');
});
test('dashboard counts walk-in sales without inventing customers or duplicating profit',()=>{
 const b=accountBackend();b.post('createInvoice',payload());const data=snapshot(b);
 const insights=dashboardInsights({...data,partyBalances:[],range:['2026-10-01','2026-10-31'],period:'month'});
 assert.equal(insights.invoiceCount,1);assert.equal(insights.customerCount,0);assert.equal(insights.topCustomers.length,0);assert.equal(insights.figures.grossProfit,35000);assert.equal(insights.cashMovement,95000);assert.equal(insights.discounts.invoiceDiscounts,5000);
 assert.deepEqual(comparisonPeriods(['2026-10-01','2026-10-31'],'month','2026-10-02'),{current:['2026-10-01','2026-10-02'],previous:['2026-09-01','2026-09-02']});
 assert.deepEqual(comparisonPeriods(['2026-09-01','2026-09-30'],'last','2026-10-02'),{current:['2026-09-01','2026-09-30'],previous:['2026-08-01','2026-08-31']});
});

function partyCheckout(type='sale',amount='300'){
 const b=accountBackend();const party=makeParty({name:'Advance customer',phone:'9876543210',address:'',openingDate:'2026-01-01',openingBalance:'100'},partyId);b.post('createParty',party);
 const p={...makeInvoice({...draft(),walkIn:false,partyId,type,paymentWithInvoice:true},id),partyName:party.name};p.payment=walkInPayment(p,{method:'Cash',amount,cashReceived:'350',onlineChange:'50'});return {b,p,party};
}
test('party advance reduces the overall balance without changing revenue or profit',()=>{
 const {b,p}=partyCheckout();const result=b.post('createInvoice',p);assert.equal(result.ok,true,result.error);assert.equal(result.transaction.partyId,partyId);assert.equal(result.transaction.direction,'in');
 const data=snapshot(b);assert.equal(accountBalances(data.parties,data.invoices,data.transactions)[0].balance,75000);assert.deepEqual(paymentMethodBalance(data.transactions),{Cash:35000,Online:-5000});assert.equal(invoiceSummary(data.invoices,'2026-10-01','2026-10-31').grossProfit,35000);
 const message=invoiceMessage(data.invoices[0],{shopName:'Royal'},{transactions:data.transactions,partyBalance:75000});assert.match(message,/Payment recorded with invoice: ₹300.00 · Cash/);assert.match(message,/Current party balance: ₹750.00 to receive/);assert.doesNotMatch(message,/Pending:/);
});
test('purchase invoice checkout records payment out and reduces what we owe',()=>{
 const {b,p}=partyCheckout('purchase');const result=b.post('createInvoice',p);assert.equal(result.ok,true,result.error);assert.equal(result.transaction.category,'Purchase');assert.equal(result.transaction.direction,'out');assert.equal(result.transaction.cashReceivedMinor,'');
 const data=snapshot(b);assert.equal(accountBalances(data.parties,data.invoices,data.transactions)[0].balance,-55000);assert.deepEqual(paymentMethodBalance(data.transactions),{Cash:-30000,Online:0});
});
test('party advances recover staged writes and retries without duplicate receipts',()=>{
 const {b,p}=partyCheckout();b.failNext('Invoices');assert.equal(b.post('createInvoice',p).ok,false);assert.equal(snapshot(b).transactions.length,0);assert.equal(b.post('createInvoice',p).ok,true);assert.equal(b.post('createInvoice',p).ok,true);assert.equal(snapshot(b).transactions.length,1);
});
test('a party advance cannot be detached, use another party, or exceed the invoice amount',()=>{
 const {b,p}=partyCheckout();assert.throws(()=>walkInPayment(p,{method:'Online',amount:'951'}),/exceed/);assert.throws(()=>walkInPayment(p,{method:'Cash',amount:'0'}),/positive/);
 assert.equal(b.post('createInvoice',{...p,payment:{...p.payment,partyId:''}}).ok,false);assert.equal(b.post('createInvoice',{...p,paymentId:''}).ok,false);assert.equal(b.post('createInvoice',{...p,payment:{...p.payment,amountMinor:100000}}).ok,false);
 const saved=b.post('createInvoice',p);assert.equal(saved.ok,true);assert.equal(b.post('update',{...p.payment,partyId:'',_editId:'edit-payment-00000000001',_expectedRevision:0}).ok,false);
});
test('editing a party invoice preserves its advance while updating invoice totals',()=>{
 const {b,p}=partyCheckout(),saved=b.post('createInvoice',p),restored=invoiceDraftFromRecord(saved.record);restored.items[0].rate='1200';assert.equal(restored.paymentWithInvoice,false);
 const edited=b.post('updateInvoice',{...makeInvoice(restored,id),invoiceNumber:saved.record.invoiceNumber,_editId:'edit-advance-00000000001',_expectedRevision:0});assert.equal(edited.ok,true,edited.error);assert.equal(snapshot(b).transactions[0].amountMinor,30000);assert.equal(snapshot(b).invoices[0].totalMinor,115000);
 const retried=b.post('createInvoice',p);assert.equal(retried.ok,true,retried.error);assert.equal(snapshot(b).transactions.length,1);
});
test('rejected party checkout restores amount and creates fresh linked IDs; opting out clears the link',()=>{
 const {p}=partyCheckout(),restore=invoiceDraftFromRecord(p);assert.equal(restore.paymentWithInvoice,true);assert.equal(restore.checkout.amount,'300');
 const next=makeInvoice(restore,'invoice-checkout-000000002');assert.equal(next.paymentId,'invoice-checkout-000000002-payment');
 assert.equal(makeInvoice({...restore,paymentWithInvoice:false},'invoice-checkout-000000002').paymentId,undefined);
 const raw=JSON.stringify({...draft(),walkIn:false,partyId,paymentWithInvoice:true,checkout:{method:'Online',amount:'300',cashReceived:'',cashChange:'',onlineChange:''}});const restored=readInvoiceDraft({getItem:()=>raw,setItem(){}},'test').draft;assert.equal(restored.paymentWithInvoice,true);assert.equal(restored.checkout.amount,'300');
});
