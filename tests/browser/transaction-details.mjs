// Read-only UI checks with a simulated Sheet; no real Google requests.
import assert from 'node:assert/strict';
import { accountBackend } from '../helpers/accountBackend.js';
import { makeTransaction, localNow } from '../../src/ledger.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const backend=accountBackend(),errors=[];
const base={dateTime:localNow(),category:'Sale',method:'Cash',direction:'in',party:'Detail customer',notes:'Delivery note\nSecond line',amount:'500',cashReceived:'600',cashChange:'70',onlineChange:'30'};
const records=[
  makeTransaction(base,'payment-detail-000000001'),
  makeTransaction({...base,category:'Purchase',direction:'out',method:'Cheque',party:'Cheque supplier',chequeDate:base.dateTime.slice(0,10),cashReceived:'',cashChange:'',onlineChange:''},'payment-detail-000000002'),
  makeTransaction({...base,recordType:'transfer',exchangeDirection:'receive-cash-send-online',amount:'25',notes:'Exchange note'},'payment-detail-000000003'),
  makeTransaction({...base,recordType:'adjustment',adjustmentMethod:'Cash',expectedCashMinor:50000,expectedOnlineMinor:20000,countedBalance:'480',notes:'Counted drawer'},'payment-detail-000000004'),
  makeTransaction({...base,category:'Expense',direction:'out',method:'Online',party:'',notes:'',amount:'10',cashReceived:'',cashChange:'',onlineChange:''},'payment-detail-000000005')
];
for(const record of records)assert.equal(backend.post('create',record).ok,true);
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
await context.addInitScript(()=>{const endpoint='https://script.google.com/macros/s/TEST-ONLY/exec';localStorage.setItem('rf.endpoint',JSON.stringify(endpoint));localStorage.setItem('rf.connectionInfo',JSON.stringify({endpoint,version:'1.8.1'}));});
let offline=false;
await context.route('https://script.google.com/**',async route=>{const body=route.request().postDataJSON();if(offline&&body?.action==='create'){await route.abort('failed');return;}await route.fulfill({json:body?backend.post(body.action,body.transaction):backend.context.doGet()});});
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());page.setDefaultTimeout(6000);
const popup=()=>page.locator('.transaction-detail-dialog');
const row=name=>page.locator('.activity-table tbody tr').filter({hasText:name}).filter(name==='Detail customer'?{hasText:'Payment received'}:{});
const close=()=>popup().getByRole('button',{name:'Close popup'}).click();
try{
  await page.goto(process.env.LEDGER_TEST_URL||'http://127.0.0.1:5175');
  await row('Detail customer').waitFor();
  await row('Detail customer').locator('td').nth(1).click();await popup().waitFor();
  assert.match(await popup().innerText(),/Payment received/);assert.match(await popup().innerText(),/₹500\.00/);
  assert.match(await popup().innerText(),/Cash received\s+₹600\.00/);assert.match(await popup().innerText(),/Cash change returned\s+₹70\.00/);assert.match(await popup().innerText(),/Online change returned\s+₹30\.00/);assert.match(await popup().innerText(),/Delivery note\nSecond line/);
  await popup().getByText('Record information',{exact:true}).click();assert.match(await popup().innerText(),/payment-detail-000000001/);
  await page.keyboard.press('Escape');await popup().waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
  await row('Cheque supplier').getByRole('button',{name:/View /}).focus();await page.keyboard.press('Enter');await popup().waitFor();assert.match(await popup().innerText(),/Payment made/);assert.match(await popup().innerText(),/Cheque given date/);assert.match(await popup().innerText(),new RegExp(base.dateTime.slice(0,10)));await close();
  await row('Cash/Online exchange').getByRole('button',{name:/View /}).click();assert.match(await popup().innerText(),/From\s+Online\s+To\s+Cash/);await close();
  await row('Balance adjustment').getByRole('button',{name:/View /}).click();assert.match(await popup().innerText(),/Cash expected\s+₹500\.00/);assert.match(await popup().innerText(),/Cash counted\s+₹480\.00/);assert.match(await popup().innerText(),/Cash adjustment\s+-₹20\.00/);await close();
  await row('Expense').locator('.activity-open').click();assert.match(await popup().innerText(),/No notes/);await close();
  // Existing actions operate independently of row clicks.
  await row('Detail customer').locator('.activity-open').click();await popup().locator('.record-menu>summary').click();await page.evaluate(()=>{window.print=()=>{window.printedPayment=document.querySelector('.account-print-output').innerText;window.dispatchEvent(new Event('afterprint'));};});await popup().getByRole('button',{name:'Print payment',exact:true}).click();await page.waitForFunction(()=>window.printedPayment);assert.match(await page.evaluate(()=>window.printedPayment),/Delivery note/);await close();
  await row('Detail customer').getByRole('button',{name:/Edit Payment/}).click();await page.locator('.payment-dialog').waitFor();assert.equal(await popup().count(),0);await page.locator('.payment-dialog').getByRole('button',{name:'Close popup'}).click();
  await row('Detail customer').locator('.record-menu>summary').click();await row('Detail customer').getByRole('button',{name:'Delete',exact:true}).click();await row('Detail customer').waitFor({state:'hidden'});assert.equal(await popup().count(),0);
  // History, mobile overflow and queued status after reload.
  await page.locator('.sidebar').getByRole('button',{name:/History/}).click();await page.setViewportSize({width:390,height:844});const amountBox=await page.locator('.activity-amount').first().boundingBox();assert.ok(amountBox.x>=0&&amountBox.x+amountBox.width<=390);await page.screenshot({path:'/tmp/activity-mobile-card.png',fullPage:true});await row('Cheque supplier').getByRole('button',{name:/View /}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await close();
  await page.emulateMedia({media:'print'});assert.equal(await row('Cheque supplier').getByRole('button',{name:/View /}).isVisible(),true);await page.emulateMedia({media:'screen'});
  const pending=makeTransaction({...base,party:'Offline payment',cashReceived:'',cashChange:'',onlineChange:''},'payment-detail-000000006');offline=true;
  await page.evaluate(record=>localStorage.setItem('rf.outbox',JSON.stringify([{...record,_action:'create',_queueId:'queue-detail-00000000001',_endpoint:'https://script.google.com/macros/s/TEST-ONLY/exec',_status:'failed',_error:'Simulated offline error'}])),pending);await page.reload();await row('Offline payment').getByRole('button',{name:/View /}).click();assert.match(await popup().innerText(),/Upload failed · saved on this device/);assert.match(await popup().innerText(),/Simulated offline error/);await close();
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,scenarios:['row click','keyboard','cash change','cheque','exchange','adjustment','empty notes','edit/delete independence','history','mobile','pending status'],errors}));
}finally{await browser.close();}
