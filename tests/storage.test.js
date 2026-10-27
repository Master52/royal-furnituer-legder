import test from 'node:test';
import assert from 'node:assert/strict';
import {saveAccountCache,loadAccountCache,clearEndpoint} from '../src/storage.js';

// Requests succeed before IndexedDB commits; quota errors can abort later.
function fakeDatabase(){
 let transaction,request,closed=false;
 const db={transaction(){transaction={objectStore:()=>({put:()=>request={},get:()=>request={},delete:()=>request={}})};return transaction;},close(){closed=true;}};
 globalThis.window={indexedDB:true};globalThis.indexedDB={open(){const opening={};queueMicrotask(()=>{opening.result=db;opening.onsuccess();});return opening;}};
 return {get transaction(){return transaction;},get request(){return request;},get closed(){return closed;}};
}
async function start(){await new Promise(resolve=>setImmediate(resolve));}
test('account cache waits for transaction commit and closes its database',async()=>{
 const fake=fakeDatabase();let saved=false;const promise=saveAccountCache('test',{invoices:[]},'today').then(()=>saved=true);
 await start();fake.request.result='stored';fake.request.onsuccess?.();await start();assert.equal(saved,false);fake.transaction.oncomplete();await promise;assert.equal(saved,true);assert.equal(fake.closed,true);
 delete globalThis.window;delete globalThis.indexedDB;
});
test('an aborted cache write rejects even after its request succeeds; failed cache reads stay recoverable',async()=>{
 const fake=fakeDatabase();const promise=saveAccountCache('test',{invoices:[]},'today');await start();fake.request.onsuccess?.();fake.transaction.error=new Error('Quota exceeded');fake.transaction.onabort();await assert.rejects(promise,/Quota exceeded/);assert.equal(fake.closed,true);
 const read=fakeDatabase();const loading=loadAccountCache('test');await start();read.transaction.onabort();assert.equal(await loading,null);assert.equal(read.closed,true);
 delete globalThis.window;delete globalThis.indexedDB;
});

test('disconnect rejects when IndexedDB aborts after localStorage has been cleared',async()=>{
 const fake=fakeDatabase();let removed=false;globalThis.localStorage={removeItem(){removed=true;}};
 const clearing=clearEndpoint();await start();fake.transaction.error=new Error('Quota error');fake.transaction.onabort();
 await assert.rejects(clearing,/completely removed/);assert.equal(removed,true);assert.equal(fake.closed,true);
 delete globalThis.window;delete globalThis.indexedDB;delete globalThis.localStorage;
});
test('disconnect rejects when localStorage removal fails despite a successful IndexedDB delete',async()=>{
 const fake=fakeDatabase();globalThis.localStorage={removeItem(){throw new Error('Blocked');}};
 const clearing=clearEndpoint();await start();fake.transaction.oncomplete();
 await assert.rejects(clearing,/completely removed/);assert.equal(fake.closed,true);
 delete globalThis.window;delete globalThis.indexedDB;delete globalThis.localStorage;
});

test('challan queue reads preserve storage failures instead of reporting an empty queue',async()=>{
 const {loadChallanQueue}=await import('../src/storage.js');const fake=fakeDatabase();const loading=loadChallanQueue('sheet');await start();fake.transaction.error=new Error('Photos inaccessible');fake.transaction.onabort();await assert.rejects(loading,/Photos inaccessible/);assert.equal(fake.closed,true);
 delete globalThis.window;delete globalThis.indexedDB;
});
test('challan photo enqueue only succeeds after its IndexedDB write commits',async()=>{
 const {mutateChallanQueue}=await import('../src/storage.js');const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{value:{locks:{request:async(name,task)=>task()}},configurable:true});
 try{
  const fake=fakeDatabase();let done=false;const photo={key:'stable-queue-key',action:'uploadChallanPhoto',payload:{id:'saved-photo-id',data:'/9j/PHOTO'}};
  const saving=mutateChallanQueue('sheet',rows=>[...rows,photo]).then(()=>done=true);
  await start();fake.request.result=[];fake.transaction.oncomplete();await start();fake.request.onsuccess?.();await start();assert.equal(done,false);
  fake.transaction.oncomplete();await saving;assert.equal(done,true);
 }finally{if(original)Object.defineProperty(globalThis,'navigator',original);else delete globalThis.navigator;delete globalThis.window;delete globalThis.indexedDB;}
});


test('saved manual photo deletions survive queue reload and malformed actions remain preserved',async()=>{
 const {loadChallanQueue}=await import('../src/storage.js');
 try{
  const operation={key:'delete-photos-key',action:'deleteChallanPhotos',payload:{id:'saved-challan-id'}};
  const fake=fakeDatabase(),loading=loadChallanQueue('sheet');await start();fake.request.result=[operation];fake.transaction.oncomplete();assert.deepEqual(await loading,[operation]);
  const invalid=fakeDatabase(),reading=loadChallanQueue('sheet');await start();invalid.request.result=[{...operation,action:'unknown'}];invalid.transaction.oncomplete();await assert.rejects(reading,/preserved/);
 }finally{delete globalThis.window;delete globalThis.indexedDB;}
});


test('recovery exports can read original malformed challan data without discarding it',async()=>{
 const {loadChallanRecovery}=await import('../src/storage.js');
 try{
  const fake=fakeDatabase(),raw=[{key:'original',action:'unknown',payload:{id:'photo',data:'original-image'}}],loading=loadChallanRecovery('sheet');
  await start();fake.request.result=raw;fake.transaction.oncomplete();assert.deepEqual(await loading,raw);
 }finally{delete globalThis.window;delete globalThis.indexedDB;}
});
