// Uses the existing Playwright installation and simulated Sheets only.
import assert from 'node:assert/strict';
import {accountBackend,TEST_ACCESS_TOKEN} from '../helpers/accountBackend.js';
import {makeTransaction,localNow} from '../../src/ledger.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const appUrl=process.env.LEDGER_TEST_URL||'http://127.0.0.1:5175';
const endpoint='https://script.google.com/macros/s/TEST-ONLY/exec';
const pending={...makeTransaction({amount:'10',direction:'in',category:'Sale',method:'Cash',party:'',notes:'',dateTime:localNow()},'reliability-payment-00001'),_endpoint:endpoint,_queueId:'reliability-payment-queue',_action:'create',_status:'queued'};
const backend=accountBackend(),errors=[],writes=[];
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
let writeGate=null,failAcknowledgementStorage=false,acknowledgementCalls=0;
await context.addInitScript(({endpoint,pending})=>{
  if(!localStorage.getItem('reliability-initialized')){
    localStorage.setItem('rf.endpoint',JSON.stringify(endpoint));
    localStorage.setItem('rf.connectionInfo',JSON.stringify({endpoint,version:'1.17.0'}));
    localStorage.setItem('rf.outbox',JSON.stringify([pending]));
    localStorage.setItem('reliability-initialized','true');
  }
},{endpoint,pending});
await context.route('https://script.google.com/**',async route=>{
  const body=route.request().postDataJSON();
  assert.equal(route.request().url(),endpoint);
  if(body.action==='create'){
    writes.push(body.transaction.id);
    if(writeGate)await writeGate;
  }
  const result=backend.rawPost(body);
  if(body.action==='createParty'&&body.transaction.name==='Ack failure party'){
    acknowledgementCalls++;
    if(failAcknowledgementStorage){
      failAcknowledgementStorage=false;
      await page.evaluate(()=>{
        const set=Storage.prototype.setItem,remove=Storage.prototype.removeItem;
        window.restoreQueueStorage=()=>{Storage.prototype.setItem=set;Storage.prototype.removeItem=remove;};
        Storage.prototype.setItem=function(key,value){if(key==='rf.accounts.pending')throw new Error('Simulated post-ack storage failure');return set.call(this,key,value);};
        Storage.prototype.removeItem=function(key){if(key==='rf.accounts.pending')throw new Error('Simulated post-ack storage failure');return remove.call(this,key);};
      });
    }
  }
  await route.fulfill({json:result});
});
const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
try{
  await page.goto(appUrl);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('rf.outbox'))[0]?._errorCode==='UNAUTHORIZED');
  assert.equal(backend.tabs.size,0);
  await page.locator('.sidebar').getByRole('button',{name:/Settings/}).click();
  await page.getByRole('button',{name:'Google Sheets setup'}).click();
  const settings=page.locator('.settings-dialog');
  await settings.getByLabel('Access token',{exact:true}).fill('incorrect-ledger-token-00000000000001');
  await settings.getByRole('button',{name:'Verify & save access token'}).click();
  await settings.getByRole('alert').filter({hasText:'correct ledger access token'}).waitFor();
  assert.equal(backend.tabs.size,0);
  await settings.getByLabel('Access token',{exact:true}).fill(TEST_ACCESS_TOKEN);
  await settings.getByRole('button',{name:'Verify & save access token'}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('rf.outbox')).length===0);
  assert.equal(backend.post('list').transactions.length,1);
  assert.ok(!JSON.stringify(await page.evaluate(()=>({...localStorage}))).includes(TEST_ACCESS_TOKEN));
  await settings.getByRole('button',{name:'Close dialog'}).click();
  await context.addInitScript(({endpoint,token})=>sessionStorage.setItem(`rf.access-token:${endpoint}`,token),{endpoint,token:TEST_ACCESS_TOKEN});
  const other=await context.newPage();other.setDefaultTimeout(10000);other.on('pageerror',error=>errors.push(error.message));other.on('dialog',dialog=>dialog.accept());
  await other.goto(appUrl);
  await other.locator('.dashboard-actions').getByRole('button',{name:/Record Payment/}).waitFor();
  let release;
  writeGate=new Promise(resolve=>{release=resolve;});
  await Promise.all([page,other].map(async(current,index)=>{
    await current.locator('.dashboard-actions').getByRole('button',{name:/Record Payment/}).click();
    await current.locator('.payment-dialog').getByLabel('Amount (₹)').fill(index===0?'11':'22');
    await current.locator('.payment-dialog').getByRole('button',{name:/Save payment/}).click();
    await current.locator('.payment-dialog').waitFor({state:'hidden'});
  }));
  const queue=await page.evaluate(()=>JSON.parse(localStorage.getItem('rf.outbox')));
  assert.equal(queue.length,2);assert.equal(new Set(queue.map(item=>item.id)).size,2);
  await other.locator('.sidebar').getByRole('button',{name:/Parties/}).click();
  await other.getByRole('button',{name:/Add Party/}).click();
  const partyDialog=other.locator('.account-party-dialog');
  await partyDialog.getByLabel('Name',{exact:true}).fill('Concurrent queue party');
  await partyDialog.getByRole('button',{name:'Save party',exact:true}).click();
  await other.waitForFunction(()=>JSON.parse(localStorage.getItem('rf.accounts.pending')||'{"queue":[]}').queue.length===1);
  writeGate=null;release();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('rf.outbox')).length===0);
  await other.waitForFunction(()=>!localStorage.getItem('rf.accounts.pending'));
  assert.equal(backend.post('listAccounts',{}).parties.length,1);
  const records=backend.post('list').transactions;
  assert.equal(records.length,3);assert.equal(records.reduce((sum,row)=>sum+Number(row.amountMinor),0),4300);
  for(const item of queue)assert.equal(writes.filter(id=>id===item.id).length,1);
  await other.close();
  await page.locator('.sidebar').getByRole('button',{name:/Parties/}).click();
  await page.getByRole('button',{name:/Add Party/}).click();
  await page.locator('.account-party-dialog').getByLabel('Name',{exact:true}).fill('Ack failure party');
  failAcknowledgementStorage=true;
  await page.locator('.account-party-dialog').getByRole('button',{name:'Save party',exact:true}).click();
  await page.locator('.account-party-dialog').getByRole('alert').filter({hasText:'post-ack storage failure'}).waitFor();
  await page.waitForTimeout(300);
  assert.equal(acknowledgementCalls,1);
  assert.equal(backend.post('listAccounts',{}).parties.filter(party=>party.name==='Ack failure party').length,1);
  assert.ok(await page.evaluate(()=>localStorage.getItem('rf.accounts.pending')));
  await page.evaluate(()=>window.restoreQueueStorage());
  await page.locator('.account-party-dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  await page.locator('.account-pending').getByRole('button',{name:'Retry saved request'}).click();
  await page.waitForFunction(()=>!localStorage.getItem('rf.accounts.pending'));
  assert.equal(backend.post('listAccounts',{}).parties.filter(party=>party.name==='Ack failure party').length,1);
  const recovery=await browser.newContext({serviceWorkers:'block'});
  await recovery.addInitScript(()=>localStorage.setItem('rf.outbox','[null]'));
  const broken=await recovery.newPage();
  await broken.goto(appUrl);
  await broken.getByRole('button',{name:'Export recovery data'}).waitFor();
  assert.equal(await broken.evaluate(()=>localStorage.getItem('rf.outbox')),'[null]');
  await recovery.close();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,scenarios:['unauthorized queue preserved','incorrect token rejected','authorization retries pending payment','secret excluded from local queues','simultaneous tabs preserve both payments','account queue progresses after payment uploads','one upload per queued payment','acknowledgement storage failure stops automatic retries','acknowledgement recovery preserves one party','malformed queue recovery'],errors}));
}catch(error){console.error(JSON.stringify({errors}));console.error(await page.locator('body').innerText());throw error;}finally{await browser.close();}
