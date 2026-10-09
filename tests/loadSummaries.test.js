import test from 'node:test';
import assert from 'node:assert/strict';
import {accountBackend} from './helpers/accountBackend.js';
import {makeParty,makeInvoice} from '../src/accounts.js';

test('dashboard summary matches full stock balances and omits history and invoice details',()=>{
 const b=accountBackend();
 const party=makeParty({name:'Summary customer',phone:'',address:'',openingDate:'2026-01-01',openingBalance:'0'},'summary-party-00000001');assert.equal(b.post('createParty',party).ok,true);
 const invoice=b.post('createInvoice',makeInvoice({partyId:party.id,type:'sale',invoiceDate:'2026-10-08',notes:'',items:[{description:'WINDOW',quantity:'1',rate:'350',cost:'100'}]},'summary-invoice-0000001')).record;
 const item={id:'summary-stock-item0001',name:'SCREW',baseUnit:'PCS',secondaryUnit:'BOX',conversion:'100',quantity:'1.5',importUnit:'BOX',saleRateMinor:500,purchaseRateMinor:200,purchaseRateUnit:'PCS',saleRateUnit:'PCS',lowStock:'5'};
 assert.equal(b.post('importStock',{id:'summary-opening-000001',openingDate:'2026-01-01',items:[item]}).ok,true);
 assert.equal(b.post('reviewInvoiceStock',{id:'summary-review-0000001',stockMovementSchemaVersion:1,reviewMode:'invoice',invoiceId:invoice.id,invoiceRevision:0,invoiceType:'sale',movementDate:'2026-10-08',reason:'Used stock',movements:[{stockItemId:item.id,quantity:'0.1',unit:'BOX',expectedRevision:0}]}).ok,true);
 const full=b.post('listStock',{});b.calls.length=0;
 const result=b.post('listAccounts',{summary:true,includeStockSummary:true});assert.equal(result.ok,true,result.error);
 assert.deepEqual(result.stockSummary.items,full.items);assert.equal(result.stockSummary.items[0].balance,'140');assert.equal(result.stockSummary.openingDate,full.openingDate);
 assert.equal(result.stockSummary._summary,true);assert.equal(result.stockSummary.movements.length,0);assert.equal(result.stockSummary.reviews.length,0);assert.equal(result.invoices[0].items,undefined);
 assert.deepEqual(result.stockSummary.operations.map(op=>op.id),full.operations.map(op=>op.id));assert.ok(result.stockSummary.operations.every(op=>Object.keys(op).length===1));
 assert.ok(!b.calls.some(call=>call.operation==='read'&&call.name==='StockReviews'));
 const legacy=b.post('listAccounts',{summary:true});assert.equal(legacy.stockSummary,undefined);
});

test('broken stock data cannot prevent loading the financial ledger',()=>{
 const b=accountBackend();const opened=b.post('importStock',{id:'broken-summary-opening01',openingDate:'2026-01-01',items:[{id:'broken-summary-stock001',name:'SCREW',baseUnit:'PCS',quantity:'10',importUnit:'PCS',secondaryUnit:'',conversion:'1',lowStock:'',saleRateUnit:'PCS',purchaseRateUnit:'PCS',saleRateMinor:0,purchaseRateMinor:0}]});assert.equal(opened.ok,true,opened.error);
 const movements=b.tabs.get('StockMovements'),headers=movements.data[0];movements.data[1][headers.indexOf('baseQuantity')]='invalid';
 const result=b.post('listAccounts',{summary:true,includeStockSummary:true});assert.equal(result.ok,true);assert.equal(typeof result.stockSummaryError,'string');assert.equal(result.stockSummary,undefined);assert.ok(Array.isArray(result.transactions));
});
