import test from 'node:test';
import assert from 'node:assert/strict';
import {accountBackend} from './helpers/accountBackend.js';
import {blankInvoice,blankItem,makeInvoice,makeParty,accountBalances} from '../src/accounts.js';

test('120 varied purchases and sales preserve totals, rounding, signed KG rows and idempotent retries',()=>{
 const backend=accountBackend(),partyId='sample-party-00000000001';
 assert.equal(backend.post('createParty',makeParty({name:'Sample supplier/customer',phone:'',address:'',openingDate:'2026-01-01',openingBalance:'0'},partyId)).ok,true);
 let expectedBalance=0;
 for(let index=0;index<120;index++){
  const unit=['nos','box','kg','sqft','rft'][index%5],type=index%2?'sale':'purchase';
  const item={...blankItem(),description:'Sample '+index,billingUnit:unit,rate:(123.45+index).toFixed(2),cost:'70.01',quantity:'3',discount:'0'};
  if(unit==='kg')Object.assign(item,{grouped:true,measurements:[{description:'Received',quantity:'3.125',pieces:'2'},{description:'Returned',quantity:'-1.001',pieces:'1'}]});
  if(['sqft','rft'].includes(unit))Object.assign(item,{grouped:true,measurementUnit:index%3?'inches':'feet',measurementMode:unit==='rft'&&index%3?'perimeter':'dimensions',measurements:[{description:'Panel',length:'12.125',width:'7.375',pieces:'3'}]});
  const draft={...blankInvoice(),partyId,type,invoiceDate:'2026-10-27',autoRoundOff:index%3===0,discountMode:index%4?'amount':'percent',discount:index%4?'1.01':'7.25',amountOnly:type==='purchase'&&index%6===0,purchaseAmount:(100+index+.49).toFixed(2),items:[item]};
  const payload=makeInvoice(draft,'sample-invoice-'+String(index).padStart(8,'0'));
  const response=backend.post('createInvoice',payload);assert.equal(response.ok,true,`Sample ${index}: ${response.error}`);
  for(const key of ['totalMinor','costTotalMinor','invoiceDiscountMinor','roundOffMinor','amountOnly'])assert.equal(response.record[key],payload[key],`Sample ${index}: ${key}`);
  assert.equal(Number.isSafeInteger(response.record.totalMinor),true);
  if(draft.autoRoundOff)assert.equal(response.record.totalMinor%100,0);
  if(unit==='kg'&&!draft.amountOnly)assert.equal(response.record.items[0].quantityMilli,5249);
  assert.equal(backend.post('createInvoice',payload).ok,true);
  expectedBalance+=(type==='sale'?1:-1)*payload.totalMinor;
 }
 const snapshot=backend.post('listAccounts',{});assert.equal(snapshot.invoices.length,120);assert.equal(snapshot.transactions.length,0);
 assert.equal(accountBalances(snapshot.parties,snapshot.invoices,snapshot.transactions,snapshot.notes)[0].balance,expectedBalance);
});
