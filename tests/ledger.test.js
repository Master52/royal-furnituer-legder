import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { periodRange, makeTransaction, totals, sumAmounts, filterTransactions, paymentMethodTotals, paymentMethodBalance, transactionIntegrityIssue, duplicateTransactionIds, money } from '../src/ledger.js';
import { validateEndpoint, request } from '../src/api.js';
import { paymentPartySelection, newEntry, editEntry, hasDraft, shortcutAction } from '../src/entry.js';
import { normalizePreferences, entryDefaults, preferenceKey, csvForTransactions } from '../src/preferences.js';
const form = { amount:'1250.55',direction:'in',category:'Sale',method:'Cash',dateTime:'2026-09-12T14:20',party:'Customer',notes:'' };
const TEST_ACCESS_TOKEN='test-ledger-access-token-0000000000000001';
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
  assert.equal(shortcutAction({key:'r',altKey:true}),'cash-received');
  assert.equal(shortcutAction({key:'h',altKey:true}),'cash-change');
  assert.equal(shortcutAction({key:'j',altKey:true}),'online-change');
  assert.equal(shortcutAction({key:'x',altKey:true}),null);
  assert.equal(shortcutAction({key:'1',altKey:true,shiftKey:true}),'exchange-cash-online');
  assert.equal(shortcutAction({key:'2',altKey:true,shiftKey:true}),'exchange-online-cash');
  assert.equal(shortcutAction({key:'m',altKey:true,shiftKey:true}),'adjustment-method');
  assert.equal(shortcutAction({key:'o',altKey:true,shiftKey:true}),'online-counted');
  assert.equal(shortcutAction({key:'1',altKey:true}),'Sale');
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
  assert.throws(()=>makeTransaction({...form,dateTime:'2026-02-30T14:20'},id),/valid transaction date/);
  assert.throws(()=>makeTransaction({...form,dateTime:'2026-09-12T24:00'},id),/valid transaction date/);
  assert.equal(transactionIntegrityIssue({...makeTransaction(form,id),transactionDate:'2026-02-30'}),'invalid transaction date or time');
  assert.equal(makeTransaction({...form,amount:'1000000000'},id).amountMinor,100000000000);
  assert.throws(()=>makeTransaction({...form,amount:'1000000000.01'},id),/no greater than/);
});
test('cash sales calculate change and account for online and cash returns',()=>{
  const cashDefault=makeTransaction({...form,amount:'1000',cashReceived:'1200'},id);
  assert.equal(cashDefault.cashChangeMinor,20000);assert.equal(cashDefault.onlineChangeMinor,0);
  const sale=makeTransaction({...form,amount:'1000',cashReceived:'1200',onlineChange:'150'},id);
  assert.equal(sale.amountMinor,100000);assert.equal(sale.cashReceivedMinor,120000);assert.equal(sale.onlineChangeMinor,15000);assert.equal(sale.cashChangeMinor,5000);
  const onlineSelected=makeTransaction({...form,amount:'1000',cashReceived:'1200',cashChange:'75'},id);
  assert.equal(onlineSelected.cashChangeMinor,7500);assert.equal(onlineSelected.onlineChangeMinor,12500);
  assert.throws(()=>makeTransaction({...form,amount:'1000',cashReceived:'1200',cashChange:'50',onlineChange:'100'},id),/add up to the change due/);
  assert.throws(()=>makeTransaction({...form,amount:'1000',cashReceived:'900'},id),/less than the sale amount/);
  assert.throws(()=>makeTransaction({...form,amount:'1000',cashReceived:'1100',onlineChange:'120'},id),/add up to the change due/);
  const methods=paymentMethodTotals([sale],{start:'2026-09-01',end:'2026-09-30'});
  assert.deepEqual(methods,{Cash:{in:120000,out:5000},Online:{in:0,out:15000}});
  assert.equal(totals([sale]).in,100000);
  const paise=makeTransaction({...form,amount:'12.30',cashReceived:'12.34',cashChange:'0.01'},id);
  assert.equal(paise.cashReceivedMinor,1234);assert.equal(paise.cashChangeMinor,1);assert.equal(paise.onlineChangeMinor,3);
});
test('cash/online exchanges move balances both ways without becoming income or expense',()=>{
  const receivedCash=makeTransaction({...form,recordType:'transfer',amount:'250',exchangeDirection:'receive-cash-send-online'},id);
  const receivedOnline=makeTransaction({...form,recordType:'transfer',amount:'250',exchangeDirection:'receive-online-give-cash'},'22345678-1234-1234-1234-123456789012');
  assert.deepEqual([receivedCash.fromMethod,receivedCash.toMethod],['Online','Cash']);
  assert.deepEqual([receivedOnline.fromMethod,receivedOnline.toMethod],['Cash','Online']);
  assert.deepEqual(totals([receivedCash,receivedOnline]),{in:0,out:0});
  const methods=paymentMethodTotals([receivedCash],{start:'2026-09-01',end:'2026-09-30'});
  assert.deepEqual(methods,{Cash:{in:25000,out:0},Online:{in:0,out:25000}});
  const reverse=paymentMethodTotals([receivedOnline],{start:'2026-09-01',end:'2026-09-30'});
  assert.deepEqual(reverse,{Cash:{in:0,out:25000},Online:{in:25000,out:0}});
});
test('all-time cash and online balances add inflows and subtract outflows, exchanges and returned change',()=>{
  const rows=[
    makeTransaction({...form,dateTime:'2026-09-12T14:20',amount:'100',cashReceived:'120',cashChange:'10',onlineChange:'10'},'42345678-1234-1234-1234-123456789012'),
    makeTransaction({...form,dateTime:'2026-09-12T14:21',recordType:'transfer',amount:'5',exchangeDirection:'receive-cash-send-online'},'52345678-1234-1234-1234-123456789012'),
    makeTransaction({...form,dateTime:'2026-09-12T14:22',amount:'2',category:'Expense',direction:'out',method:'Online'},'62345678-1234-1234-1234-123456789012')
  ];
  assert.deepEqual(paymentMethodBalance(rows),{Cash:11500,Online:-1700});
});
test('cashflow adjustments change expected balances only and can be safely recalculated',()=>{
  const payment=makeTransaction({...form,amount:'100'},id);
  const adjustment=makeTransaction({...form,recordType:'adjustment',adjustmentMethod:'Cash',countedBalance:'90',expectedCashMinor:10000,expectedOnlineMinor:0,notes:'Counted at closing'},'72345678-1234-1234-1234-123456789012');
  const onlineAdjustment=makeTransaction({...form,recordType:'adjustment',adjustmentMethod:'Online',countedBalance:'25',expectedCashMinor:10000,expectedOnlineMinor:0},'73345678-1234-1234-1234-123456789012');
  assert.deepEqual([adjustment.cashAdjustmentMinor,adjustment.onlineAdjustmentMinor],[-1000,0]);
  assert.deepEqual([onlineAdjustment.cashAdjustmentMinor,onlineAdjustment.onlineAdjustmentMinor],[0,2500]);
  assert.deepEqual(paymentMethodBalance([payment,adjustment,onlineAdjustment]),{Cash:9000,Online:2500});
  assert.deepEqual(totals([payment,adjustment]),{in:10000,out:0});
  assert.equal(sumAmounts([payment,adjustment]),10000);
  assert.equal(transactionIntegrityIssue(adjustment),'');
  assert.equal(transactionIntegrityIssue({...adjustment,countedCashMinor:9500}),'unbalanced cashflow adjustment');
});
test('an empty ledger has zero numeric balances and accepts its first adjustment',()=>{
  assert.deepEqual(paymentMethodBalance([]),{Cash:0,Online:0});
  const first=makeTransaction({...form,recordType:'adjustment',adjustmentMethod:'Cash',countedBalance:'100',expectedCashMinor:0,expectedOnlineMinor:0},'76345678-1234-1234-1234-123456789012');
  assert.equal(transactionIntegrityIssue(first),'');
  assert.deepEqual(paymentMethodBalance([first]),{Cash:10000,Online:0});
});
test('adjustment drafts warn only after a counted amount is entered',()=>{
  const fresh=newEntry();fresh.recordType='adjustment';
  assert.equal(hasDraft(fresh),false);
  assert.equal(hasDraft({...fresh,countedBalance:'250'}),true);
});
test('one-sided adjustments allow a negative ledger balance on the uncounted method',()=>{
  const adjustment=makeTransaction({...form,recordType:'adjustment',adjustmentMethod:'Cash',countedBalance:'90',expectedCashMinor:10000,expectedOnlineMinor:-500},'74345678-1234-1234-1234-123456789012');
  const startingRows=[makeTransaction({...form,amount:'100'},'74345678-1234-1234-1234-123456789013'),makeTransaction({...form,amount:'5',direction:'out',category:'Expense',method:'Online'},'74345678-1234-1234-1234-123456789014')];
  assert.equal(adjustment.direction,'adjustment-cash');assert.equal(adjustment.countedOnlineMinor,-500);
  assert.equal(transactionIntegrityIssue(adjustment),'');
  assert.deepEqual(paymentMethodBalance([...startingRows,adjustment]),{Cash:9000,Online:-500});
  assert.throws(()=>makeTransaction({...form,recordType:'adjustment',adjustmentMethod:'Cash',countedBalance:'-1',expectedCashMinor:0,expectedOnlineMinor:-500},'75345678-1234-1234-1234-123456789012'),/valid cash balance/);
});
test('bad sheet values cannot poison totals or cash/online settlement figures',()=>{
  const good=makeTransaction(form,id);
  const badAmount={...good,id:'bad-amount',amountMinor:'0x10'};
  const badDirection={...good,id:'bad-direction',direction:'sideways'};
  const badType={...good,id:'bad-type',recordType:'unexpected'};
  assert.deepEqual(totals([good,badAmount,badDirection,badType]),{in:125055,out:0});
  assert.equal(sumAmounts([good,badAmount]),125055);
  assert.equal(money('not a number'),'Invalid amount');
  assert.equal(money('1e3'),'Invalid amount');
  const badSettlement={...makeTransaction({...form,amount:'100',cashReceived:'120'},'22345678-1234-1234-1234-123456789012'),onlineChangeMinor:'broken'};
  assert.deepEqual(totals([badSettlement]),{in:0,out:0});assert.equal(sumAmounts([badSettlement]),0);
  const methods=paymentMethodTotals([badSettlement],{start:'2026-09-01',end:'2026-09-30'});
  assert.deepEqual(methods,{Cash:{in:0,out:0},Online:{in:0,out:0}});
  assert.equal(transactionIntegrityIssue(badSettlement),'unbalanced cash change');
  const duplicate={...good,id:'duplicate-id'};
  assert.deepEqual([...duplicateTransactionIds([duplicate,{...duplicate}])],['duplicate-id']);
  assert.deepEqual(totals([duplicate,{...duplicate}]),{in:0,out:0});
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
  const context=vm.createContext({console,ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='LEDGER_ACCESS_TOKEN'?TEST_ACCESS_TOKEN:'sheet-id'})},SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet}),flush:()=>{}},LockService:{getScriptLock:()=>({waitLock(){},hasLock:()=>true,releaseLock(){}})}});
  vm.runInContext(readFileSync(new URL('../google-apps-script/Code.gs',import.meta.url),'utf8'),context);
  return {context,data,list:()=>context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'list'})}}),post:t=>context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'create',transaction:t})}})};
}
test('backend retries are idempotent and conflicting IDs cannot overwrite history',()=>{
  const {post,data,context}=backend();const t=makeTransaction({...form,notes:'=SUM(A1:A9)'},id);
  assert.equal(post(t).ok,true); assert.equal(post(t).duplicate,true); assert.equal(data.length,2);
  assert.equal(post({...t,amountMinor:999}).ok,false); assert.equal(data.length,2);
  assert.equal(context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'list'})}}).transactions[0].notes,'=SUM(A1:A9)');
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
  assert.equal(context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'list'})}}).transactions[0].futureField,'keep me'); assert.equal(data[2].at(-1),'');
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
  context.PropertiesService.getScriptProperties=()=>({setProperty(){},getProperty:()=>TEST_ACCESS_TOKEN});
  context.ensureSheet_=()=>{};context.ensureAccounts_=()=>{};context.currentReportMonth_=()=>['2024-02-01','2024-02-29'];
  context.refreshReport=()=>{};
  context.setup();assert.deepEqual(cells,{B2:'2024-02-10',B3:'2024-02-29'});
  context.setup();assert.deepEqual(cells,{B2:'2024-02-10',B3:'2024-02-29'});
});
test('deletion is persistent, idempotent, preserves history and rejects recreation',()=>{
  const {post,data,context}=backend(); const t=makeTransaction(form,id); post(t);
  const remove=id=>context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'delete',transaction:{id}})}});
  assert.equal(remove('invalid').ok,false);
  assert.equal(remove('99999999-1234-1234-1234-123456789012').ok,false);
  assert.equal(remove(id).deleted,true);
  const deletedAt=data[1][data[0].indexOf('deletedAt')];assert.ok(deletedAt);
  assert.equal(remove(id).deleted,true);assert.equal(data[1][data[0].indexOf('deletedAt')],deletedAt);
  assert.equal(context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'list'})}}).transactions.length,0);
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
test('Sheet report stops instead of publishing totals when a transaction amount is corrupt',()=>{
  const {context}=backend();
  context.spreadsheet_=()=>({getSpreadsheetTimeZone:()=> 'UTC',getSheetByName:()=>({getRange:cell=>({getValue:()=>cell==='B2'?'2026-09-01':'2026-09-30'})})});
  context.ensureSheet_=()=>({sheet:{},headers:[]});
  context.records_=()=>[{id:'corrupt-row',transactionDate:'2026-09-12',amountMinor:'bad',category:'Sale',direction:'in'}];
  assert.throws(()=>context.refreshReport(),/has an invalid amount/);
});
test('public GET rejects access while authenticated lists exclude deleted rows',()=>{
  const {context,post}=backend();
  assert.equal(context.doGet().code,'UNAUTHORIZED');
  post(makeTransaction(form,id));
  assert.equal(context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'list'})}}).transactions.length,1);
  context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'delete',transaction:{id}})}});
  assert.equal(context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'list'})}}).transactions.length,0);
});
test('client reads and writes without Firebase credentials',async()=>{
  const originalFetch=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(url,options)=>{calls.push(options);return new Response(JSON.stringify({ok:true,transactions:[]}));};
  try {
    await request('https://script.google.com/macros/s/test/exec');
    await request('https://script.google.com/macros/s/test/exec',{id},'delete');
    assert.equal(calls[0].method,'POST');assert.deepEqual(JSON.parse(calls[0].body),{action:'list',transaction:{}});
    assert.deepEqual(JSON.parse(calls[1].body),{action:'delete',transaction:{id}});
  } finally {globalThis.fetch=originalFetch;}
});
test('backend reports its deployed version without modifying existing transactions',()=>{
  const {context,post,data}=backend();
  assert.equal(context.doGet().backendVersion,'1.23.3');
  assert.equal(post(makeTransaction(form,id)).backendVersion,'1.23.3');
  assert.equal(data[1][data[0].indexOf('schemaVersion')],1);
  assert.equal(context.doPost({postData:{contents:'{}'}}).backendVersion,'1.23.3');
});
test('Apps Script appends settlement columns and validates change, exchange and adjustment records',()=>{
  const {context,post,data}=backend();
  const sale=makeTransaction({...form,amount:'100',cashReceived:'120',onlineChange:'20'},id);
  assert.equal(post(sale).ok,true);
  const headers=data[0];
  for(const name of ['recordType','cashReceivedMinor','cashChangeMinor','onlineChangeMinor','fromMethod','toMethod']) assert.ok(headers.includes(name));
  const saved=context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'list'})}}).transactions[0];
  assert.equal(saved.cashReceivedMinor,12000);assert.equal(saved.onlineChangeMinor,2000);assert.equal(saved.cashChangeMinor,0);
  const adjustment=makeTransaction({...form,recordType:'adjustment',adjustmentMethod:'Cash',countedBalance:'90',expectedCashMinor:10000,expectedOnlineMinor:0},'82345678-1234-1234-1234-123456789012');
  assert.equal(post(adjustment).ok,true);
  for(const name of ['expectedCashMinor','countedCashMinor','cashAdjustmentMinor','expectedOnlineMinor','countedOnlineMinor','onlineAdjustmentMinor']) assert.ok(headers.includes(name));
  assert.equal(post({...adjustment,cashAdjustmentMinor:1}).ok,false);
  const negativeOther=makeTransaction({...form,recordType:'adjustment',adjustmentMethod:'Cash',countedBalance:'90',expectedCashMinor:10000,expectedOnlineMinor:-500},'83345678-1234-1234-1234-123456789012');
  assert.equal(post(negativeOther).ok,true);
  assert.equal(post({...sale,cashChangeMinor:-1}).ok,false);
  assert.equal(post({...sale,onlineChangeMinor:'2e3'}).ok,false);
  const transfer=makeTransaction({...form,recordType:'transfer',amount:'35',exchangeDirection:'receive-cash-send-online'},'32345678-1234-1234-1234-123456789012');
  assert.equal(post(transfer).ok,true);
  assert.equal(context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'list'})}}).transactions[3].recordType,'transfer');
  assert.equal(post({...transfer,fromMethod:'Cash'}).ok,false);
  assert.equal(data.length,5);
});
test('connection rejects successful responses without a ledger but supports older unversioned scripts',async()=>{
  const originalFetch=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response(JSON.stringify({ok:true,message:'not a ledger'}));
    await assert.rejects(request('https://script.google.com/macros/s/test/exec'),/did not return a ledger/);
    globalThis.fetch=async()=>new Response(JSON.stringify({ok:true,transactions:[]}));
    assert.deepEqual((await request('https://script.google.com/macros/s/test/exec')).transactions,[]);
  } finally {globalThis.fetch=originalFetch;}
});
test('edit form preserves historical dates and exact paise amounts',()=>{
  const form=editEntry({amountMinor:12345,transactionDate:'2020-01-02',transactionTime:'08:09',direction:'out',category:'Expense',method:'Cheque',chequeDate:'2020-01-01',party:'A',notes:'B'});
  assert.equal(form.amount,'123.45');assert.equal(form.dateTime,'2020-01-02T08:09');assert.equal(form.customDate,true);assert.equal(form.chequeDate,'2020-01-01');
});
test('editing a marked cash adjustment keeps the same target balance',()=>{
  const form=editEntry({recordType:'adjustment',direction:'adjustment-cash',category:'Cashflow adjustment',method:'Adjustment',amountMinor:2500,transactionDate:'2026-09-11',transactionTime:'10:00',expectedCashMinor:5000,countedCashMinor:5000,cashAdjustmentMinor:0,expectedOnlineMinor:-1000,countedOnlineMinor:1500,onlineAdjustmentMinor:2500});
  assert.equal(form.adjustmentMethod,'Cash');assert.equal(form.countedBalance,'50.00');assert.equal(form.preservedOnlineAdjustmentMinor,2500);
});
test('editing preserves ID, creation time, unknown columns and handles duplicate retries',()=>{
  const {context,post,data}=backend();const t=makeTransaction(form,id);post(t);
  const created=context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'list'})}}).transactions[0].createdAt;
  data[0].push('future');data[1].push('preserve');
  const change={...t,amountMinor:9900,cashReceivedMinor:9900,cashChangeMinor:0,onlineChangeMinor:0,notes:'=literal note',_expectedRevision:0,_editId:'33333333-1234-1234-1234-123456789012'};
  const edit=t=>context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'update',transaction:t})}});
  const result=edit(change);assert.equal(result.updated,true);assert.equal(result.transaction.id,id);assert.equal(result.transaction.createdAt,created);assert.equal(result.transaction.revision,1);assert.ok(result.transaction.updatedAt);
  assert.deepEqual(paymentMethodBalance([result.transaction]),{Cash:9900,Online:0});
  assert.equal(context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'list'})}}).transactions[0].future,'preserve');assert.equal(context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'list'})}}).transactions[0].notes,'=literal note');
  assert.equal(edit(change).transaction.revision,1);assert.equal(data.length,2);
  assert.equal(edit({...change,amountMinor:20,cashReceivedMinor:20}).code,'EDIT_CONFLICT');
  assert.equal(edit({...change,_editId:'44444444-1234-1234-1234-123456789012'}).code,'EDIT_CONFLICT');
  assert.equal(edit({...change,_expectedRevision:1,_editId:'44444444-1234-1234-1234-123456789012'}).transaction.revision,2);
});
test('cashflow adjustment edits update its appended balance fields',()=>{
  const {context,post}=backend();const adjustment=makeTransaction({...form,recordType:'adjustment',adjustmentMethod:'Cash',countedBalance:'90',expectedCashMinor:10000,expectedOnlineMinor:0},id);post(adjustment);
  const updated={...adjustment,countedCashMinor:9500,cashAdjustmentMinor:-500,amountMinor:500,_expectedRevision:0,_editId:'93333333-1234-1234-1234-123456789012'};
  const result=context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'update',transaction:updated})}});
  assert.equal(result.updated,true);assert.equal(result.transaction.countedCashMinor,9500);assert.equal(result.transaction.cashAdjustmentMinor,-500);
});
test('edits reject deleted payments and invalid cheque data without changing totals',()=>{
  const {context,post}=backend();const t=makeTransaction(form,id);post(t);
  const edit=t=>context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'update',transaction:t})}});
  const changed={...t,_expectedRevision:0,_editId:'33333333-1234-1234-1234-123456789012',method:'Cheque',chequeDate:''};
  assert.equal(edit(changed).ok,false);assert.equal(context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'list'})}}).transactions[0].method,'Cash');
  context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'delete',transaction:{id}})}});
  assert.equal(edit({...changed,method:'Cash'}).code,'EDIT_CONFLICT');assert.equal(context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'list'})}}).transactions.length,0);
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
  assert.ok(csvForTransactions([{id:'bad',amountMinor:'1e4'}]).includes('"INVALID"'));
  assert.equal(csvForTransactions([]).split('\r\n').length,1);
});
test('deleted list and restore preserve records and handle retries without duplication',()=>{
  const {context,post,data}=backend();const t=makeTransaction({...form,notes:'=literal'},id);post(t);
  const call=(action,transaction={})=>context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action,transaction})}});
  assert.equal(call('listDeleted').transactions.length,0);
  call('delete',{id});const removed=call('listDeleted').transactions[0];
  assert.equal(context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'list'})}}).transactions.length,0);assert.equal(removed.revision,1);
  const payload={id,deletedAt:removed.deletedAt,_expectedRevision:removed.revision};
  const restored=call('restore',payload);assert.equal(restored.restored,true);assert.equal(restored.transaction.revision,2);
  assert.equal(restored.transaction.amountMinor,t.amountMinor);assert.equal(restored.transaction.notes,'=literal');assert.ok(restored.transaction.restoredAt);
  assert.equal(call('listDeleted').transactions.length,0);assert.equal(context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action:'list'})}}).transactions.length,1);
  assert.equal(call('restore',payload).restored,true);assert.equal(data.length,2);
  call('delete',{id});assert.equal(call('restore',payload).ok,false);
});
test('stale edits cannot overwrite restored payments',()=>{
  const {context,post}=backend();const t=makeTransaction(form,id);post(t);
  const call=(action,transaction={})=>context.doPost({postData:{contents:JSON.stringify({accessToken:TEST_ACCESS_TOKEN,action,transaction})}});
  call('delete',{id});const deleted=call('listDeleted').transactions[0];
  assert.equal(call('restore',{id,deletedAt:'wrong',_expectedRevision:1}).ok,false);
  call('restore',{id,deletedAt:deleted.deletedAt,_expectedRevision:deleted.revision});
  assert.equal(call('update',{...t,_expectedRevision:0,_editId:'55555555-1234-1234-1234-123456789012'}).code,'EDIT_CONFLICT');
  assert.equal(call('restore',{id:'99999999-1234-1234-1234-123456789012',deletedAt:deleted.deletedAt,_expectedRevision:1}).ok,false);
});


test('changing payment party clears settlement and links only an explicit saved selection',()=>{
 const original={...newEntry(),party:'Old customer',partyId:'party-old',fullFinal:true,amount:'500',notes:'Keep this'};
 const typed=paymentPartySelection(original,'New name');assert.equal(typed.partyId,'');assert.equal(typed.fullFinal,false);assert.equal(typed.amount,'500');assert.equal(typed.notes,'Keep this');assert.equal(original.partyId,'party-old');
 const selected=paymentPartySelection(typed,'Saved customer','party-new');assert.equal(selected.partyId,'party-new');assert.equal(selected.party,'Saved customer');
 assert.equal(paymentPartySelection(original,'Old customer','party-old').fullFinal,true);
 assert.equal(paymentPartySelection(original,'').partyId,'');
});
