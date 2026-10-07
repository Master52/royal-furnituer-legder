import test from 'node:test';
import assert from 'node:assert/strict';
import {syncState} from '../src/syncState.js';
const base={endpoint:'sheet',synced:true,accounts:{loaded:true,queue:[]},stock:{queue:[]}};
test('mixed pending payment, invoice and stock changes are counted together; a failed request stays actionable',()=>{
 const input={...base,outbox:[{id:'payment',_endpoint:'sheet',_status:'uploading'}],accounts:{loaded:true,queue:[{action:'createInvoice',endpoint:'sheet',payload:{invoiceNumber:'RF-S-1'}}]},stock:{queue:[{action:'recordStock',payload:{id:'stock'}}]}};
 const saving=syncState(input);assert.equal(saving.title,'Saving 3 changes');assert.equal(saving.queued.length,3);assert.equal(saving.spinning,true);
 const failed=syncState({...input,stock:{queue:[{failed:true,action:'recordStock',payload:{id:'stock'}}]}});assert.equal(failed.title,'Sync needs attention');assert.equal(failed.tone,'error');assert.equal(failed.spinning,false);
});
test('offline records retain the saved-local count and failure details without claiming they are confirmed',()=>{
 const state=syncState({...base,online:false,outbox:[{id:'payment',_endpoint:'sheet',_status:'failed',_error:'Connection failed'}]});assert.equal(state.title,'Offline · 1 saved locally');assert.equal(state.queued[0].error,'Connection failed');assert.equal(state.failed,true);
});
test('cached records and read failures never show up-to-date status; disabled backends do not block legacy payments',()=>{
 assert.equal(syncState({...base,accounts:{loaded:true,cached:true}}).title,'Saved data · refresh needed');assert.equal(syncState({...base,readError:'Read failed'}).title,'Sync needs attention');assert.equal(syncState({...base,accountsEnabled:false,accounts:{loaded:false},stockEnabled:false,stock:{error:'Unsupported'}}).title,'Up to date');
});
test('pending work for another Sheet requires attention and duplicate connection errors appear once',()=>{
 const state=syncState({...base,outbox:[{id:'payment',_endpoint:'other'}],readError:'Unauthorized',accounts:{loaded:true,error:'Unauthorized'}});assert.equal(state.title,'Sync needs attention');assert.deepEqual(state.errors,['Unauthorized']);
});
