import test from 'node:test';
import assert from 'node:assert/strict';
import {accountBackend,TEST_ACCESS_TOKEN} from './helpers/accountBackend.js';
import {accessTokenKey,readAccessToken,accessIsRemembered,saveAccessToken,forgetAccessToken,verifyAccess,createRequest} from '../src/api.js';
import {recordRequestTiming,requestTimingReport} from '../src/requestTimings.js';
const endpoint='https://script.google.com/macros/s/access-test/exec';
const store=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),clear:()=>values.clear()};};
async function withStorage(callback){const previous={local:globalThis.localStorage,session:globalThis.sessionStorage};globalThis.localStorage=store();globalThis.sessionStorage=store();try{await callback();}finally{if(previous.local===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous.local;if(previous.session===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=previous.session;}}

test('remembered access survives a new session, stays scoped to its deployment and can be forgotten',()=>withStorage(()=>{
 saveAccessToken(endpoint,TEST_ACCESS_TOKEN,true);assert.equal(accessIsRemembered(endpoint),true);sessionStorage.clear();assert.equal(readAccessToken(endpoint),TEST_ACCESS_TOKEN);assert.equal(readAccessToken(endpoint.replace('access-test','other-test')),'');
 sessionStorage.setItem(accessTokenKey(endpoint),'stale-session-token');assert.equal(readAccessToken(endpoint),TEST_ACCESS_TOKEN);
 forgetAccessToken(endpoint);assert.equal(readAccessToken(endpoint),'');assert.equal(accessIsRemembered(endpoint),false);
 saveAccessToken(endpoint,TEST_ACCESS_TOKEN,false);assert.equal(accessIsRemembered(endpoint),false);assert.equal(readAccessToken(endpoint),TEST_ACCESS_TOKEN);sessionStorage.clear();assert.equal(readAccessToken(endpoint),'');
}));
test('lightweight verification rejects wrong access and never reads or creates Sheet tabs',()=>{
 const b=accountBackend();assert.equal(b.rawPost({action:'verifyAccess',accessToken:'incorrect'}).code,'UNAUTHORIZED');const result=b.post('verifyAccess',{});assert.equal(result.ok,true);assert.equal(result.accessVerified,true);assert.equal(result.performance.reads,0);assert.equal(result.performance.writes,0);assert.equal(result.performance.lockWaitMs,0);assert.equal(b.tabs.size,0);
});
test('verification falls back only for older unsupported deployments, never for wrong tokens or network errors',async()=>{
 let calls=[];const send=async(...args)=>{calls.push(args);if(args[2]==='verifyAccess')throw new Error('Unsupported action. Update the Apps Script deployment.');return {ok:true,transactions:[]};};await verifyAccess(endpoint,TEST_ACCESS_TOKEN,send);assert.deepEqual(calls.map(row=>row[2]),['verifyAccess','list']);
 for(const message of ['Wrong token','Connection interrupted']){calls=[];await assert.rejects(verifyAccess(endpoint,TEST_ACCESS_TOKEN,async(...args)=>{calls.push(args);throw new Error(message);}),new RegExp(message));assert.equal(calls.length,1);}
});
test('an old unauthorized response uses newly verified access even after a transport retry',()=>withStorage(async()=>{
 saveAccessToken(endpoint,'old-token',false);let calls=0;const bodies=[];
 const send=createRequest({wait:async()=>saveAccessToken(endpoint,TEST_ACCESS_TOKEN,true),fetchImpl:async(url,options)=>{bodies.push(JSON.parse(options.body));calls++;if(calls===1)throw new TypeError('Interrupted');return new Response(JSON.stringify(calls===2?{ok:false,code:'UNAUTHORIZED',error:'Old token'}:{ok:true,transactions:[]}));}});
 assert.equal((await send(endpoint)).ok,true);assert.equal(calls,3);assert.equal(bodies[2].accessToken,TEST_ACCESS_TOKEN);
}));
test('timing reports include only timing metadata, cap history and exclude secrets and record data',()=>{
 for(let i=0;i<35;i++)recordRequestTiming(endpoint,{action:'listAccounts',durationMs:1200,attempt:1,status:'success',result:{backendVersion:'1.26.0',performance:{elapsedMs:500,lockWaitMs:100,reads:3,readMs:350,token:TEST_ACCESS_TOKEN},transactions:[{party:'Secret customer',amountMinor:10000}],accessToken:TEST_ACCESS_TOKEN}});
 const report=requestTimingReport(endpoint),data=JSON.parse(report);assert.equal(data.requests.length,30);assert.equal(data.requests[0].backend.readMs,350);assert.equal(data.requests[0].durationMs,1200);assert.doesNotMatch(report,/Secret customer|amountMinor|https:|accessToken|test-ledger-access/);
});
