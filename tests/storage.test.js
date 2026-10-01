import test from 'node:test';
import assert from 'node:assert/strict';
import {saveAccountCache,loadAccountCache} from '../src/storage.js';

// Requests succeed before IndexedDB commits; quota errors can abort later.
function fakeDatabase(){
 let transaction,request,closed=false;
 const db={transaction(){transaction={objectStore:()=>({put:()=>request={},get:()=>request={}})};return transaction;},close(){closed=true;}};
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
