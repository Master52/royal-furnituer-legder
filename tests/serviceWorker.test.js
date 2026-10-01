import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
function worker(fetch,caches){
 const listeners={};const self={registration:{scope:'https://ledger.test/'},location:{origin:'https://ledger.test'},addEventListener:(name,handler)=>listeners[name]=handler,skipWaiting:async()=>{},clients:{claim:async()=>{}}};
 vm.runInNewContext(source,{self,fetch,caches,URL,Response});
 return {async get(path,{mode='cors',destination='script'}={}){let result;const waits=[];listeners.fetch({request:{url:'https://ledger.test/'+path,method:'GET',mode,destination},respondWith:value=>result=value,waitUntil:value=>waits.push(value)});const response=await result;await Promise.all(waits);return response;},async install(){let result;listeners.install({waitUntil:value=>result=value});await result;}};
}
test('full or blocked offline storage does not break successful app requests or worker installation',async()=>{
 const app=worker(async()=>new Response('app code'),{open:async()=>{throw new Error('Quota exceeded');},match:async()=>{throw new Error('Storage blocked');}});
 assert.equal(await (await app.get('assets/app.js')).text(),'app code');assert.equal(await (await app.get('icons/logo.png',{destination:'image'})).text(),'app code');await app.install();
});
test('offline navigation without cached shell returns a readable response and missing assets return network errors',async()=>{
 const app=worker(async()=>{throw new Error('Offline');},{match:async()=>undefined});
 const navigation=await app.get('',{mode:'navigate'});assert.equal(navigation.status,503);assert.match(await navigation.text(),/Reconnect and reload/);assert.equal((await app.get('assets/app.js')).type,'error');
});
test('offline requests still use cached shell and code',async()=>{
 const app=worker(async()=>{throw new Error('Offline');},{match:async()=>new Response('cached app')});
 assert.equal(await (await app.get('',{mode:'navigate'})).text(),'cached app');assert.equal(await (await app.get('assets/app.js')).text(),'cached app');
});
