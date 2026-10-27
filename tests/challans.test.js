import test from 'node:test';
import assert from 'node:assert/strict';
import {challanBackend} from './helpers/challanBackend.js';
import {blankInvoice,blankItem,makeInvoice,invoiceDraftFromRecord,accountBalances} from '../src/accounts.js';
import {stockInvoiceStatus} from '../src/stock.js';
import {photoDeletionDate} from '../src/challans.js';
import {readInvoiceDraft} from '../src/invoiceDraft.js';
const challanId='challan-capture-000000001',partyId='challan-party-0000000001',invoiceId='challan-purchase-0000001';
const jpeg=Buffer.from([255,216,255,224,0,16,74,70,73,70,255,217]).toString('base64');
const photo=(number=1)=>({id:'challan-photo-000000000'+number,challanId,name:'Page '+number+'.jpg',mimeType:'image/jpeg',data:jpeg});
function capture(b,autoDelete=false){assert.equal(b.post('createChallan',{id:challanId,name:'Supplier challan',autoDelete}).ok,true);for(const number of [1,2]){const result=b.post('uploadChallanPhoto',photo(number));assert.equal(result.ok,true,result.error);}return b.post('listChallans',{}).challans[0];}
function purchase(b,extra={}){
 assert.equal(b.post('createParty',{id:partyId,schemaVersion:1,name:'SUPPLIER',phone:'',address:'',openingDate:'2026-01-01',openingBalanceMinor:0}).ok,true);
 const draft={...blankInvoice(),type:'purchase',partyId,sourceChallanId:challanId,amountOnly:true,purchaseAmount:'4700',...extra};
 return makeInvoice(draft,invoiceId);
}
function itemizedPurchase(b){return purchase(b,{amountOnly:false,items:[{...blankItem(),description:'PLY',quantity:'1',rate:'4700'}]});}
test('private multi-page captures are authorized, idempotent and resumable after a Sheet write fails',()=>{
 const b=challanBackend();assert.equal(b.triggers.length,1);b.context.setupChallanStorage();assert.equal(b.triggers.length,1);assert.equal(b.folders.size,1);
 assert.equal(b.rawPost({action:'getChallanPhoto',transaction:{id:photo().id,challanId}}).code,'UNAUTHORIZED');
 assert.equal(b.post('createChallan',{id:challanId,name:'Supplier challan',autoDelete:false}).ok,true);
 b.failNext('ChallanPhotos');assert.equal(b.post('uploadChallanPhoto',photo()).ok,false);assert.equal(b.files.size,1);
 assert.equal(b.post('uploadChallanPhoto',photo()).ok,true);assert.equal(b.files.size,1);assert.equal(b.post('uploadChallanPhoto',photo()).ok,true);assert.equal(b.files.size,1);
 assert.equal(b.post('uploadChallanPhoto',photo(2)).ok,true);const list=b.post('listChallans',{});assert.equal(list.challans[0].photos.length,2);assert.equal(list.challans[0].autoDelete,false);assert.equal(list.challans[0].completedAt,'');
 assert.equal(b.post('getChallanPhoto',{id:photo().id,challanId}).data,jpeg);assert.equal(b.post('getChallanPhoto',{id:photo().id,challanId:'other-challan-0000000001'}).ok,false);
 assert.equal(b.post('uploadChallanPhoto',{...photo(),name:'Changed retry.jpg'}).ok,false);assert.equal(b.post('uploadChallanPhoto',{...photo(3),data:'not-an-image'}).ok,false);
});
test('amount-only purchases affect balances, preserve challan links, skip catalogue/stock and survive retry/edit',()=>{
 const b=challanBackend();capture(b);const payload=purchase(b),saved=b.post('createInvoice',payload);assert.equal(saved.ok,true,saved.error);assert.equal(saved.record.totalMinor,470000);assert.equal(saved.record.amountOnly,true);assert.equal(saved.record.sourceChallanId,challanId);assert.equal(saved.catalogue.length,0);
 const challan=b.post('listChallans',{}).challans[0];assert.equal(challan.invoiceId,invoiceId);assert.equal(challan.completedAt,saved.record.createdAt);assert.equal(stockInvoiceStatus(saved.record,[],[]),'No stock impact');
 assert.equal(b.post('createInvoice',payload).ok,true);assert.equal(b.post('createInvoice',makeInvoice({...blankInvoice(),partyId,type:'purchase',sourceChallanId:challanId,amountOnly:true,purchaseAmount:'10'},'challan-second-invoice01')).ok,false);
 const records=b.post('listAccounts',{});assert.equal(records.transactions.length,0);assert.equal(accountBalances(records.parties,records.invoices,[],[])[0].balance,-470000);assert.equal(b.post('listStock',{}).movements.length,0);
 const draft=invoiceDraftFromRecord(saved.record);assert.equal(draft.amountOnly,true);assert.equal(draft.purchaseAmount,'4700');draft.purchaseAmount='4800';
 const edit={...makeInvoice(draft,invoiceId),invoiceNumber:saved.record.invoiceNumber,_editId:'challan-invoice-edit0001',_expectedRevision:0};const updated=b.post('updateInvoice',edit);assert.equal(updated.ok,true,updated.error);assert.equal(updated.record.totalMinor,480000);assert.equal(updated.record.sourceChallanId,challanId);assert.equal(b.post('listChallans',{}).challans[0].completedAt,challan.completedAt);
 const restored=readInvoiceDraft({getItem:()=>JSON.stringify(draft)},'endpoint').draft;assert.equal(restored.amountOnly,true);assert.equal(restored.sourceChallanId,challanId);assert.equal(makeInvoice(restored,invoiceId).totalMinor,480000);
});
test('completion metadata failures do not reject a committed invoice; reconciliation keeps its original completion time',()=>{
 const b=challanBackend();capture(b,true);const payload=purchase(b);b.failNext('PurchaseChallans');const saved=b.post('createInvoice',payload);assert.equal(saved.ok,true,saved.error);assert.match(saved.challanWarning,/invoice saved/i);
 b.setNow('2026-10-27T12:00:00Z');const row=b.post('listChallans',{}).challans[0];assert.equal(row.completedAt,saved.record.createdAt);assert.equal(row.invoiceId,invoiceId);assert.equal(b.post('createInvoice',payload).ok,true);
});
test('cleanup requires explicit checkbox and 30 elapsed days after confirmed completion; unfinished photos are kept',()=>{
 for(const autoDelete of [false,true]){
  const b=challanBackend();capture(b,autoDelete);b.setNow('2027-01-01T00:00:00Z');b.context.cleanupChallanPhotos();assert.ok([...b.files.values()].every(file=>!file.trashed));
  const saved=b.post('createInvoice',itemizedPurchase(b));assert.equal(saved.ok,true,saved.error);const completed=b.post('listChallans',{}).challans[0];
  assert.equal(Boolean(photoDeletionDate(completed)),autoDelete);
  b.setNow('2027-01-30T23:59:59Z');b.context.cleanupChallanPhotos();assert.ok([...b.files.values()].every(file=>!file.trashed));
  b.setNow('2027-01-31T00:00:00Z');b.context.cleanupChallanPhotos();assert.equal([...b.files.values()].every(file=>file.trashed),autoDelete);
  const current=b.post('listChallans',{}).challans[0];assert.equal(Boolean(current.photosDeletedAt),autoDelete);assert.equal(b.post('listAccounts',{}).invoices[0].totalMinor,470000);assert.equal(b.post('createInvoice',itemizedPurchase(b)).ok,true);
 }
});
test('turning retention off prevents deletion and turning it on uses the existing completion date',()=>{
 const b=challanBackend();capture(b,true);assert.equal(b.post('createInvoice',itemizedPurchase(b)).ok,true);
 let row=b.post('listChallans',{}).challans[0];const completed=row.completedAt;
 const off={id:row.id,autoDelete:false,_expectedRevision:row.revision,_editId:'challan-retention-off001'};assert.equal(b.post('updateChallanRetention',off).ok,true);assert.equal(b.post('updateChallanRetention',off).ok,true);
 b.setNow('2027-01-01T00:00:00Z');b.context.cleanupChallanPhotos();assert.ok([...b.files.values()].every(file=>!file.trashed));row=b.post('listChallans',{}).challans[0];assert.equal(row.completedAt,completed);
 assert.equal(b.post('updateChallanRetention',{id:row.id,autoDelete:true,_expectedRevision:row.revision,_editId:'challan-retention-on0001'}).ok,true);b.context.cleanupChallanPhotos();assert.ok([...b.files.values()].every(file=>file.trashed));assert.equal(b.post('getChallanPhoto',{id:photo().id,challanId}).ok,false);
});
test('amount-only is purchase-only and rejects forged item details',()=>{
 assert.throws(()=>makeInvoice({...blankInvoice(),partyId,amountOnly:true,purchaseAmount:'100'},invoiceId),/purchase/);
 const b=challanBackend();const payload=purchase(b,{sourceChallanId:''});payload.items[0].description='FAKE STOCK';assert.equal(b.post('createInvoice',payload).ok,false);
});

