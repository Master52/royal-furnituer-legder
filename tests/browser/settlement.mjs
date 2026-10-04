// Uses simulated Sheets only and the existing optional Playwright installation.
import assert from 'node:assert/strict';
import {accountBackend} from '../helpers/accountBackend.js';
import {makeParty,makeInvoice,accountBalances} from '../../src/accounts.js';
import {makeTransaction} from '../../src/ledger.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const backend=accountBackend(),errors=[],calls=[];
const party=makeParty({name:'Settlement customer',phone:'123',address:'',openingDate:'2026-01-01',openingBalance:'0'},'settlement-party-00000001');backend.post('createParty',party);
const invoice=backend.post('createInvoice',makeInvoice({partyId:party.id,type:'sale',invoiceDate:'2026-10-31',notes:'',items:[{description:'Window',quantity:'1',rate:'16750',cost:'12000',discount:'0'}]},'settlement-invoice-000001')).record;
backend.post('create',makeTransaction({partyId:party.id,party:party.name,category:'Sale',direction:'in',method:'Cash',amount:'10000',dateTime:'2026-10-31T12:00'},'settlement-advance-000001'));
const supplier=makeParty({name:'Settlement supplier',phone:'',address:'',openingDate:'2026-01-01',openingBalance:'500',openingDirection:'payable'},'settlement-supplier-00001');backend.post('createParty',supplier);
const empty=makeParty({name:'Zero customer',phone:'',address:'',openingDate:'2026-01-01',openingBalance:'0'},'settlement-zero-000000001');backend.post('createParty',empty);
const concurrent=makeParty({name:'Concurrent settlement customer',phone:'',address:'',openingDate:'2026-01-01',openingBalance:'1000'},'settlement-race-000000001');backend.post('createParty',concurrent);
const legacy=makeParty({name:'Legacy backend customer',phone:'',address:'',openingDate:'2026-01-01',openingBalance:'100'},'settlement-legacy-0000001');backend.post('createParty',legacy);
const original=JSON.stringify(backend.tabs.get('Invoices').data);
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
await context.addInitScript(()=>{const endpoint='https://script.google.com/macros/s/TEST-ONLY/exec';localStorage.setItem('rf.endpoint',JSON.stringify(endpoint));localStorage.setItem('rf.connectionInfo',JSON.stringify({endpoint,version:'1.16.0'}));});
let losePayment=true,delayBalance=false,releaseBalance,delayCreate=false,releaseCreate,injectPayment=false,oldVersion=false;
await context.route('https://script.google.com/**',async route=>{
 const body=route.request().postDataJSON();calls.push(body||{action:'GET'});
 if(body?.action==='listAccounts'&&delayBalance){delayBalance=false;await new Promise(resolve=>{releaseBalance=resolve;});}
 if(body?.action==='create'&&delayCreate){delayCreate=false;await new Promise(resolve=>{releaseCreate=resolve;});}
 if(body?.action==='create'&&body.transaction.partyId===concurrent.id&&injectPayment){injectPayment=false;backend.post('create',makeTransaction({partyId:concurrent.id,party:concurrent.name,category:'Sale',direction:'in',method:'Cash',amount:'100',dateTime:'2026-11-05T11:00'},'settlement-concurrent-001'));}
 const result=body?backend.post(body.action,body.transaction):backend.context.doGet();
 if(body?.action==='create'&&losePayment){losePayment=false;await route.abort('failed');return;}
 await route.fulfill({json:oldVersion?{...result,backendVersion:'1.15.3'}:result});
});
const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
const dialog=()=>page.locator('dialog[open]');
const payment=()=>page.locator('.payment-dialog');
const balance=()=>payment().getByRole('status',{name:'Party balance'});
const discount=()=>payment().getByRole('status',{name:'Settlement discount'});
const checkbox=()=>payment().getByRole('checkbox',{name:'Full & final payment',exact:true});
const amount=()=>payment().locator('#pos-amount');
const save=()=>payment().locator('.entry-save .primary');
const partyInput=()=>payment().getByRole('combobox',{name:/Party \/ Payee/});
async function selectParty(record){await partyInput().fill(record.name);await payment().getByRole('option').filter({has:page.getByText(record.name,{exact:true})}).click();}

