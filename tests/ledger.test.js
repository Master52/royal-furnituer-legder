import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { periodRange, makeTransaction, totals, filterTransactions } from '../src/ledger.js';
import { validateEndpoint, request } from '../src/api.js';
import { newEntry, editEntry, hasDraft, shortcutAction } from '../src/entry.js';
import { normalizePreferences, entryDefaults, preferenceKey, csvForTransactions } from '../src/preferences.js';
const form = { amount:'1250.55',direction:'in',category:'Sale',method:'Cash',dateTime:'2026-09-12T14:20',party:'Customer',notes:'' };
const id = '12345678-1234-1234-1234-123456789012';
test('new payment preserves selections but clears prior amounts, notes and backdating',()=>{
  const next = newEntry({category:'Bhara',method:'Cheque',direction:'out',amount:'500',party:'Customer',notes:'old',customDate:true,dateTime:'2001-01-01T12:00',chequeDate:'2001-01-01'});
  assert.equal(next.category,'Bhara');assert.equal(next.method,'Cheque');assert.equal(next.direction,'out');
  for(const key of ['amount','party','notes','chequeDate']) assert.equal(next[key],'');
  assert.equal(next.customDate,false);assert.equal(hasDraft(next),false);assert.notEqual(next.dateTime,'2001-01-01T12:00');
  assert.equal(hasDraft({...next,amount:'5'}),true);assert.equal(hasDraft({...next,customDate:true}),true);
});
test('shortcuts require modifiers and ignore held keys, text composition and AltGr',()=>{
  assert.equal(shortcutAction({key:'n'}),null);
  assert.equal(shortcutAction({key:'N',altKey:true}),'new');
  assert.equal(shortcutAction({key:'3',altKey:true}),'Bhara');
  assert.equal(shortcutAction({key:'o',altKey:true}),'out');
  assert.equal(shortcutAction({key:'Enter',ctrlKey:true}),'save');
  assert.equal(shortcutAction({key:'Enter',metaKey:true}),'save');
  assert.equal(shortcutAction({key:'Enter'}),null);
  for(const extra of [{repeat:true},{isComposing:true},{getModifierState:()=>true},{ctrlKey:true}]) assert.equal(shortcutAction({key:'n',altKey:true,...extra}),null);
});
test('calendar periods cross years and include leap days',()=>{
  assert.deepEqual(periodRange('last',new Date(2026,0,5)),['2025-12-01','2025-12-31']);
  assert.deepEqual(periodRange('month',new Date(2024,1,5)),['2024-02-01','2024-02-29']);
});
test('integer money, cheque requirements, old transaction dates',()=>{
  const t=makeTransaction(form,id);
  assert.equal(t.amountMinor,125055); assert.equal(t.transactionDate,'2026-09-12');
  for (const amount of ['-1','0','1.005','NaN','Infinity']) assert.throws(()=>makeTransaction({...form,amount},id));
  assert.throws(()=>makeTransaction({...form,method:'Cheque'},id));
  assert.equal(makeTransaction({...form,method:'Cheque',chequeDate:'2026-09-11'},id).chequeDate,'2026-09-11');
});
test('inclusive date filters and direction independent from category',()=>{
  const a=makeTransaction(form,id), b={...a,id:'b',direction:'out',amountMinor:55,transactionDate:'2026-09-30'};
  const rows=filterTransactions([a,b,{...a,transactionDate:'2026-10-01'}],{start:'2026-09-01',end:'2026-09-30',query:'CUSTOMER'});
  assert.equal(rows.length,2); assert.deepEqual(totals(rows),{in:125055,out:55});
  assert.equal(filterTransactions(rows,{start:'2026-09-01',end:'2026-09-30',method:'Online'}).length,0);
});
test('only deployed Google Apps Script endpoints are accepted',()=>{
  assert.equal(validateEndpoint('https://script.google.com/macros/s/ABC-123/exec'),'https://script.google.com/macros/s/ABC-123/exec');
  for(const url of ['https://evil.test/macros/s/abc/exec','https://script.google.com/macros/s/abc/dev','javascript:alert(1)']) assert.throws(()=>validateEndpoint(url));
});
function backend() {
  const data=[];
  const sheet={getLastColumn:()=>data[0]?.length||0,getLastRow:()=>data.length,setFrozenRows:()=>{},getRange(r,c,n=1,m=1){return {
    getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>data[r-1+i]?.[c-1+j]??'')),
    setValue(v){data[r-1]??=[];data[r-1][c-1]=v;return this;},
    setValues(rows){rows.forEach((row,i)=>{data[r-1+i]??=[];row.forEach((value,j)=>data[r-1+i][c-1+j]=typeof value==='string'&&value.startsWith("'")?value.slice(1):value);});return this;},
    setNumberFormat(){return this;},setBackground(){return this;},setFontColor(){return this;},setFontWeight(){return this;}
  };}};
  const context=vm.createContext({console,ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'sheet-id'})},SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet}),flush:()=>{}},LockService:{getScriptLock:()=>({waitLock(){},hasLock:()=>true,releaseLock(){}})}});
  vm.runInContext(readFileSync(new URL('../google-apps-script/Code.gs',import.meta.url),'utf8'),context);
  return {context,data,list:()=>context.doPost({postData:{contents:JSON.stringify({action:'list'})}}),post:t=>context.doPost({postData:{contents:JSON.stringify({action:'create',transaction:t})}})};
}
test('backend retries are idempotent and conflicting IDs cannot overwrite history',()=>{
  const {post,data,context}=backend();const t=makeTransaction({...form,notes:'=SUM(A1:A9)'},id);
  assert.equal(post(t).ok,true); assert.equal(post(t).duplicate,true); assert.equal(data.length,2);
  assert.equal(post({...t,amountMinor:999}).ok,false); assert.equal(data.length,2);
  assert.equal(context.doPost({postData:{contents:JSON.stringify({action:'list'})}}).transactions[0].notes,'=SUM(A1:A9)');
});
test('backend rejects missing cheque dates and impossible business dates',()=>{
  const {post}=backend();const t=makeTransaction(form,id);
  assert.equal(post({...t,method:'Cheque',chequeDate:''}).ok,false);
  assert.equal(post({...t,transactionDate:'2026-02-30'}).ok,false);
});
test('schema extension preserves unknown columns and historical values',()=>{
  const {post,data,context}=backend(); post(makeTransaction(form,id));
  data[0].push('futureField');data[1].push('keep me');
  post(makeTransaction(form,'22345678-1234-1234-1234-123456789012'));
  assert.equal(context.doPost({postData:{contents:JSON.stringify({action:'list'})}}).transactions[0].futureField,'keep me'); assert.equal(data[2].at(-1),'');
});
test('report dates handle Sheets Date objects and whitespace without guessing ambiguous dates',()=>{
  const {context}=backend();
  context.Utilities={formatDate:(date,tz,format)=>{assert.equal(tz,'Asia/Kolkata');return format==='yyyy-MM'?'2024-02':'2024-02-29';}};
  assert.equal(context.reportDate_(' 2024-02-29 ','Asia/Kolkata'),'2024-02-29');
  assert.equal(context.reportDate_(new Date('2024-02-28T18:30:00Z'),'Asia/Kolkata'),'2024-02-29');
  assert.equal(context.reportDate_('', 'Asia/Kolkata'),'');
  assert.equal(context.validDate_(context.reportDate_('02/03/2024','Asia/Kolkata')),false);
  assert.deepEqual(Array.from(context.currentReportMonth_({getSpreadsheetTimeZone:()=> 'Asia/Kolkata'})),['2024-02-01','2024-02-29']);
});
test('setup fills missing report date cells even when the report already contains content',()=>{
  const {context}=backend();const cells={B2:'2024-02-10',B3:''};
  const report={getRange:cell=>({setValues(){return this;},getValue:()=>cells[cell],setNumberFormat(){return this;},setValue(value){cells[cell]=value;return this;}})};
  context.SpreadsheetApp.getActiveSpreadsheet=()=>({getId:()=> 'id',getSheetByName:()=>report});
  context.PropertiesService.getScriptProperties=()=>({setProperty(){}});
  context.ensureSheet_=()=>{};context.currentReportMonth_=()=>['2024-02-01','2024-02-29'];
  context.refreshReport=()=>{};
  context.setup();assert.deepEqual(cells,{B2:'2024-02-10',B3:'2024-02-29'});
  context.setup();assert.deepEqual(cells,{B2:'2024-02-10',B3:'2024-02-29'});
});
test('deletion is persistent, idempotent, preserves history and rejects recreation',()=>{
  const {post,data,context}=backend(); const t=makeTransaction(form,id); post(t);
  const remove=id=>context.doPost({postData:{contents:JSON.stringify({action:'delete',transaction:{id}})}});
  assert.equal(remove('invalid').ok,false);
  assert.equal(remove('99999999-1234-1234-1234-123456789012').ok,false);
  assert.equal(remove(id).deleted,true);
  const deletedAt=data[1][data[0].indexOf('deletedAt')];assert.ok(deletedAt);
  assert.equal(remove(id).deleted,true);assert.equal(data[1][data[0].indexOf('deletedAt')],deletedAt);
  assert.equal(context.doPost({postData:{contents:JSON.stringify({action:'list'})}}).transactions.length,0);
  assert.equal(data.length,2);assert.equal(data[1][data[0].indexOf('amountMinor')],125055);
  assert.equal(post(t).ok,false);
});
test('reports exclude deleted records from totals',()=>{
  const {context}=backend(); let output;
  context.spreadsheet_=()=>({getSpreadsheetTimeZone:()=> 'UTC',getSheetByName:()=>({
    getRange:(row)=>({getValue:()=>row==='B2'?'2026-09-01':'2026-09-30',setValues(value){if(row===5)output=value;return this;},setNumberFormat(){return this;},setBackground(){return this;},setFontColor(){return this;},setFontWeight(){return this;}}),autoResizeColumns(){}
  })});
  context.ensureSheet_=()=>({sheet:{},headers:[]});
  const active=makeTransaction(form,id);
  context.records_=()=>[active,{...active,id:'deleted',amountMinor:999999,deletedAt:'2026-09-26T00:00:00Z'}];
  context.refreshReport();assert.equal(output.at(-1)[1],1250.55);assert.equal(output.at(-1)[4],1);
});
test('direct backend access lists records and still excludes deleted rows',()=>{
  const {context,post}=backend();
  assert.equal(context.doGet().ok,true);
  post(makeTransaction(form,id));
  assert.equal(context.doGet().transactions.length,1);
  context.doPost({postData:{contents:JSON.stringify({action:'delete',transaction:{id}})}});
  assert.equal(context.doGet().transactions.length,0);
});
test('client reads and writes without Firebase credentials',async()=>{
  const originalFetch=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(url,options)=>{calls.push(options);return {ok:true,json:async()=>({ok:true,transactions:[]})};};
  try {
    await request('https://script.google.com/macros/s/test/exec');
    await request('https://script.google.com/macros/s/test/exec',{id},'delete');
    assert.equal(calls[0].method,undefined);
    assert.deepEqual(JSON.parse(calls[1].body),{action:'delete',transaction:{id}});
  } finally {globalThis.fetch=originalFetch;}
});
test('backend reports its deployed version without modifying existing transactions',()=>{
  const {context,post,data}=backend();
  assert.equal(context.doGet().backendVersion,'1.3.0');
  assert.equal(post(makeTransaction(form,id)).backendVersion,'1.3.0');
  assert.equal(data[1][data[0].indexOf('schemaVersion')],1);
  assert.equal(context.doPost({postData:{contents:'{}'}}).backendVersion,'1.3.0');
});
test('connection rejects successful responses without a ledger but supports older unversioned scripts',async()=>{
  const originalFetch=globalThis.fetch;
  try {
    globalThis.fetch=async()=>({ok:true,json:async()=>({ok:true,message:'not a ledger'})});
    await assert.rejects(request('https://script.google.com/macros/s/test/exec'),/did not return a ledger/);
    globalThis.fetch=async()=>({ok:true,json:async()=>({ok:true,transactions:[]})});
    assert.deepEqual((await request('https://script.google.com/macros/s/test/exec')).transactions,[]);
  } finally {globalThis.fetch=originalFetch;}
});
test('edit form preserves historical dates and exact paise amounts',()=>{
  const form=editEntry({amountMinor:12345,transactionDate:'2020-01-02',transactionTime:'08:09',direction:'out',category:'Expense',method:'Cheque',chequeDate:'2020-01-01',party:'A',notes:'B'});
  assert.equal(form.amount,'123.45');assert.equal(form.dateTime,'2020-01-02T08:09');assert.equal(form.customDate,true);assert.equal(form.chequeDate,'2020-01-01');
});
test('editing preserves ID, creation time, unknown columns and handles duplicate retries',()=>{
  const {context,post,data}=backend();const t=makeTransaction(form,id);post(t);
  const created=context.doGet().transactions[0].createdAt;
  data[0].push('future');data[1].push('preserve');
  const change={...t,amountMinor:9900,notes:'=literal note',_expectedRevision:0,_editId:'33333333-1234-1234-1234-123456789012'};
  const edit=t=>context.doPost({postData:{contents:JSON.stringify({action:'update',transaction:t})}});
  const result=edit(change);assert.equal(result.updated,true);assert.equal(result.transaction.id,id);assert.equal(result.transaction.createdAt,created);assert.equal(result.transaction.revision,1);assert.ok(result.transaction.updatedAt);
  assert.equal(context.doGet().transactions[0].future,'preserve');assert.equal(context.doGet().transactions[0].notes,'=literal note');
  assert.equal(edit(change).transaction.revision,1);assert.equal(data.length,2);
  assert.equal(edit({...change,amountMinor:20}).code,'EDIT_CONFLICT');
  assert.equal(edit({...change,_editId:'44444444-1234-1234-1234-123456789012'}).code,'EDIT_CONFLICT');
  assert.equal(edit({...change,_expectedRevision:1,_editId:'44444444-1234-1234-1234-123456789012'}).transaction.revision,2);
});
test('edits reject deleted payments and invalid cheque data without changing totals',()=>{
  const {context,post}=backend();const t=makeTransaction(form,id);post(t);
  const edit=t=>context.doPost({postData:{contents:JSON.stringify({action:'update',transaction:t})}});
  const changed={...t,_expectedRevision:0,_editId:'33333333-1234-1234-1234-123456789012',method:'Cheque',chequeDate:''};
  assert.equal(edit(changed).ok,false);assert.equal(context.doGet().transactions[0].method,'Cash');
  context.doPost({postData:{contents:JSON.stringify({action:'delete',transaction:{id}})}});
  assert.equal(edit({...changed,method:'Cash'}).code,'EDIT_CONFLICT');assert.equal(context.doGet().transactions.length,0);
});
test('preferences validate defaults and keep shop settings separate by endpoint',()=>{
  const p=normalizePreferences({shopName:'  My shop  ',defaultCategory:'Bhara',defaultMethod:'Online',theme:'dark',largeText:true,printNotes:false,printContact:false});
  assert.equal(p.shopName,'My shop');assert.equal(p.theme,'dark');assert.equal(p.printNotes,false);assert.equal(p.printContact,false);
  assert.deepEqual(entryDefaults(p),{category:'Bhara',method:'Online',direction:'out'});
  assert.equal(normalizePreferences({defaultCategory:'bad',defaultMethod:'bad',theme:'bad'}).defaultMethod,'Cash');
  assert.equal(normalizePreferences(null).shopName,'Royal Furnitures');
  assert.equal(normalizePreferences(null).address,'46/2, Lakkhad Pitha road');
  assert.equal(normalizePreferences(null).phone,'+917987979086');
  assert.equal(makeTransaction(form,id).timezone,'Asia/Kolkata');
  assert.notEqual(preferenceKey('sheet-a'),preferenceKey('sheet-b'));
});
test('CSV preserves quoted multiline data, decimal amounts and neutralizes formulas',()=>{
  const rows=[{...makeTransaction(form,id),party:'=SUM(A1)',notes:'He said "hello",\nsecond line'},{...makeTransaction(form,id),party:'  +danger',notes:'\t=evil'}];
  const csv=csvForTransactions(rows);
  assert.ok(csv.startsWith('\uFEFF"id"'));assert.ok(csv.includes('"1250.55"'));
  assert.ok(csv.includes('"\'=SUM(A1)"'));assert.ok(csv.includes('"\'  +danger"'));assert.ok(csv.includes('"\'\t=evil"'));
  assert.ok(csv.includes('"He said ""hello"",\nsecond line"'));
  assert.equal(csvForTransactions([]).split('\r\n').length,1);
});
test('deleted list and restore preserve records and handle retries without duplication',()=>{
  const {context,post,data}=backend();const t=makeTransaction({...form,notes:'=literal'},id);post(t);
  const call=(action,transaction={})=>context.doPost({postData:{contents:JSON.stringify({action,transaction})}});
  assert.equal(call('listDeleted').transactions.length,0);
  call('delete',{id});const removed=call('listDeleted').transactions[0];
  assert.equal(context.doGet().transactions.length,0);assert.equal(removed.revision,1);
  const payload={id,deletedAt:removed.deletedAt,_expectedRevision:removed.revision};
  const restored=call('restore',payload);assert.equal(restored.restored,true);assert.equal(restored.transaction.revision,2);
  assert.equal(restored.transaction.amountMinor,t.amountMinor);assert.equal(restored.transaction.notes,'=literal');assert.ok(restored.transaction.restoredAt);
  assert.equal(call('listDeleted').transactions.length,0);assert.equal(context.doGet().transactions.length,1);
  assert.equal(call('restore',payload).restored,true);assert.equal(data.length,2);
  call('delete',{id});assert.equal(call('restore',payload).ok,false);
});
test('stale edits cannot overwrite restored payments',()=>{
  const {context,post}=backend();const t=makeTransaction(form,id);post(t);
  const call=(action,transaction={})=>context.doPost({postData:{contents:JSON.stringify({action,transaction})}});
  call('delete',{id});const deleted=call('listDeleted').transactions[0];
  assert.equal(call('restore',{id,deletedAt:'wrong',_expectedRevision:1}).ok,false);
  call('restore',{id,deletedAt:deleted.deletedAt,_expectedRevision:deleted.revision});
  assert.equal(call('update',{...t,_expectedRevision:0,_editId:'55555555-1234-1234-1234-123456789012'}).code,'EDIT_CONFLICT');
  assert.equal(call('restore',{id:'99999999-1234-1234-1234-123456789012',deletedAt:deleted.deletedAt,_expectedRevision:1}).ok,false);
});