test('private photo reads do not wait for the financial write lock and changed Drive ownership is rejected',()=>{
 const b=challanBackend();capture(b);
 b.context.LockService={getScriptLock:()=>({waitLock(){throw new Error('Financial write in progress');},hasLock:()=>false,releaseLock(){}})};
 assert.equal(b.post('getChallanPhoto',{id:photo().id,challanId}).ok,true);
 const file=[...b.files.values()][0];file.parent='unrelated-folder';assert.equal(b.post('getChallanPhoto',{id:photo().id,challanId}).ok,false);
});
test('interrupted cleanup resumes safely and a changed Drive file cannot be deleted',()=>{
 const b=challanBackend();capture(b,true);assert.equal(b.post('createInvoice',itemizedPurchase(b)).ok,true);b.setNow('2027-01-01T00:00:00Z');
 b.failNext('ChallanPhotos');b.context.cleanupChallanPhotos();assert.equal(b.post('listChallans',{}).challans[0].photosDeletedAt,'');assert.equal([...b.files.values()].filter(file=>file.trashed).length,1);
 b.context.cleanupChallanPhotos();assert.ok([...b.files.values()].every(file=>file.trashed));assert.ok(b.post('listChallans',{}).challans[0].photosDeletedAt);
 const other=challanBackend();capture(other,true);assert.equal(other.post('createInvoice',itemizedPurchase(other)).ok,true);other.setNow('2027-01-01T00:00:00Z');[...other.files.values()][0].parent='unrelated-folder';other.context.cleanupChallanPhotos();assert.ok([...other.files.values()].every(file=>!file.trashed));
});
test('photo size limit is separate from the normal invoice request limit',async()=>{
 const {serializeRequest,MAX_REQUEST_CHARS}=await import('../src/api.js');const endpoint='https://script.google.com/macros/s/TEST/exec';
 assert.ok(serializeRequest(endpoint,{...photo(),data:'/9j/'+ 'A'.repeat(MAX_REQUEST_CHARS)},'uploadChallanPhoto','test-token').length>MAX_REQUEST_CHARS);
 assert.throws(()=>serializeRequest(endpoint,{id:invoiceId,notes:'x'.repeat(MAX_REQUEST_CHARS)},'createInvoice','test-token'),/too much detail/);
});