const range=async(start,end)=>{await page.getByLabel('Report period').selectOption('custom');await page.getByLabel('Start date').fill(start);await page.getByLabel('End date').fill(end);};
const open=async()=>{await page.locator(`tr[data-record-id="${invoice.id}"]`).getByRole('button',{name:/View Sales invoice/}).click();await dialog().locator('.invoice-document').waitFor();};
const close=()=>dialog().getByRole('button',{name:'Close popup',exact:true}).click();
const gross=()=>page.locator('.business-metrics article').filter({has:page.getByText('Gross profit',{exact:true})}).locator('strong');
try{
 await page.goto(process.env.LEDGER_TEST_URL||'http://127.0.0.1:5175');await page.locator('.business-metrics').waitFor();await range('2026-10-01','2026-10-31');await open();
 assert.equal(await dialog().getByRole('button',{name:'Full & final settlement',exact:true}).count(),0);
 await dialog().getByRole('button',{name:'Record Payment',exact:true}).click();await checkbox().waitFor();assert.equal(await checkbox().isChecked(),false);assert.equal(await payment().locator('[aria-pressed=true]').count(),0);assert.match(await balance().innerText(),/To receive from party[\s\S]*6,750/);
 assert.equal(await payment().getByLabel('Party account').count(),0);assert.equal(await payment().locator('input[data-shortcut=vendor]').count(),1);
 await partyInput().fill('Settlement');
 const positive=payment().getByRole('option').filter({has:page.getByText(party.name,{exact:true})});assert.match(await positive.innerText(),/\+₹6,750.00/);assert.equal(await positive.locator('[data-balance=positive]').count(),1);
 const negative=payment().getByRole('option').filter({has:page.getByText(supplier.name,{exact:true})});assert.match(await negative.innerText(),/−₹500.00/);assert.equal(await negative.locator('[data-balance=negative]').count(),1);
 await partyInput().fill('Name only test');await partyInput().press('Enter');assert.match(await payment().locator('.payment-party-link').innerText(),/Name only/);assert.equal(await balance().count(),0);assert.equal(await checkbox().count(),0);
 await partyInput().fill(party.name);await payment().getByRole('option',{name:/without linking a party/}).click();assert.equal(await balance().count(),0);assert.match(await payment().locator('.payment-party-link').innerText(),/Name only/);
 await selectParty(supplier);assert.match(await balance().innerText(),/To pay party[\s\S]*500/);assert.equal(await checkbox().count(),0);
 await selectParty(empty);assert.match(await balance().innerText(),/₹0/);assert.equal(await checkbox().count(),0);
 await partyInput().fill('');assert.equal(await balance().count(),0);assert.equal(await checkbox().count(),0);
 await selectParty(party);await checkbox().check();await amount().fill('6000');assert.match(await discount().innerText(),/₹750\.00/);assert.equal(await payment().getByRole('button',{name:/Cash Alt/}).getAttribute('aria-pressed'),'false');
 await amount().fill('7000');await payment().getByRole('alert').filter({hasText:'cannot exceed'}).waitFor();assert.equal(await save().isDisabled(),true);assert.equal(calls.filter(call=>call.action==='create').length,0);
 await amount().fill('6750');assert.match(await discount().innerText(),/₹0\.00/);await amount().fill('');assert.equal(await save().isDisabled(),true);
 await amount().fill('6000');await payment().getByRole('button',{name:/Cash Alt/}).click();await payment().getByRole('button',{name:'Change date',exact:true}).click();await payment().getByLabel('Transaction date & time').fill('2026-11-05T12:00');
 await page.setViewportSize({width:320,height:800});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await payment().evaluate(element=>element.scrollWidth>element.clientWidth),false);await page.screenshot({path:'/tmp/ledger-party-settlement-mobile.png'});await page.setViewportSize({width:1440,height:1000});
 // Slow verification preserves entries and never queues an unchecked settlement.
 delayBalance=true;await save().click();await payment().getByRole('alert').filter({hasText:'taking too long'}).waitFor({timeout:20000});assert.equal(await amount().inputValue(),'6000');assert.equal(calls.filter(call=>call.action==='create').length,0);releaseBalance();
 // Atomic outbox storage failure cannot queue a payment or a standalone waiver.
 await page.evaluate(()=>{window.originalSettlementSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='rf.outbox')throw new Error('Simulated quota');return window.originalSettlementSetItem.call(this,key,value);};});await save().click();await payment().getByRole('alert').filter({hasText:'upload queue'}).waitFor();assert.equal(calls.filter(call=>call.action==='create').length,0);assert.equal(await amount().inputValue(),'6000');await page.evaluate(()=>Storage.prototype.setItem=window.originalSettlementSetItem);
 delayCreate=true;await save().click();await payment().waitFor({state:'hidden'});await page.waitForFunction(()=>JSON.parse(localStorage.getItem('rf.outbox'))?.length===1);const queued=await page.evaluate(()=>JSON.parse(localStorage.getItem('rf.outbox'))[0]);assert.equal(queued.settlementDiscountMinor,75000);assert.equal(queued.amountMinor,600000);assert.equal(backend.post('listAccounts',{}).transactions.length,1);
 while(!releaseCreate)await page.waitForTimeout(20);releaseCreate();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('rf.outbox'))?.length===0);
 const data=backend.post('listAccounts',{});assert.equal(data.transactions.length,2);assert.equal(data.notes.length,0);assert.equal(accountBalances(data.parties,data.invoices,data.transactions,data.notes).find(row=>row.party.id===party.id).balance,0);assert.equal(JSON.stringify(backend.tabs.get('Invoices').data),original);const paymentCalls=calls.filter(call=>call.action==='create');assert.equal(paymentCalls.length,2);assert.deepEqual(paymentCalls[0],paymentCalls[1]);
 await page.getByRole('button',{name:'Show business profit',exact:true}).click();await range('2026-10-01','2026-10-31');assert.match(await gross().innerText(),/4,750/);
 await range('2026-11-01','2026-11-30');assert.match(await gross().innerText(),/-₹750/);assert.match(await page.locator('.profit-adjustment-summary').innerText(),/Already included/);
 await range('2026-10-01','2026-11-30');assert.match(await gross().innerText(),/4,000/);
 await page.locator(`tr[data-record-id="${queued.id}"]`).getByRole('button',{name:/View Full & final payment/}).click();assert.match(await dialog().innerText(),/Full & final discount[\s\S]*750/);assert.match(await dialog().innerText(),/Total party balance settled[\s\S]*6,750/);await close();
 await open();await dialog().getByRole('button',{name:'Record Payment',exact:true}).click();assert.match(await balance().innerText(),/₹0/);assert.equal(await checkbox().count(),0);await close();
 await page.locator(`tr[data-record-id="${queued.id}"]`).getByRole('button',{name:/Edit Full & final payment/}).click();assert.equal(await checkbox().isChecked(),true);assert.match(await balance().innerText(),/6,750/);await amount().fill('6200');assert.match(await discount().innerText(),/₹550\.00/);await save().click();await payment().waitFor({state:'hidden'});await page.waitForFunction(()=>JSON.parse(localStorage.getItem('rf.outbox'))?.length===0);assert.equal(backend.post('listAccounts',{}).transactions.find(row=>row.id===queued.id).settlementDiscountMinor,55000);
 await page.reload();await page.locator('.business-metrics').waitFor();await range('2026-10-01','2026-11-30');await page.locator(`tr[data-record-id="${queued.id}"]`).waitFor();
 // A competing payment rejects the whole settlement. Recovery keeps the final amount.
 await page.getByRole('button',{name:/Record Payment Alt/}).click();await selectParty(concurrent);await checkbox().check();await amount().fill('800');await payment().getByRole('button',{name:'Change date',exact:true}).click();await payment().getByLabel('Transaction date & time').fill('2026-11-05T12:00');injectPayment=true;
 await save().click();await payment().waitFor({state:'hidden'});await page.waitForFunction(()=>JSON.parse(localStorage.getItem('rf.outbox'))?.[0]?._errorCode==='EDIT_CONFLICT');
 await page.getByRole('button',{name:'Resolve payment upload',exact:true}).click();await payment().waitFor();assert.equal(await amount().inputValue(),'800.00');assert.match(await discount().innerText(),/₹100\.00/);
 await save().click();await payment().waitFor({state:'hidden'});await page.waitForFunction(()=>JSON.parse(localStorage.getItem('rf.outbox'))?.length===0);
 const confirmed=backend.post('listAccounts',{});assert.equal(confirmed.transactions.filter(row=>row.partyId===concurrent.id).length,2);assert.equal(accountBalances(confirmed.parties,confirmed.invoices,confirmed.transactions,confirmed.notes).find(row=>row.party.id===concurrent.id).balance,0);
 // Older deployments offer a clear upgrade message instead of accepting an unsupported waiver.
 oldVersion=true;await page.reload();await page.locator('.business-metrics').waitFor();await page.getByRole('button',{name:/Record Payment Alt/}).click();await selectParty(legacy);await page.waitForFunction(()=>document.querySelector('.full-final-toggle input')?.disabled);assert.match(await payment().innerText(),/Update the Sheet backend to 1\.16\.0/);await close();
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,receiptCount:data.transactions.length,noteCount:data.notes.length,errors}));
}catch(error){await page.screenshot({path:'/tmp/ledger-settlement-failure.png'});console.error(JSON.stringify({errors}));console.error(await page.locator('body').innerText());throw error;}finally{await browser.close();}
