import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeInvoice,makeParty,invoiceDraftFromRecord,historyInvoices} from '../src/accounts.js';
import {billingPreview,billingQuantity_,billingPrice_,quantityText,blankMeasurement} from '../src/measurements.js';
import {accountBackend} from './helpers/accountBackend.js';
import {readInvoiceDraft,invoiceDraftKey} from '../src/invoiceDraft.js';
const party=makeParty({name:'Measured client',phone:'',address:'',openingDate:'2026-01-01',openingBalance:'0'},'party-measure-00000000001');
const id='invoice-measure-00000001';
const row=(length,width,pieces='1',description='')=>({...blankMeasurement(),length,width,pieces,description});
const item=(changes={})=>({description:'3 Track Window',quantity:'1',rate:'350',discount:'0',cost:'200',billingUnit:'sqft',measurementUnit:'inches',measurementMode:'dimensions',measurements:[row('36','36')],...changes});
const draft=items=>({partyId:party.id,type:'sale',invoiceDate:'2026-10-01',notes:'',items});
function fixture(){const backend=accountBackend();backend.post('createParty',party);return backend;}
function create(backend,items){const payload=makeInvoice(draft(items),id);const result=backend.post('createInvoice',payload);assert.equal(result.ok,true,result.error);return {payload,record:result.record};}
test('browser and Sheet backend use identical quantity and rounding calculations',()=>{
 const backend=fixture();
 assert.equal(backend.context.billingQuantity_.toString(),billingQuantity_.toString());
 assert.equal(backend.context.billingPrice_.toString(),billingPrice_.toString());
});
test('Apps Script source avoids the BigInt literals rejected by its editor parser',()=>{
 const source=readFileSync(new URL('../google-apps-script/Code.gs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/\b\d+n\b/);
});

test('feet/inches produce the same square-foot value; grouped rows use full precision before final paise rounding',()=>{
 const inches=makeInvoice(draft([item()]),id),feet=makeInvoice(draft([item({measurementUnit:'feet',measurements:[row('3','3')]})]),id);
 assert.equal(inches.totalMinor,315000);assert.equal(feet.totalMinor,inches.totalMinor);assert.equal(inches.costTotalMinor,180000);
 const grouped=makeInvoice(draft([item({measurements:[row('36','36','2','Bedroom'),row('48','34'),row('60','48','2')]})]),id);
 assert.equal(grouped.items[0].quantityMilli,69333);assert.equal(grouped.totalMinor,2426667);assert.equal(grouped.costTotalMinor,1386667);assert.equal(quantityText(grouped.items[0]),'69.3333 SQ. FT.');
 const backend=fixture(),result=backend.post('createInvoice',grouped);assert.equal(result.ok,true,result.error);assert.equal(result.record.totalMinor,grouped.totalMinor);assert.equal(backend.tabs.get('InvoiceMeasurements').data.length,4);
 assert.equal(backend.calls.filter(call=>call.name==='InvoiceMeasurements'&&call.operation==='write'&&call.r>1).length,1);
 assert.match(backend.post('listAccounts',{summary:true}).invoices[0].itemSearch,/Bedroom/);
 assert.equal(historyInvoices([result.record],'2026-01-01','2026-12-31','','bedroom').length,1);
});
test('running-foot lengths/perimeters, grouped weights and Nos share the same quantity and price rules',()=>{
 const backend=fixture();
 for(const [changes,quantity,amount] of [
  [{billingUnit:'rft',measurements:[row('36','','2')]},6,210000],
  [{billingUnit:'rft',measurementUnit:'feet',measurementMode:'perimeter',measurements:[row('3','4','2')]},28,980000],
  [{billingUnit:'kg',measurementMode:'quantity',quantity:'2.5',measurements:[],rate:'200'},2.5,50000],
  [{billingUnit:'kg',measurementMode:'quantity',measurements:[{...row('',''),quantity:'2.5',pieces:'2'},{...row('',''),quantity:'1.25'}],rate:'200'},6.25,125000],
  [{billingUnit:'nos',measurementMode:'quantity',quantity:'5',measurements:[]},5,175000]
 ]){
  const model=item(changes),payload=makeInvoice(draft([model]),id);assert.equal(payload.items[0].quantityMilli,quantity*1000);assert.equal(payload.totalMinor,amount);
  const server=backend.context.normalizedInvoice_(payload,true);assert.equal(server.totalMinor,amount);assert.equal(server.items[0].lineCostMinor,payload.items[0].lineCostMinor);
 }
});
test('dimension billing rounds only the final group, preserves explicit zero cost and rejects invalid/oversized inputs',()=>{
 const model=item({measurements:[row('1','1'),row('1','1')],rate:'1',cost:'0'}),payload=makeInvoice(draft([model]),id);assert.equal(payload.totalMinor,1);assert.equal(payload.costTotalMinor,0);
 for(const change of [{measurements:[]},{measurements:[row('0','36')]},{measurements:[row('1.0001','36')]},{measurements:[row('36','36','1.5')]},{measurementUnit:'cm'},{billingUnit:'unsupported'},{measurements:Array(101).fill(row('1','1'))},{measurements:[row('1000000','1000000')]}])assert.throws(()=>makeInvoice(draft([item(change)]),id));
 assert.throws(()=>makeInvoice(draft([item({discount:'4000'})]),id),/discount/);
 const tiny=item({measurementUnit:'feet',measurements:[row('0.001','0.001')],rate:'100000000',cost:'0'});assert.equal(makeInvoice(draft([tiny]),id).totalMinor,10000);
 assert.equal(quantityText(makeInvoice(draft([tiny]),id).items[0]),'<0.0001 SQ. FT.');
 const value=billingPreview(model);assert.equal(billingPrice_(100,value),1);
});
test('server recomputes totals, rejects changed quantity/count and refuses damaged saved measurement rows',()=>{
 const backend=fixture(),payload=makeInvoice(draft([item()]),id);
 assert.equal(backend.post('createInvoice',{...payload,items:[{...payload.items[0],quantityMilli:1}]}).ok,false);
 assert.equal(backend.post('createInvoice',{...payload,items:[{...payload.items[0],measurementCount:2}]}).ok,false);
 const result=backend.post('createInvoice',{...payload,totalMinor:1,costTotalMinor:1});assert.equal(result.ok,true);assert.equal(result.record.totalMinor,315000);
 const tab=backend.tabs.get('InvoiceMeasurements');tab.data[1][tab.data[0].indexOf('lengthMilli')]=0;
 assert.equal(backend.post('getInvoices',{ids:[id]}).ok,false);assert.equal(backend.post('listAccounts',{summary:true}).ok,false);
});
test('interrupted measurement/header writes retry without duplicate rows; changed measurement retries are refused',()=>{
 const backend=fixture(),payload=makeInvoice(draft([item()]),id);backend.failNext('InvoiceMeasurements');assert.equal(backend.post('createInvoice',payload).ok,false);assert.equal(backend.post('listAccounts',{}).invoices.length,0);
 backend.failNext('Invoices');assert.equal(backend.post('createInvoice',payload).ok,false);assert.equal(backend.post('listAccounts',{}).invoices.length,0);
 assert.equal(backend.post('createInvoice',payload).ok,true);assert.equal(backend.post('createInvoice',payload).ok,true);assert.equal(backend.tabs.get('InvoiceMeasurements').data.length,2);
 const changed=makeInvoice(draft([item({measurements:[row('18','72')]})]),id);assert.equal(changed.totalMinor,payload.totalMinor);assert.equal(backend.post('createInvoice',changed).ok,false);
});
test('edits retain versioned measurements and snapshots, recover partial staging and preserve the original create retry',()=>{
 const backend=fixture(),{payload,record}=create(backend,[item()]);const previousRows=JSON.stringify(backend.tabs.get('InvoiceMeasurements').data);
 const editing=invoiceDraftFromRecord(record);assert.equal(editing.items[0].measurements[0].length,'36');editing.items[0].measurements.push(row('48','34'));
 const change={...makeInvoice(editing,id),invoiceNumber:record.invoiceNumber,_expectedRevision:0,_editId:'edit-measure-000000000001'};
 backend.failNext('InvoiceMeasurements');assert.equal(backend.post('updateInvoice',change).ok,false);assert.equal(backend.post('listAccounts',{}).invoices[0].totalMinor,315000);
 backend.failNext('Invoices');assert.equal(backend.post('updateInvoice',change).ok,false);assert.equal(backend.post('listAccounts',{}).invoices[0].totalMinor,315000);
 const result=backend.post('updateInvoice',change);assert.equal(result.ok,true,result.error);assert.equal(result.record.items[0].measurements.length,2);assert.equal(result.record.totalMinor,711667);assert.equal(backend.post('updateInvoice',change).ok,true);
 const rows=backend.tabs.get('InvoiceMeasurements').data;assert.equal(rows.length,4);assert.equal(JSON.stringify(rows.slice(0,2)),previousRows);
 const snapshot=JSON.parse(backend.tabs.get('InvoiceHistory').data[1].at(-1));assert.equal(snapshot.items[0].measurements.length,1);
 assert.equal(backend.post('createInvoice',payload).record.totalMinor,711667);
});
test('older clients cannot silently strip measured quantities during edits; upgraded clients can explicitly change units',()=>{
 const backend=fixture(),{record}=create(backend,[item()]);
 const editing=invoiceDraftFromRecord(record);editing.items=[{description:'Changed to quantity',quantity:'2',rate:'100',cost:'',discount:'0'}];
 const change={...makeInvoice(editing,id),invoiceNumber:record.invoiceNumber,_expectedRevision:0,_editId:'edit-unit-00000000000001'};
 const oldClient={...change};delete oldClient.measurementSchemaVersion;
 assert.match(backend.post('updateInvoice',oldClient).error,/Update the app/);
 assert.equal(backend.post('getInvoices',{ids:[id]}).invoices[0].items[0].billingUnit,'sqft');
 assert.equal(backend.post('updateInvoice',change).ok,true);
 assert.equal(backend.tabs.get('InvoiceMeasurements').data.length,2);
});
test('measured purchase costs remain absent and total measurement rows are bounded',()=>{
 const backend=fixture(),payload=makeInvoice({...draft([item()]),type:'purchase'},id);
 assert.equal(payload.costTotalMinor,null);assert.equal(payload.items[0].lineCostMinor,null);
 const result=backend.post('createInvoice',payload);assert.equal(result.ok,true,result.error);assert.equal(result.record.totalMinor,315000);
 const groups=Array.from({length:11},()=>item({measurements:Array.from({length:100},()=>row('1','1'))}));
 assert.throws(()=>makeInvoice(draft(groups),id),/1,000 measurement/);
});
test('legacy invoices remain readable without new columns; measured drafts survive storage and corruption is recoverable',()=>{
 const backend=fixture();const old={description:'Old quantity',quantity:'2.5',rate:'10',discount:'0',cost:''};const {record}=create(backend,[old]);
 const tab=backend.tabs.get('InvoiceItems');for(const key of ['billingUnit','measurementUnit','measurementMode','measurementCount','itemNote']){const column=tab.data[0].indexOf(key);tab.data.forEach(row=>row.splice(column,1));}
 backend.tabs.delete('InvoiceMeasurements');assert.equal(backend.post('listAccounts',{}).invoices[0].totalMinor,2500);assert.equal(quantityText(record.items[0]),'2.5');
 const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};storage.setItem(invoiceDraftKey('test'),JSON.stringify(draft([item()])));assert.equal(readInvoiceDraft(storage,'test').draft.items[0].measurements[0].length,'36');
 storage.setItem(invoiceDraftKey('test'),JSON.stringify(draft([item({measurements:[null]})])));assert.ok(readInvoiceDraft(storage,'test').error);assert.ok(values.has(invoiceDraftKey('test')+'.recovery'));
});
test('grouping choice survives draft recovery and existing grouped records reopen safely',()=>{
 const storage={value:'',getItem(){return this.value;},setItem(key,value){this.value=value;}};
 storage.value=JSON.stringify(draft([item({grouped:true})]));assert.equal(readInvoiceDraft(storage,'test').draft.items[0].grouped,true);
 storage.value=JSON.stringify(draft([item({grouped:false})]));assert.equal(readInvoiceDraft(storage,'test').draft.items[0].grouped,false);
 const backend=fixture(),{record}=create(backend,[item({measurements:[row('36','36'),row('48','34')]})]);assert.equal(invoiceDraftFromRecord(record).items[0].grouped,true);
 storage.value=JSON.stringify(draft([item({grouped:'false'})]));assert.ok(readInvoiceDraft(storage,'test').error);
});
test('older inconsistent grouping drafts reveal every row and empty groups restore an editable quantity',()=>{
 const storage={getItem:()=>JSON.stringify(draft([item({grouped:false,measurements:[row('36','36'),row('48','34')]})]))};
 assert.equal(readInvoiceDraft(storage,'test').draft.items[0].grouped,true);
 storage.getItem=()=>JSON.stringify(draft([item({billingUnit:'kg',measurementMode:'quantity',grouped:true,quantity:'2.5',measurements:[]})]));
 const recovered=readInvoiceDraft(storage,'test').draft.items[0];assert.equal(recovered.measurements[0].quantity,'2.5');assert.equal(recovered.grouped,true);
 assert.equal(makeInvoice(draft([recovered]),id).items[0].quantityMilli,2500);
});
test('measurement ID collisions with a different item are rejected before an invoice header commits',()=>{
 const backend=fixture(),payload=makeInvoice(draft([item()]),id);backend.failNext('Invoices');assert.equal(backend.post('createInvoice',payload).ok,false);
 const tab=backend.tabs.get('InvoiceMeasurements');tab.data[1][tab.data[0].indexOf('itemId')]='unrelated-item-000000001';
 const result=backend.post('createInvoice',payload);assert.equal(result.ok,false);assert.match(result.error,/measurement ID belongs to different/);
 assert.equal(backend.tabs.get('Invoices').data.length,1);
});
test('maximum-size measured invoices batch 1,000 rows, retain precise totals and retry safely',()=>{
 const backend=fixture(),models=Array.from({length:10},()=>item({measurements:Array.from({length:100},()=>row('1','1'))}));
 const payload=makeInvoice(draft(models),id);assert.equal(payload.totalMinor,243060);
 const result=backend.post('createInvoice',payload);assert.equal(result.ok,true,result.error);assert.equal(result.record.totalMinor,payload.totalMinor);
 assert.equal(backend.tabs.get('InvoiceMeasurements').data.length,1001);assert.equal(backend.calls.filter(call=>call.name==='InvoiceMeasurements'&&call.operation==='write'&&call.r>1).length,1);
 assert.equal(backend.post('createInvoice',payload).ok,true);assert.equal(backend.tabs.get('InvoiceMeasurements').data.length,1001);
});
test('optional item descriptions survive saving, search, drafts and versioned edits without changing invoice values',()=>{
 const backend=fixture(),{payload,record}=create(backend,[item({itemNote:' White aluminium with mesh '})]);
 assert.equal(record.items[0].itemNote,'White aluminium with mesh');assert.equal(record.totalMinor,315000);
 assert.match(backend.post('listAccounts',{summary:true}).invoices[0].itemSearch,/White aluminium with mesh/);
 assert.equal(historyInvoices([record],'2026-01-01','2026-12-31','','mesh').length,1);
 const editing=invoiceDraftFromRecord(record);assert.equal(editing.items[0].itemNote,'White aluminium with mesh');editing.items[0].itemNote='Brown powder coating';
 const storage={getItem:()=>JSON.stringify(editing)};assert.equal(readInvoiceDraft(storage,'test').draft.items[0].itemNote,'Brown powder coating');
 const change={...makeInvoice(editing,id),invoiceNumber:record.invoiceNumber,_expectedRevision:0,_editId:'edit-description-00000001'};
 const oldClient={...change};delete oldClient.itemDescriptionSchemaVersion;assert.match(backend.post('updateInvoice',oldClient).error,/Update the app/);
 const result=backend.post('updateInvoice',change);assert.equal(result.ok,true,result.error);assert.equal(result.record.items[0].itemNote,'Brown powder coating');assert.equal(result.record.totalMinor,315000);
 assert.equal(backend.post('updateInvoice',change).ok,true);assert.equal(backend.post('createInvoice',payload).record.items[0].itemNote,'Brown powder coating');
 const snapshot=JSON.parse(backend.tabs.get('InvoiceHistory').data[1].at(-1));assert.equal(snapshot.items[0].itemNote,'White aluminium with mesh');
 assert.throws(()=>makeInvoice(draft([item({itemNote:'x'.repeat(501)})]),id),/500 characters/);
 assert.equal(backend.post('createInvoice',{...payload,id:'invoice-description-0002',items:[{...payload.items[0],id:'invoice-description-0002-1',invoiceId:'invoice-description-0002',itemNote:55}]}).ok,false);
});
