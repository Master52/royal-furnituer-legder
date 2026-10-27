import {acceptActionDialogs} from './action-dialog-helper.mjs';
import assert from 'node:assert/strict';
import {accountBackend,TEST_ACCESS_TOKEN} from '../helpers/accountBackend.js';
import {makeParty,makeInvoice} from '../../src/accounts.js';
import {localNow} from '../../src/ledger.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const backend=accountBackend(),endpoint='https://script.google.com/macros/s/TEST-ONLY/exec',date=localNow().slice(0,10),errors=[];
const party=makeParty({name:'Background edit customer',openingDate:'2026-01-01',openingBalance:'0',phone:'',address:''},'party-edit-ledger-000001');backend.post('createParty',party);
const original=backend.post('createInvoice',makeInvoice({partyId:party.id,type:'sale',invoiceDate:date,notes:'',items:[{description:'HANDLE',quantity:'1',rate:'100',cost:'50',discount:'0',billingUnit:'nos',measurementMode:'quantity',measurements:[]}]},'invoice-edit-ledger-00001')).record;
const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
await context.addInitScript(({endpoint,token})=>{localStorage.setItem('rf.endpoint',JSON.stringify(endpoint));sessionStorage.setItem('rf.access-token:'+endpoint,token);Object.defineProperty(navigator,'canShare',{configurable:true,value:data=>Boolean(data.files?.length)});Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.sharedLedger={text:data.text,files:data.files.map(file=>({name:file.name,type:file.type,size:file.size}))};}});},{endpoint,token:TEST_ACCESS_TOKEN});
let hold=true,release,reject=false,loseReply=false;
await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort());
await context.route('https://script.google.com/**',async route=>{
 const body=route.request().postDataJSON();
 if(body.action==='updateInvoice'&&hold)await new Promise(resolve=>{release=resolve;});
 if(body.action==='updateInvoice'&&reject){reject=false;await route.fulfill({json:{ok:false,error:'Invoice changed on another device',code:'CONFLICT',backendVersion:'1.28.0'}});return;}
 const result=backend.rawPost(body);
 if(body.action==='updateInvoice'&&loseReply){loseReply--;await route.abort('failed');return;}
 await route.fulfill({json:result});
});
const page=await context.newPage();await acceptActionDialogs(page,{});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
const popup=()=>page.locator('dialog[open]:not(.action-dialog)'),form=()=>page.locator('.invoice-form');
async function openEdit(){await page.locator('.sidebar').getByRole('button',{name:/Dashboard/}).click();await page.locator('.activity-open').first().click();await popup().getByRole('button',{name:'Edit Invoice',exact:true}).click();await form().waitFor();}
async function close(){await popup().getByRole('button',{name:'Close popup',exact:true}).click();}
try{
 await page.goto(process.env.LEDGER_TEST_URL||'http://127.0.0.1:5175');await page.locator('.activity-open').first().waitFor();await openEdit();
 await form().getByLabel('Item 1 billing unit').selectOption('box');await form().getByLabel('Quantity',{exact:true}).fill('2');await form().getByRole('button',{name:/Save changes/}).click();
 await popup().locator('.invoice-document').waitFor();assert.equal(backend.post('getInvoices',{ids:[original.id]}).invoices[0].revision,0);assert.match(await popup().innerText(),/uploading to Google Sheets/i);assert.match(await popup().locator('.invoice-document').innerText(),/2 BOX/);assert.match(await popup().locator('.invoice-document').innerText(),/200/);
 await close();await page.locator('.dashboard-actions').getByRole('button',{name:/New Invoice \/ Note/}).click();await form().waitFor();await close();
 await page.reload();await page.locator('.activity-open').first().click();await popup().locator('.invoice-document').waitFor();assert.match(await popup().locator('.invoice-document').innerText(),/2 BOX/);await close();
 hold=false;release();await page.waitForFunction(()=>!localStorage.getItem('rf.accounts.pending'));assert.equal(backend.post('getInvoices',{ids:[original.id]}).invoices[0].revision,1);
 // A lost acknowledgement keeps the exact edit for an idempotent retry.
 await openEdit();await form().getByLabel('Quantity',{exact:true}).fill('3');loseReply=2;await form().getByRole('button',{name:/Save changes/}).click();await popup().locator('.invoice-document').waitFor();await close();await page.locator('.sidebar').getByRole('button',{name:/Parties/}).click();await page.getByRole('button',{name:'Retry saved request',exact:true}).waitFor();await page.getByRole('button',{name:'Retry saved request',exact:true}).click();await page.waitForFunction(()=>!localStorage.getItem('rf.accounts.pending'));assert.equal(backend.post('getInvoices',{ids:[original.id]}).invoices[0].revision,2);
 // Rejected revisions remove the optimistic preview and keep recovery controls.
 await openEdit();await form().getByLabel('Quantity',{exact:true}).fill('4');reject=true;await form().getByRole('button',{name:/Save changes/}).click();await popup().locator('.invoice-document').waitFor();await close();await page.locator('.sidebar').getByRole('button',{name:/Parties/}).click();await page.getByRole('button',{name:'Discard rejected request',exact:true}).waitFor();await page.locator('.sidebar').getByRole('button',{name:/Dashboard/}).click();await page.locator('.activity-open').first().click();assert.match(await popup().locator('.invoice-document').innerText(),/3 BOX/);await close();await page.locator('.sidebar').getByRole('button',{name:/Parties/}).click();await page.getByRole('button',{name:'Discard rejected request',exact:true}).click();await page.waitForFunction(()=>!localStorage.getItem('rf.accounts.pending'));
 await page.locator('.sidebar').getByRole('button',{name:/Parties/}).click();await page.locator('.party-balance-row').first().click();await page.getByRole('button',{name:'Print Statement',exact:true}).click();await popup().getByRole('button',{name:'Share statement',exact:true}).click();await popup().getByRole('button',{name:'Share ledger',exact:true}).waitFor();assert.equal(await popup().getByRole('button',{name:'Share message',exact:true}).count(),0);await popup().getByRole('button',{name:'Share ledger',exact:true}).click();
 const shared=await page.evaluate(()=>window.sharedLedger);assert.equal(shared.text,undefined);assert.ok(shared.files.length>0);assert.ok(shared.files.every(file=>file.type==='image/png'&&file.size>1000));assert.ok(await popup().getByRole('link',{name:/Download/}).count());assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,scenarios:'slow background edit, BOX, navigation while uploading, reload recovery, lost acknowledgement retry, revision rejection, ledger attachments'}));
}catch(error){console.error(await page.locator('body').innerText());console.error(await page.evaluate(()=>localStorage.getItem('rf.accounts.pending')));throw error;}finally{await browser.close();}