test('itemized challan purchases retain real lines and older clients can still create ordinary invoices',()=>{
 const b=challanBackend();capture(b);const payload=purchase(b,{amountOnly:false,items:[{...blankItem(),description:'ALUMINIUM',quantity:'10',rate:'470'}]});
 const saved=b.post('createInvoice',payload);assert.equal(saved.ok,true,saved.error);assert.equal(saved.record.amountOnly,false);assert.equal(saved.record.items[0].description,'ALUMINIUM');assert.equal(saved.record.totalMinor,470000);assert.equal(b.post('listChallans',{}).challans[0].invoiceId,invoiceId);assert.equal(saved.catalogue[0].name,'ALUMINIUM');
 const ordinary=makeInvoice({...blankInvoice(),partyId,type:'purchase',items:[{...blankItem(),description:'LEGACY',quantity:'1',rate:'100'}]},'legacy-purchase-invoice01');delete ordinary.amountOnly;delete ordinary.amountOnlySchemaVersion;delete ordinary.sourceChallanId;
 const result=b.post('createInvoice',ordinary);assert.equal(result.ok,true,result.error);assert.equal(b.post('createInvoice',ordinary).ok,true);
});

test('storage setup reports the failing Google service and does not replace inaccessible existing folders',()=>{
 const b=challanBackend({ready:false});b.context.DriveApp.createFolder=()=>{throw new Error('Unknown error occurred');};
 assert.throws(()=>b.context.setupChallanStorage(),/create the private Drive folder: Unknown error occurred/);
 assert.equal(b.properties.has('LEDGER_CHALLAN_FOLDER_ID'),false);assert.equal(b.triggers.length,0);
 const existing=challanBackend();const folder=existing.properties.get('LEDGER_CHALLAN_FOLDER_ID');existing.context.DriveApp.getFolderById=()=>{throw new Error('Access denied');};
 assert.throws(()=>existing.context.setupChallanStorage(),/open the existing private Drive folder: Access denied/);assert.equal(existing.properties.get('LEDGER_CHALLAN_FOLDER_ID'),folder);assert.equal(existing.folders.size,1);
});
test('a trigger setup failure preserves usable photo storage; cleanup can be installed separately later',()=>{
 const b=challanBackend({ready:false}),scripts=b.context.ScriptApp;b.context.ScriptApp={...scripts,getProjectTriggers(){throw new Error('Trigger permission denied');}};
 const result=b.context.setupChallanStorage();assert.equal(result.storageReady,true);assert.equal(result.cleanupReady,false);assert.match(result.cleanupError,/check existing cleanup triggers: Trigger permission denied/);
 const state=b.post('listChallans',{});assert.equal(state.storageReady,true);assert.equal(state.cleanupReady,false);capture(b,false);assert.equal(b.files.size,2);
 b.context.ScriptApp=scripts;assert.equal(b.context.setupChallanCleanup().cleanupReady,true);assert.equal(b.triggers.length,1);b.context.setupChallanStorage();assert.equal(b.triggers.length,1);assert.equal(b.folders.size,1);assert.equal(b.post('listChallans',{}).cleanupReady,true);
});


