import test from 'node:test';
import assert from 'node:assert/strict';
import {accountBackend} from './helpers/accountBackend.js';
import {makeParty,makeInvoice,accountBalances,invoiceDraftFromRecord,partyStatement} from '../src/accounts.js';
import {makeTransaction,paymentMethodBalance,transactionIntegrityIssue} from '../src/ledger.js';
import {makePartySettlement} from '../src/settlement.js';
import {invoicePayment} from '../src/invoiceCheckout.js';
import {catalogueKey,findCatalogue,applyCatalogueItem} from '../src/catalogue.js';
import {statementMessage} from '../src/statementMessage.js';
import {wrapImageText} from '../src/documentImages.js';
const id='invoice-feature-000000001',partyId='party-feature-00000000001';
const draft=()=>({notes:'',walkIn:true,type:'sale',invoiceDate:'2026-10-05',items:[{description:'Window',quantity:'1',rate:'640',cost:'300',discount:'0'}]});
function checkout(){const invoice=makeInvoice(draft(),id);invoice.partyName='CASH SALE';invoice.payment=invoicePayment(invoice,{method:'Split',cashPortion:'600'});return invoice;}
const snapshot=b=>b.post('listAccounts',{});

test('one split invoice receipt updates Cash and Online exactly once and retries safely',()=>{
 const b=accountBackend(),invoice=checkout(),result=b.post('createInvoice',invoice);assert.equal(result.ok,true,result.error);assert.equal(result.transaction.cashPortionMinor,60000);assert.equal(result.transaction.onlinePortionMinor,4000);assert.equal(snapshot(b).transactions.length,1);assert.deepEqual(paymentMethodBalance(snapshot(b).transactions),{Cash:60000,Online:4000});assert.equal(b.post('createInvoice',invoice).ok,true);assert.equal(snapshot(b).transactions.length,1);
 const restored=invoiceDraftFromRecord(invoice);assert.equal(restored.checkout.cashPortion,'600');assert.equal(invoicePayment(invoice,restored.checkout).amountMinor,64000);
});
test('split payment validation rejects unequal, negative or absent portions before money moves',()=>{
 const b=accountBackend(),invoice=checkout();for(const payment of [{...invoice.payment,cashPortionMinor:0},{...invoice.payment,onlinePortionMinor:5000},{...invoice.payment,onlinePortionMinor:-1}])assert.equal(b.post('createInvoice',{...invoice,payment}).ok,false);
 assert.equal(snapshot(b).invoices.length,0);assert.equal(snapshot(b).transactions.length,0);
 assert.throws(()=>invoicePayment(invoice,{method:'Split',cashPortion:'640'}),/add up/);assert.throws(()=>invoicePayment(invoice,{method:'Split',cashPortion:'-1'}));assert.equal(transactionIntegrityIssue({...invoice.payment,onlinePortionMinor:5000}),'unbalanced split payment');
});
test('split ordinary payments affect the party once and edits clear obsolete portions',()=>{
 const b=accountBackend(),party=makeParty({name:'Supplier',partyType:'karigar',phone:'',address:'',openingDate:'2026-01-01',openingBalance:'1000',openingDirection:'payable'},partyId);assert.equal(b.post('createParty',party).ok,true);
 const payment=makeTransaction({recordType:'payment',partyId,party:party.name,category:'Purchase',direction:'out',method:'Split',amount:'640',cashPortion:'600',dateTime:'2026-10-05T12:00'},'payment-feature-000000001');assert.equal(b.post('create',payment).ok,true);let data=snapshot(b);assert.equal(accountBalances(data.parties,data.invoices,data.transactions)[0].balance,-36000);assert.deepEqual(paymentMethodBalance(data.transactions),{Cash:-60000,Online:-4000});
 const edited=makeTransaction({recordType:'payment',partyId,party:party.name,category:'Purchase',direction:'out',method:'Online',amount:'640',dateTime:'2026-10-05T12:00'},payment.id);assert.equal(b.post('update',{...edited,_editId:'edit-payment-feature-0001',_expectedRevision:0}).ok,true);data=snapshot(b);assert.equal(data.transactions[0].cashPortionMinor,'');assert.deepEqual(paymentMethodBalance(data.transactions),{Cash:0,Online:-64000});
});
test('catalogue matches names case-insensitively and updates rates without rewriting prior invoices',()=>{
 const b=accountBackend(),first=checkout(),result=b.post('createInvoice',first);assert.equal(result.ok,true);const next=makeInvoice({...draft(),items:[{...draft().items[0],description:'  window  ',rate:'700',cost:'350'}]},'invoice-feature-000000002');next.partyName='CASH SALE';next.payment=invoicePayment(next,{method:'Online'});assert.equal(b.post('createInvoice',next).ok,true);
 let data=snapshot(b);assert.equal(data.catalogue.length,1);assert.equal(data.catalogue[0].name,'WINDOW');assert.equal(data.catalogue[0].rateMinor,70000);assert.equal(data.invoices.find(row=>row.id===id).totalMinor,64000);
 assert.equal(b.post('createInvoice',first).ok,true);data=snapshot(b);assert.equal(data.catalogue[0].rateMinor,70000);assert.equal(data.catalogue.length,1);
});
test('catalogue failure does not turn a committed invoice into a failed sale and a retry repairs it',()=>{
 const b=accountBackend(),invoice=checkout();b.failNext('ItemCatalogue');const result=b.post('createInvoice',invoice);assert.equal(result.ok,true);assert.match(result.catalogueWarning,/Invoice saved/);assert.equal(snapshot(b).invoices.length,1);assert.equal(snapshot(b).catalogue.length,1);assert.equal(b.post('createInvoice',invoice).ok,true);assert.equal(b.tabs.get('ItemCatalogue').data.length,2);assert.equal(snapshot(b).transactions.length,1);
});
test('legacy invoice catalogue suggestions are inferred by reads without creating a tab',()=>{
 const b=accountBackend();b.post('createInvoice',checkout());b.tabs.delete('ItemCatalogue');const data=snapshot(b);assert.equal(data.catalogue.length,1);assert.equal(b.tabs.has('ItemCatalogue'),false);
});
test('catalogue selection uses the right rate, preserves matching-unit measurements and clears incompatible units',()=>{
 const record={id:'WINDOW',name:'WINDOW',billingUnit:'sqft',saleBillingUnit:'sqft',purchaseBillingUnit:'sqft',costBillingUnit:'sqft',rateMinor:35000,saleRateMinor:35000,purchaseRateMinor:20000,costMinor:18000},item={description:'',rate:'',cost:'',billingUnit:'sqft',grouped:true,measurements:[{length:'3',width:'3'}]};
 const sale=applyCatalogueItem(item,record,'sale');assert.equal(sale.rate,'350');assert.equal(sale.cost,'180');assert.deepEqual(sale.measurements,item.measurements);assert.equal(applyCatalogueItem(item,record,'purchase').rate,'200');assert.equal(applyCatalogueItem({...item,billingUnit:'kg'},record,'sale').measurements.length,1);assert.equal(catalogueKey('  3   Track Window '),'3 TRACK WINDOW');assert.equal(findCatalogue([record],'wind').length,1);
});
test('public statement text preserves chronological debit/credit balances and excludes costs and private notes',()=>{
 const party={id:partyId,name:'Ali*\nFake',phone:'',openingBalanceMinor:10000,openingDate:'2026-01-01'},invoice={...makeInvoice({...draft(),walkIn:false,partyId},id),status:'issued',partyName:'Ali',notes:'private cost remark',createdAt:'2026-10-05T05:00:00Z'},payment=makeTransaction({recordType:'payment',partyId,party:'Ali',category:'Sale',direction:'in',method:'Split',amount:'640',cashPortion:'600',dateTime:'2026-10-05T12:00'},'payment-feature-000000001');
 const statement=partyStatement(party,[invoice],[payment],'2026-10-01','2026-10-31');const msg=statementMessage({party,statement,range:['2026-10-01','2026-10-31'],detailed:true,checkedAt:'2026-10-05T12:00:00Z'},{shopName:'Royal'});
 assert.match(msg,/Cash \+ Online/);assert.match(msg,/Closing balance: ₹100.00/);assert.doesNotMatch(msg,/private|CP|300.00|\nFake/);assert.ok(msg.indexOf('Sales invoice')<msg.indexOf('Payment received'));
});
test('image text wrapping preserves long words and unicode without overflowing its width',()=>{
 const context={measureText:text=>({width:Array.from(text).length})};const rows=wrapImageText(context,'LONGWORD12345 العربية',5);assert.ok(rows.every(row=>Array.from(row).length<=5));assert.equal(rows.join('').replace(/\s/g,''),'LONGWORD12345العربية');
});

