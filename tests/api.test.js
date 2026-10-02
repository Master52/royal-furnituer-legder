import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequest,REQUEST_TIMEOUT_MS} from '../src/api.js';
const endpoint='https://script.google.com/macros/s/test-deployment/exec';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
function fixture(responses){
 const calls=[],waits=[],timeouts=[];
 const request=createRequest({fetchImpl:async(url,options)=>{calls.push({url,options});const next=responses.shift();if(next instanceof Error)throw next;assert.ok(next,'Unexpected additional request');return next;},wait:async ms=>{waits.push(ms);},timeoutSignal:ms=>{timeouts.push(ms);return new AbortController().signal;}});
 return {request,calls,waits,timeouts};
}
test('slow or interrupted reads retry once with a longer deadline and no Google session dependency',async()=>{
 for(const error of [new DOMException('slow','TimeoutError'),new TypeError('Failed to fetch')]){
  const f=fixture([error,json({ok:true,transactions:[]})]);assert.equal((await f.request(endpoint)).ok,true);
  assert.equal(f.calls.length,2);assert.deepEqual(f.waits,[1500]);assert.deepEqual(f.timeouts,[60000,60000]);assert.equal(REQUEST_TIMEOUT_MS,60000);
  assert.ok(f.calls.every(call=>call.options.credentials==='omit'&&call.options.redirect==='follow'&&call.options.cache==='no-store'));
 }
});
test('ambiguous create and versioned edit retry the identical body and stable record IDs',async()=>{
 for(const action of ['create','createParty','createInvoice','createInvoiceNote','update','updateParty','updateInvoice','updateInvoiceNote']){
  const payload={id:'stable-record-id-000000001',_editId:'stable-edit-id-0000000001'};
  const f=fixture([new TypeError('lost acknowledgement'),json({ok:true,id:payload.id})]);await f.request(endpoint,payload,action);
  assert.equal(f.calls.length,2);assert.equal(f.calls[0].options.body,f.calls[1].options.body);assert.deepEqual(JSON.parse(f.calls[0].options.body),{action,transaction:payload});
 }
});
test('unversioned writes and unsupported actions never automatically repeat',async()=>{
 for(const action of ['update','cancelInvoice','delete','restore','unknown']){
  const f=fixture([new TypeError('network')]);await assert.rejects(f.request(endpoint,{id:'stable-record-id-000000001'},action),/interrupted/);assert.equal(f.calls.length,1);
 }
});
test('backend conflicts and validation errors never retry or lose their rejection code',async()=>{
 for(const code of ['EDIT_CONFLICT','REQUEST_FAILED']){
  const f=fixture([json({ok:false,code,error:'Invoice changed on another device.'})]);await assert.rejects(f.request(endpoint,{id:'stable-record-id-000000001'},'createInvoice'),error=>error.code===code);assert.equal(f.calls.length,1);
 }
});
test('temporary server and lock timeouts recover, but persistent failures stop after two attempts',async()=>{
 for(const response of [json({},503),json({},429),json({ok:false,code:'REQUEST_FAILED',error:'Lock wait timed out'})]){
  const f=fixture([response,json({ok:true,parties:[]})]);assert.equal((await f.request(endpoint,{summary:true},'listAccounts')).ok,true);assert.equal(f.calls.length,2);
 }
 const f=fixture([new DOMException('slow','TimeoutError'),new DOMException('slow','TimeoutError')]);await assert.rejects(f.request(endpoint),error=>error.retryable===true&&!error.code&&/too long/.test(error.message));assert.equal(f.calls.length,2);
});
test('Google login pages, permission failures and wrong deployment pages have actionable errors',async()=>{
 for(const response of [new Response('<html>Sign in to Google</html>'),json({},403),json({},401)]){
  const f=fixture([response]);await assert.rejects(f.request(endpoint),/permission|permission/i);assert.equal(f.calls.length,1);
 }
 const f=fixture([new Response('<html>Page missing</html>')]);await assert.rejects(f.request(endpoint),/deployed Apps Script URL/);assert.equal(f.calls.length,1);
});
test('malformed responses retry once, invalid ledger shapes fail clearly and invalid endpoints are not fetched',async()=>{
 const f=fixture([new Response('{truncated'),json({ok:true,transactions:[]})]);await f.request(endpoint);assert.equal(f.calls.length,2);
 for(const body of [null,[],{ok:true}]){
  const invalid=fixture([json(body)]);await assert.rejects(invalid.request(endpoint),/ledger/);assert.equal(invalid.calls.length,1);
 }
 const invalid=fixture([]);await assert.rejects(invalid.request('https://example.com/exec'));assert.equal(invalid.calls.length,0);
});
