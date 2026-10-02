import test from 'node:test';
import assert from 'node:assert/strict';
import {accountBackend} from './helpers/accountBackend.js';
import {makeParty,makeInvoice,makeInvoiceNote,accountBalances,partyStatement} from '../src/accounts.js';
import {makeTransaction,hasSettlement,transactionIntegrityIssue,paymentMethodBalance} from '../src/ledger.js';
import {businessFigures} from '../src/business.js';
import {partySettlementQuote,settlementDiscount,makePartySettlement} from '../src/settlement.js';
import {invoiceProfitFigures} from '../src/invoiceProfit.js';
import {newEntry,editEntry,hasDraft} from '../src/entry.js';
const id='settlement-payment-000001';
const form={recordType:'payment',partyId:'settlement-party-00000001',direction:'in',category:'Sale',amount:'6000',method:'Cash',dateTime:'2026-11-05T12:00',notes:'Agreed full and final'};
function fixture(openingOnly=false){
 const backend=accountBackend(),party=makeParty({name:'Settlement customer',phone:'123',address:'',openingDate:'2026-01-01',openingBalance:openingOnly?'6750':'0'},form.partyId);backend.post('createParty',party);
 let invoice;
 if(!openingOnly){invoice=backend.post('createInvoice',makeInvoice({partyId:party.id,type:'sale',invoiceDate:'2026-10-31',notes:'',items:[{description:'Window',quantity:'1',rate:'16750',cost:'12000',discount:'0'}]},'settlement-invoice-000001')).record;backend.post('create',makeTransaction({...form,amount:'10000',dateTime:'2026-10-31T12:00'},'settlement-advance-000001'));}
 return {backend,party,invoice,snapshot:()=>backend.post('listAccounts',{})};
}
test('party settlement saves actual money and waiver in one receipt without changing any invoice',()=>{
 const {backend,invoice,snapshot}=fixture(),before=JSON.stringify(backend.tabs.get('Invoices').data);
 const transaction=makePartySettlement(snapshot(),form,id);assert.equal(transaction.amountMinor,600000);assert.equal(transaction.settlementDiscountMinor,75000);assert.equal(transaction._expectedPartyBalanceMinor,675000);
 assert.equal(backend.post('create',transaction).ok,true);assert.equal(backend.post('create',transaction).duplicate,true);
 const data=snapshot();assert.equal(data.transactions.length,2);assert.equal(data.notes.length,0);assert.equal(accountBalances(data.parties,data.invoices,data.transactions,data.notes)[0].balance,0);assert.equal(JSON.stringify(backend.tabs.get('Invoices').data),before);assert.equal(invoiceProfitFigures(invoice,data.notes).finalProfit,475000);
 const statement=partyStatement(data.parties[0],data.invoices,data.transactions,'2026-11-01','2026-11-30',data.notes);assert.equal(statement.opening,675000);assert.deepEqual(statement.entries.map(row=>row.delta),[-600000,-75000]);assert.equal(statement.closing,0);
});
test('October profit stays unchanged; November discount reduces profit, and cash records only the receipt',()=>{
 const {backend,snapshot}=fixture();backend.post('create',makePartySettlement(snapshot(),form,id));const data=snapshot();
 assert.equal(businessFigures(data.invoices,[],data.transactions,['2026-10-01','2026-10-31']).grossProfit,475000);
 const november=businessFigures(data.invoices,[],data.transactions,['2026-11-01','2026-11-30']);assert.equal(november.grossProfit,-75000);assert.equal(november.settlementAdjustments,75000);assert.equal(november.collected,600000);assert.equal(november.operatingResult,-75000);assert.equal(november.sales,0);
 assert.equal(businessFigures(data.invoices,[],data.transactions,['2026-10-01','2026-11-30']).grossProfit,400000);assert.equal(paymentMethodBalance(data.transactions).Cash,1600000);
});
test('full payment has zero discount and requires no invoice or note',()=>{
 const {backend,snapshot}=fixture(true);const receipt=makePartySettlement(snapshot(),{...form,amount:'6750'},id);assert.equal(receipt.settlementDiscountMinor,0);assert.equal(backend.post('create',receipt).ok,true);assert.equal(snapshot().invoices.length,0);assert.equal(snapshot().notes.length,0);assert.equal(accountBalances(snapshot().parties,[],snapshot().transactions)[0].balance,0);
});
test('opening balances and multiple invoices are settled at party level',()=>{
 const opening=fixture(true);assert.equal(opening.backend.post('create',makePartySettlement(opening.snapshot(),form,id)).ok,true);
 const {backend,party,snapshot}=fixture();backend.post('createInvoice',makeInvoice({partyId:party.id,type:'sale',invoiceDate:'2026-11-01',notes:'',items:[{description:'Door',quantity:'1',rate:'5000',cost:'3000'}]},'settlement-invoice-000002'));
 const receipt=makePartySettlement(snapshot(),form,id);assert.equal(receipt.settlementDiscountMinor,575000);assert.equal(backend.post('create',receipt).ok,true);assert.equal(accountBalances(snapshot().parties,snapshot().invoices,snapshot().transactions)[0].balance,0);
});
test('only positive receivables qualify; decimals are exact and invalid payments are rejected',()=>{
 const {snapshot}=fixture(),quote=partySettlementQuote(snapshot(),form.partyId);
 assert.equal(settlementDiscount(quote,'6000.02'),74998);assert.equal(settlementDiscount(quote,'6750'),0);
 for(const value of ['','0','-1','6000.001','6750.01'])assert.throws(()=>settlementDiscount(quote,value));
 for(const patch of [{direction:'out'},{category:'Purchase'},{method:''},{partyId:''},{recordType:'transfer'}])assert.throws(()=>makePartySettlement(snapshot(),{...form,...patch},id));
 for(const opening of [-2000000,-675000]){const data=snapshot();data.parties[0].openingBalanceMinor=opening;assert.throws(()=>partySettlementQuote(data,form.partyId),/only when this party owes/);}
 const broken=snapshot();broken.transactions.push(broken.transactions[0]);assert.throws(()=>partySettlementQuote(broken,form.partyId),/unavailable/);
});
test('server rejects stale balances, tampering and invalid settlements before a receipt is written',()=>{
 const {backend,snapshot}=fixture(),receipt=makePartySettlement(snapshot(),form,id);
 for(const patch of [{settlementDiscountMinor:-1},{settlementDiscountMinor:750.5},{settlementDiscountMinor:75100},{_expectedPartyBalanceMinor:1},{partyId:''},{direction:'out'},{category:'Purchase'}]){assert.equal(backend.post('create',{...receipt,...patch}).ok,false);assert.equal(snapshot().transactions.length,1);}
 backend.post('create',makeTransaction({...form,amount:'100',dateTime:'2026-11-04T12:00'},'settlement-interim-000001'));assert.equal(backend.post('create',receipt).code,'EDIT_CONFLICT');assert.equal(snapshot().transactions.length,2);
});
test('editing a settlement recalculates the waiver, safely retries and cannot silently lose the discount',()=>{
 const {backend,snapshot}=fixture();backend.post('create',makePartySettlement(snapshot(),form,id));const saved=snapshot().transactions.find(row=>row.id===id);
 const updated={...makePartySettlement(snapshot(),{...form,amount:'6200'},id,saved),_editId:'settlement-edit-000000001',_expectedRevision:0};assert.equal(updated.settlementDiscountMinor,55000);assert.equal(backend.post('update',updated).ok,true);assert.equal(backend.post('update',updated).ok,true);assert.equal(accountBalances(snapshot().parties,snapshot().invoices,snapshot().transactions)[0].balance,0);
 const legacy={...makeTransaction({...form,amount:'6200'},id),_editId:'settlement-edit-000000002',_expectedRevision:1};assert.match(backend.post('update',legacy).error,/Update the app/);
 const remove={...legacy,settlementDiscountMinor:''};assert.equal(backend.post('update',remove).ok,true);assert.equal(accountBalances(snapshot().parties,snapshot().invoices,snapshot().transactions)[0].balance,55000);
});
test('delete and restore reverse/reinstate both payment and waiver, with no duplicate or orphan rows',()=>{
 const {backend,snapshot}=fixture();const receipt=makePartySettlement(snapshot(),form,id);backend.post('create',receipt);assert.equal(backend.post('create',{...receipt,settlementDiscountMinor:0}).ok,false);
 assert.equal(backend.post('delete',{id,_expectedRevision:0,reason:'Correction'}).ok,true);assert.equal(accountBalances(snapshot().parties,snapshot().invoices,snapshot().transactions)[0].balance,675000);assert.equal(businessFigures(snapshot().invoices,[],snapshot().transactions,['2026-11-01','2026-11-30']).grossProfit,0);
 const deleted=backend.post('listDeleted',{}).transactions.find(row=>row.id===id);assert.equal(backend.post('restore',{id,deletedAt:deleted.deletedAt,_expectedRevision:1}).ok,true);assert.equal(accountBalances(snapshot().parties,snapshot().invoices,snapshot().transactions)[0].balance,0);
});
test('an interrupted single receipt write cannot save either half, and retries preserve its ID',()=>{
 const {backend,snapshot}=fixture();const receipt=makePartySettlement(snapshot(),form,id);backend.failNext('Transactions');assert.equal(backend.post('create',receipt).ok,false);assert.equal(snapshot().transactions.length,1);assert.equal(backend.post('create',receipt).ok,true);assert.equal(snapshot().transactions.length,2);
});
test('normal entries remain unchanged, settlement drafts reset, invalid discounts never contribute profit or balance',()=>{
 assert.equal(newEntry({fullFinal:true}).fullFinal,false);assert.equal(hasDraft({...newEntry(),fullFinal:true}),true);
 const {backend,snapshot}=fixture();backend.post('create',makePartySettlement(snapshot(),form,id));const saved=snapshot().transactions.find(row=>row.id===id);assert.equal(editEntry(saved).fullFinal,true);assert.equal(editEntry(saved).cashReceived,'');assert.equal(hasSettlement(saved),true);assert.equal(transactionIntegrityIssue(saved),'');
 const invalid={...saved,settlementDiscountMinor:-1};assert.match(transactionIntegrityIssue(invalid),/invalid party settlement/);assert.equal(businessFigures([],[],[invalid],['2026-11-01','2026-11-30']).settlementAdjustments,0);assert.equal(accountBalances(snapshot().parties,[],[invalid])[0].balance,null);
});

test('legacy invoice settlement notes stay intact and are never discounted a second time',()=>{
 const {backend,invoice,snapshot}=fixture();const legacy=makeInvoiceNote({type:'credit',effect:'price',amount:'750',noteDate:'2026-11-05',reason:'Earlier settlement'},invoice,'settlement-legacy-note-01');assert.equal(backend.post('createInvoiceNote',legacy).ok,true);
 const before=JSON.stringify(backend.tabs.get('InvoiceNotes').data),receipt=makePartySettlement(snapshot(),form,id);assert.equal(receipt.settlementDiscountMinor,0);assert.equal(backend.post('create',receipt).ok,true);assert.equal(JSON.stringify(backend.tabs.get('InvoiceNotes').data),before);
 const data=snapshot();assert.equal(accountBalances(data.parties,data.invoices,data.transactions,data.notes)[0].balance,0);assert.equal(businessFigures(data.invoices,data.notes,data.transactions,['2026-11-01','2026-11-30']).grossProfit,-75000);assert.equal(invoiceProfitFigures(invoice,data.notes).finalProfit,400000);
});