test('full and final split payments waive the remainder without counting it as cash',()=>{
 const b=accountBackend(),party=makeParty({name:'Settling customer',phone:'',address:'',openingDate:'2026-01-01',openingBalance:'680'},partyId);b.post('createParty',party);
 const receipt=makePartySettlement(snapshot(b),{recordType:'payment',partyId,category:'Sale',direction:'in',method:'Split',amount:'640',cashPortion:'600',dateTime:'2026-10-05T12:00'},'split-settlement-00000001');assert.equal(receipt.settlementDiscountMinor,4000);assert.equal(b.post('create',receipt).ok,true);const data=snapshot(b);assert.equal(accountBalances(data.parties,data.invoices,data.transactions,data.notes)[0].balance,0);assert.deepEqual(paymentMethodBalance(data.transactions),{Cash:60000,Online:4000});assert.equal(b.post('create',{...receipt,cashPortionMinor:50000,onlinePortionMinor:14000}).ok,false);
});

test('catalogue selection clears stale CP, preserves explicit zero and requires known price units',()=>{
 const old={description:'OLD',billingUnit:'kg',rate:'100',cost:'50'};
 const fresh={name:'NEW',billingUnit:'kg',saleBillingUnit:'kg',saleRateMinor:20000,costMinor:''};
 assert.equal(applyCatalogueItem(old,fresh,'sale').cost,'');
 assert.equal(applyCatalogueItem(old,{...fresh,costMinor:0,costBillingUnit:'kg'},'sale').cost,'0');
 assert.equal(applyCatalogueItem(old,{...fresh,costMinor:5000,costBillingUnit:'nos'},'sale').cost,'');
 assert.equal(applyCatalogueItem(old,{name:'LEGACY',billingUnit:'kg',rateMinor:20000,saleRateMinor:20000,costMinor:5000},'sale').rate,'');
 assert.equal(applyCatalogueItem(old,fresh,'purchase').cost,'');
});
test('catalogue retains separate purchase and sale price units and does not rewrite issued invoices',()=>{
 const b=accountBackend(),party=makeParty({name:'Mixed units',partyType:'supplier',phone:'',address:'',openingDate:'2026-01-01',openingBalance:'0'},partyId);assert.equal(b.post('createParty',party).ok,true);
 const sale=makeInvoice({partyId,type:'sale',notes:'',invoiceDate:'2026-10-05',items:[{description:'MATERIAL',billingUnit:'kg',quantity:'1',rate:'100',cost:'50'}]},'invoice-mixed-unit-sale001');
 const purchase=makeInvoice({partyId,type:'purchase',notes:'',invoiceDate:'2026-10-06',items:[{description:'MATERIAL',billingUnit:'nos',quantity:'1',rate:'20'}]},'invoice-mixed-unit-buy0001');
 assert.equal(b.post('createInvoice',sale).ok,true);assert.equal(b.post('createInvoice',purchase).ok,true);
 const data=snapshot(b),record=data.catalogue[0],draftItem={description:'OLD',billingUnit:'nos',cost:'999'};
 const saleItem=applyCatalogueItem(draftItem,record,'sale'),purchaseItem=applyCatalogueItem(draftItem,record,'purchase');
 assert.equal(saleItem.billingUnit,'kg');assert.equal(saleItem.rate,'100');assert.equal(saleItem.cost,'50');
 assert.equal(purchaseItem.billingUnit,'nos');assert.equal(purchaseItem.rate,'20');assert.equal(purchaseItem.cost,'');
 assert.equal(data.invoices.find(row=>row.id===sale.id).totalMinor,10000);assert.equal(data.invoices.find(row=>row.id===purchase.id).totalMinor,2000);
});

test('invoice detail tokens detect direct Sheet changes to lines and document headers',()=>{
 const b=accountBackend();b.post('createInvoice',checkout());let first=b.post('listAccounts',{summary:true}).invoices[0].detailToken;assert.equal(typeof first,'string');const tab=b.tabs.get('Invoices');tab.data[1][tab.data[0].indexOf('challanNumber')]='UPDATED CHALLAN';const second=b.post('listAccounts',{summary:true}).invoices[0].detailToken;assert.notEqual(second,first);assert.equal(b.post('getInvoices',{ids:[id]}).invoices[0].detailToken,second);
});
