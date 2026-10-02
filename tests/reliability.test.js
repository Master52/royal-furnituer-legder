import test from 'node:test';
import assert from 'node:assert/strict';
import {accountBackend,TEST_ACCESS_TOKEN} from './helpers/accountBackend.js';
import {makeTransaction} from '../src/ledger.js';
import {makeInvoice} from '../src/accounts.js';
import {readPaymentQueue,mutatePaymentQueue,PAYMENT_QUEUE_KEY,LEGACY_PAYMENT_KEY} from '../src/paymentQueue.js';
import {serializeRequest,createRequest} from '../src/api.js';
import {csvForTransactions} from '../src/preferences.js';
import {versionAtLeast} from '../src/version.js';

const endpoint='https://script.google.com/macros/s/test-deployment/exec';
function storage(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
const payment=id=>({...makeTransaction({amount:'10',direction:'in',category:'Sale',method:'Cash',party:'',notes:'',dateTime:'2026-09-01T12:00'},id),_endpoint:endpoint,_queueId:id,_status:'queued'});

test('all remote actions reject missing or wrong credentials before reading or writing the Sheet',()=>{
  const backend=accountBackend();
  for(const action of ['list','listDeleted','listAccounts','getInvoices','create','update','delete','restore','createParty','deleteInvoice']){
    for(const accessToken of [undefined,'incorrect']){
      const result=backend.rawPost({action,transaction:{},accessToken});
      assert.equal(result.code,'UNAUTHORIZED');assert.equal(result.ok,false);
    }
  }
  assert.equal(backend.context.doGet().code,'UNAUTHORIZED');
  assert.equal(backend.calls.length,0);assert.equal(backend.tabs.size,0);
  assert.equal(backend.rawPost({action:'list',accessToken:TEST_ACCESS_TOKEN}).ok,true);
});

test('API uses authenticated POST reads and never sends the secret in the URL',async()=>{
  let captured;
  const request=createRequest({fetchImpl:async(url,options)=>{captured={url,options};return new Response(JSON.stringify({ok:true,transactions:[]}));}});
  await request(endpoint,undefined,'list',{accessToken:TEST_ACCESS_TOKEN});
  assert.equal(captured.url,endpoint);assert.equal(captured.options.method,'POST');
  assert.equal(JSON.parse(captured.options.body).accessToken,TEST_ACCESS_TOKEN);
});

test('concurrent queue additions and acknowledgement preserve other tabs payments',async()=>{
  const store=storage();let tail=Promise.resolve();
  const lock=task=>{const result=tail.then(task);tail=result.catch(()=>{});return result;};
  await Promise.all(['payment-a','payment-b'].map(id=>mutatePaymentQueue(store,queue=>[...queue,payment(id)],lock)));
  assert.deepEqual(readPaymentQueue(store).map(item=>item.id),['payment-a','payment-b']);
  await Promise.all([
    mutatePaymentQueue(store,queue=>queue.filter(item=>item.id!=='payment-a'),lock),
    mutatePaymentQueue(store,queue=>[...queue,payment('payment-c')],lock)
  ]);
  assert.deepEqual(readPaymentQueue(store).map(item=>item.id),['payment-b','payment-c']);
});

test('malformed stored payments remain intact and cannot be overwritten by a new save',async()=>{
  const store=storage();
  for(const raw of ['{broken','{}','[null]','[{"id":"missing-fields"}]']){
    store.setItem(PAYMENT_QUEUE_KEY,raw);
    assert.throws(()=>readPaymentQueue(store),/unreadable|invalid/);
    await assert.rejects(mutatePaymentQueue(store,queue=>[...queue,payment('new')],task=>Promise.resolve().then(task)),/unreadable|invalid/);
    assert.equal(store.getItem(PAYMENT_QUEUE_KEY),raw);
  }
});

test('invalid or duplicate queue identities cannot remove multiple payments accidentally',()=>{
  const store=storage();
  for(const values of [[{...payment('payment-a'),_queueId:{}}],[payment('payment-a'),{...payment('payment-b'),_queueId:'payment-a'}]]){
    const raw=JSON.stringify(values);store.setItem(PAYMENT_QUEUE_KEY,raw);
    assert.throws(()=>readPaymentQueue(store),/identities/);assert.equal(store.getItem(PAYMENT_QUEUE_KEY),raw);
  }
});

test('legacy migration keeps a stable identity and removes legacy data only after a successful write',async()=>{
  const store=storage(),legacy=payment('legacy-payment');delete legacy._queueId;
  store.setItem(LEGACY_PAYMENT_KEY,JSON.stringify(legacy));
  assert.equal(readPaymentQueue(store)[0]._queueId,readPaymentQueue(store)[0]._queueId);
  const failing={...store,setItem(){throw new Error('Quota exceeded');}};
  await assert.rejects(mutatePaymentQueue(failing,queue=>queue,task=>Promise.resolve().then(task)),/Quota/);
  assert.ok(store.getItem(LEGACY_PAYMENT_KEY));
  await mutatePaymentQueue(store,queue=>queue,task=>Promise.resolve().then(task));
  assert.equal(store.getItem(LEGACY_PAYMENT_KEY),null);assert.equal(readPaymentQueue(store).length,1);
});

test('valid large measurement invoices are rejected locally before uploading',async()=>{
  const invoice=makeInvoice({partyId:'party-measured-0000000001',type:'sale',invoiceDate:'2026-09-01',notes:'',items:Array.from({length:50},(_,index)=>({description:`WINDOW ${index}`,billingUnit:'sqft',measurementUnit:'inches',measurementMode:'dimensions',grouped:true,quantity:'1',rate:'350',discount:'0',cost:'200',measurements:Array.from({length:20},()=>({description:'X'.repeat(150),length:'36',width:'36',pieces:'1',quantity:'1'}))}))},'invoice-measured-00000001');
  let called=false;
  const request=createRequest({fetchImpl:async()=>{called=true;throw new Error('Must not fetch');}});
  assert.throws(()=>serializeRequest(endpoint,invoice,'createInvoice',TEST_ACCESS_TOKEN),/too much detail/);
  await assert.rejects(request(endpoint,invoice,'createInvoice'),/too much detail/);
  assert.equal(called,false);
});

test('settlement CSV retains noncash discounts and still escapes spreadsheet formulas',()=>{
  const csv=csvForTransactions([{...payment('settled'),party:'=DANGEROUS()',settlementDiscountMinor:75000}]);
  assert.match(csv,/settlementDiscountMinor/);assert.match(csv,/"75000"/);assert.match(csv,/"'=DANGEROUS\(\)"/);
});

test('version comparisons reject malformed and overflowing versions',()=>{
  assert.equal(versionAtLeast('1.17.0','1.16.0'),true);assert.equal(versionAtLeast('1.8','1.8.0'),true);
  for(const version of ['next','',null,'9'.repeat(500)])assert.equal(versionAtLeast(version,'1.0'),false);
});
