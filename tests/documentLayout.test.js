import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceImageDocument,ledgerImageDocument,paymentMessage,noteMessage} from '../src/documentLayout.js';
import {makeInvoice,blankInvoice} from '../src/accounts.js';
import {invoiceMessage} from '../src/invoiceMessage.js';
const preferences={shopName:'Royal',printContact:true,address:'Shop address',phone:'123'};
const invoice={...makeInvoice({...blankInvoice(),walkIn:true,invoiceDate:'2026-10-07',challanNumber:'DC-1',items:[{description:'WINDOW',quantity:'1',rate:'350',cost:'100',discount:'0'}]},'document-test-invoice001'),partyName:'CASH SALE',invoiceNumber:'RF-S-000001',notes:'INTERNAL NOTE',status:'issued'};
test('invoice messages are concise and table images retain document structure without CP or internal notes',()=>{
 const message=invoiceMessage({...invoice,walkIn:false},preferences,{partyBalance:35000});assert.match(message,/WINDOW/);assert.match(message,/Challan: DC-1/);assert.match(message,/Current party balance/);assert.ok(message.split('\n').length<12);
 const document=invoiceImageDocument(invoice,preferences);assert.deepEqual(document.columns.map(row=>row[0]),['Item','Quantity','Rate','Amount']);assert.equal(document.rows[0][0],'WINDOW');assert.equal(document.totals.find(row=>row[0]==='Invoice total')[1],'₹350.00');assert.doesNotMatch(JSON.stringify(document),/CP|profit|INTERNAL NOTE|₹100/);
});
test('ledger image contains chronological debit-credit-balance columns and public detailed invoice lines',()=>{
 const doc=ledgerImageDocument({party:{name:'Ali',phone:'123'},range:['2026-10-01','2026-10-31'],detailed:true,statement:{opening:0,closing:35000,entries:[{date:'2026-10-07',description:'RF-S-000001',delta:35000,balance:35000,invoice}]}},preferences);assert.deepEqual(doc.columns.map(row=>row[0]),['Date','Particulars','Debit','Credit','Balance']);assert.equal(doc.rows.length,2);assert.equal(doc.rows[0][2],'₹350.00');assert.match(doc.rows[1][1],/WINDOW/);assert.doesNotMatch(JSON.stringify(doc),/INTERNAL NOTE|costMinor/);
});
test('payment and correction messages include their type, amount and party balance without private payment notes',()=>{
 const receipt=paymentMessage({party:'Ali',partyId:'party',direction:'out',recordType:'payment',transactionDate:'2026-10-07',category:'Purchase',method:'Cash',amountMinor:10000,notes:'PRIVATE'},preferences,-5000);assert.match(receipt,/Payment made/);assert.match(receipt,/₹100.00/);assert.match(receipt,/₹50.00 to pay/);assert.doesNotMatch(receipt,/PRIVATE/);
 assert.match(noteMessage({type:'credit',noteNumber:'RF-CN-000001',partyName:'Ali',noteDate:'2026-10-07',invoiceNumber:'RF-S-000001',amountMinor:2000,reason:'Return'},preferences,0),/Credit note/);
});