test('editor setup requests missing Drive consent before any setup writes and requests trigger consent separately',()=>{
 const b=challanBackend({ready:false});let creates=0;const create=b.context.DriveApp.createFolder;b.context.DriveApp.createFolder=(...args)=>{creates++;return create(...args);};
 const requireScopes=b.context.ScriptApp.requireScopes;b.context.ScriptApp.requireScopes=()=>{throw new Error('Authorization required: Google Drive');};
 assert.throws(()=>b.context.setupChallanStorage(),/Authorization required: Google Drive/);assert.equal(creates,0);assert.equal(b.tabs.size,0);
 b.context.ScriptApp.requireScopes=requireScopes;b.context.setupChallanStorage();
 assert.ok(b.scopeChecks[0].scopes.includes('https://www.googleapis.com/auth/drive'));assert.ok(!b.scopeChecks[0].scopes.includes('https://www.googleapis.com/auth/script.scriptapp'));assert.ok(b.scopeChecks[1].scopes.includes('https://www.googleapis.com/auth/script.scriptapp'));assert.equal(creates,1);
});


test('amount-only photos survive automatic cleanup and support resumable manual deletion without losing the invoice link',()=>{
 const b=challanBackend();capture(b,true);const saved=b.post('createInvoice',purchase(b));assert.equal(saved.ok,true,saved.error);
 let row=b.post('listChallans',{}).challans[0];assert.equal(row.autoDelete,false);assert.equal(row.amountOnly,true);assert.equal(row.invoiceId,invoiceId);
 assert.equal(b.post('updateChallanRetention',{id:challanId,autoDelete:true,_expectedRevision:row.revision,_editId:'amount-only-retention01'}).ok,false);
 b.setNow('2027-01-01T00:00:00Z');b.context.cleanupChallanPhotos();assert.ok([...b.files.values()].every(file=>!file.trashed));
 assert.equal(b.rawPost({action:'deleteChallanPhotos',transaction:{id:challanId}}).code,'UNAUTHORIZED');
 b.failNext('ChallanPhotos');assert.equal(b.post('deleteChallanPhotos',{id:challanId}).ok,false);
 assert.equal(b.post('deleteChallanPhotos',{id:challanId}).ok,true);assert.equal(b.post('deleteChallanPhotos',{id:challanId}).ok,true);
 assert.ok([...b.files.values()].every(file=>file.trashed));row=b.post('listChallans',{}).challans[0];assert.ok(row.photosDeletedAt);assert.equal(row.invoiceId,invoiceId);
 const invoice=b.post('listAccounts',{}).invoices[0];assert.equal(invoice.sourceChallanId,challanId);assert.equal(invoice.totalMinor,470000);
});


test('existing amount-only purchases with automatic retention are protected when the scheduled job runs',()=>{
 const b=challanBackend();capture(b,true);assert.equal(b.post('createInvoice',itemizedPurchase(b)).ok,true);
 // Simulate an amount-only invoice saved by the prior release, whose retention stayed on.
 const invoice=b.context.accountRows_(b.context.spreadsheet_(),'Invoices').find(row=>row.id===invoiceId);
 b.context.accountWrite_(b.context.spreadsheet_(),'Invoices',{...invoice,amountOnly:true},true);
 b.setNow('2027-01-01T00:00:00Z');b.context.cleanupChallanPhotos();
 assert.ok([...b.files.values()].every(file=>!file.trashed));
 const row=b.post('listChallans',{}).challans[0];assert.equal(row.autoDelete,false);assert.equal(row.amountOnly,true);assert.equal(row.invoiceId,invoiceId);
});
