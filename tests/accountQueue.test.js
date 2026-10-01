import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_QUEUE_KEY, operationKey, readAccountQueue, writeAccountQueue, queueLock } from '../src/accountQueue.js';
import { hasInvoiceDraft, invoiceDraftKey, readInvoiceDraft } from '../src/invoiceDraft.js';
import { blankInvoice } from '../src/accounts.js';

const storage=()=>{const data=new Map();return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};};
const operation={endpoint:'https://test/exec',action:'createParty',payload:{id:'party-001',name:'Example'}};
test('the default NOS unit alone does not create an empty resumable draft',()=>{
 const draft=blankInvoice();draft.items[0].billingUnit='nos';assert.equal(hasInvoiceDraft(draft),false);
 draft.items[0].description='WINDOW';assert.equal(hasInvoiceDraft(draft),true);
});

test('durable queue accepts old single requests and ordered dependent uploads without changing payloads',()=>{
  const store=storage();assert.deepEqual(readAccountQueue(store),[]);
  store.setItem(ACCOUNT_QUEUE_KEY,JSON.stringify(operation));assert.deepEqual(readAccountQueue(store),[operation]);
  const invoice={...operation,action:'createInvoice',payload:{id:'invoice-001',partyId:'party-001'}};
  writeAccountQueue(store,[operation,invoice]);assert.deepEqual(readAccountQueue(store),[operation,invoice]);
  writeAccountQueue(store,[]);assert.equal(store.getItem(ACCOUNT_QUEUE_KEY),null);
});

test('malformed queues remain recoverable and storage failures propagate instead of pretending to save',()=>{
  const store=storage();
  for(const raw of ['{broken','{"queue":{}}','{"queue":[null]}','{"queue":[{"action":"createInvoice"}]}']){
    store.setItem(ACCOUNT_QUEUE_KEY,raw);assert.equal(readAccountQueue(store)[0].invalid,true);assert.equal(store.getItem(ACCOUNT_QUEUE_KEY),raw);
  }
  const failed={...store,setItem(){throw new Error('Quota exceeded');}};
  assert.throws(()=>writeAccountQueue(failed,[operation]),/Quota/);
});

test('operation identity includes endpoint, action, record and edit attempt',()=>{
  const key=operationKey(operation);
  for(const change of [{endpoint:'https://other/exec'},{action:'updateParty'},{payload:{id:'party-002'}},{payload:{...operation.payload,_editId:'edit-001'}}])assert.notEqual(operationKey({...operation,...change}),key);
  assert.equal(operationKey({...operation,failure:{message:'offline'}}),key);
});

test('stored invoice drafts normalize legacy numeric inputs and remain isolated by endpoint',()=>{
  const store=storage(),draft=blankInvoice();draft.items[0]={description:'Wood',quantity:1.125,rate:10.01,discount:0};draft.notes='Keep me';
  store.setItem(invoiceDraftKey('A'),JSON.stringify(draft));
  const loaded=readInvoiceDraft(store,'A');assert.equal(loaded.error,'');assert.equal(loaded.draft.items[0].quantity,'1.125');assert.equal(loaded.draft.items[0].cost,'');assert.equal(loaded.draft.notes,'Keep me');
  assert.equal(readInvoiceDraft(store,'B').draft.items[0].description,'');assert.equal(JSON.parse(store.getItem(invoiceDraftKey('A'))).notes,'Keep me');
});

test('corrupted saved drafts cannot crash item rendering and retain a raw recovery copy',()=>{
  const store=storage(),key=invoiceDraftKey('A');
  for(const raw of ['{broken','{"items":null}','{"items":[]}','{"items":[null]}','{"items":[{"description":{}}]}','{"type":"invalid","items":[{}]}']){
    store.setItem(key,raw);const loaded=readInvoiceDraft(store,'A');assert.ok(loaded.error);assert.equal(loaded.draft.items.length,1);assert.equal(store.getItem(`${key}.recovery`),raw);
  }
});

test('resumable drafts include typed parties and edits, but fresh and cleared invoices stay blank',()=>{
  const draft=blankInvoice();assert.equal(hasInvoiceDraft(draft),false);
  for(const patch of [{partyId:'party-001'},{partyQuery:'New customer'},{notes:'Deliver tomorrow'},{type:'purchase'},{items:[{...draft.items[0],quantity:'2'}]},{items:[{...draft.items[0],rate:'0'}]}])assert.equal(hasInvoiceDraft({...draft,...patch}),true);
  assert.equal(hasInvoiceDraft({...draft,partyQuery:'   ',notes:' '}),false);
  const store=storage();store.setItem(invoiceDraftKey('A'),JSON.stringify({...draft,partyQuery:'Unselected party'}));
  assert.equal(readInvoiceDraft(store,'A').draft.partyQuery,'Unselected party');
});


test('queue locks abort blocked saves with a recoverable message and never run the mutation',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');let ran=false;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(name,options,task)=>{assert.equal(name,'rf.accounts.queue');assert.ok(options.signal instanceof AbortSignal);throw Object.assign(new Error('Lock aborted'),{name:'AbortError'});}}}});
  try{await assert.rejects(queueLock(()=>ran=true),/Another app tab is blocking local saving/);assert.equal(ran,false);}finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;}
});
