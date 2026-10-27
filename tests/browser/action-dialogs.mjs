import assert from 'node:assert/strict';
import {accountBackend,TEST_ACCESS_TOKEN} from '../helpers/accountBackend.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const backend=accountBackend(),endpoint='https://script.google.com/macros/s/TEST-ONLY/exec',native=[],errors=[];
backend.post('importStock',{id:'action-dialog-opening001',openingDate:'2026-01-01',items:[{id:'action-dialog-stock0001',name:'TEST STOCK',code:'',sourceId:'',baseUnit:'KG',secondaryUnit:'',conversion:'1',importUnit:'KG',quantity:'3',lowStock:'',saleRateUnit:'KG',purchaseRateUnit:'KG',saleRateMinor:100,purchaseRateMinor:50}]});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.addInitScript(({endpoint,token})=>{
  localStorage.setItem('rf.endpoint',JSON.stringify(endpoint));localStorage.setItem('rf.connectionInfo',JSON.stringify({endpoint,version:'1.29.0'}));sessionStorage.setItem('rf.access-token:'+endpoint,token);
 },{endpoint,token:TEST_ACCESS_TOKEN});
 await context.route('https://script.google.com/**',async route=>{const {action,transaction}=route.request().postDataJSON();await route.fulfill({json:backend.post(action,transaction)});});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>{native.push(dialog.type());dialog.dismiss();});
 await page.goto(process.env.LEDGER_TEST_URL||'http://127.0.0.1:5175');
 const payment=page.locator('.payment-dialog[open]'),decision=page.locator('.action-dialog[open]');
 await page.locator('.dashboard-actions [data-hotkey="alt+n"]').click();await payment.locator('#pos-amount').fill('110000');await payment.getByRole('button',{name:'Close popup'}).click();
 await payment.waitFor({state:'detached'});assert.equal(await decision.count(),0);
 await page.locator('.dashboard-actions [data-hotkey="alt+n"]').click();assert.equal(await payment.locator('#pos-amount').inputValue(),'110000');
 await page.keyboard.press('Alt+n');await decision.waitFor();assert.equal(await decision.locator('.action-cancel').evaluate(el=>el===document.activeElement),true);
 await page.keyboard.press('Escape');await decision.waitFor({state:'detached'});assert.equal(await payment.locator('#pos-amount').inputValue(),'110000');
 await page.keyboard.press('Alt+n');await decision.getByRole('button',{name:'Discard',exact:true}).click();await decision.waitFor({state:'detached'});assert.equal(await payment.locator('#pos-amount').inputValue(),'');
 await payment.getByRole('button',{name:'Close popup'}).click();await page.locator('.sidebar').getByRole('button',{name:/Stock/}).click();
 const remove=()=>page.locator('.stock-table button.stock-negative').first();
 await remove().click();await decision.getByRole('button',{name:'Go back',exact:true}).click();await decision.waitFor({state:'detached'});assert.equal(backend.post('listStock',{}).items.filter(item=>item.status!=='deleted').length,1);
 await remove().click();await decision.getByRole('button',{name:'Delete',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.stock-table tbody tr').length===0);assert.equal(backend.post('listStock',{}).items.filter(item=>item.status!=='deleted').length,0);
 assert.deepEqual(native,[]);assert.deepEqual(errors,[]);console.log('Action dialog checks passed: draft recovery, Escape, safe focus, cancelled and confirmed deletion, no native dialogs.');
}finally{await browser.close();}
