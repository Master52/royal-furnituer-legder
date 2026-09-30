import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request } from './api.js';
import { accountBalances } from './accounts.js';
import { loadAccountCache, saveAccountCache } from './storage.js';
const EMPTY_ACCOUNTS = {parties:[],invoices:[],transactions:[]};
import { ACCOUNT_QUEUE_KEY, operationKey, readAccountQueue, writeAccountQueue, queueLock, uploadLock } from './accountQueue.js';
export default function useAccounts(endpoint, enabled) {
  const [snapshot,setSnapshot] = useState(null);
  const [busy,setBusy] = useState(false);
  const [refreshing,setRefreshing] = useState(false);
  const [mutationError,setError] = useState('');
  const [readError,setReadError] = useState('');
  const [queue,setQueue] = useState(()=>readAccountQueue(localStorage));
  const pending=queue[0]||null;
  const [rejected,setRejected] = useState(false);
  const [lastInvoice,setLastInvoice] = useState(null);
  const queueRef=useRef(queue);queueRef.current=queue;
  function syncQueue(next){queueRef.current=next;setQueue(next);}
  async function updateQueue(change){
    return queueLock(()=>{const current=readAccountQueue(localStorage);if(current.some(item=>item.invalid))throw new Error('The saved upload queue needs recovery.');const next=change(current);writeAccountQueue(localStorage,next);syncQueue(next);return next;});
  }
  const error=mutationError||pending?.failure?.message||readError;
  const active = useRef(endpoint); active.current=endpoint;
  const working=useRef(false);
  const inFlight=useRef(null);
  const generation=useRef(0);
  const lastAppliedRead=useRef(0);
  const snapshotRef=useRef(snapshot);snapshotRef.current=snapshot;
  const loaded=Boolean(enabled && snapshot?.endpoint===endpoint);
  const data=loaded?snapshot.data:EMPTY_ACCOUNTS;
  const checkedAt=loaded?snapshot.savedAt:'';
  const cached=loaded && snapshot.cached;
  const reload = useCallback(async (options = {}) => {
    if (!endpoint || !enabled) return null;
    const currentGeneration=generation.current;
    const previous=inFlight.current;
    if(previous?.endpoint===endpoint && previous.generation===currentGeneration){
      // Background readers share a request. A mutation/print requires a read
      // started after the earlier request, so it cannot confirm an old snapshot.
      if(!options.fresh)return previous.promise;
      await previous.promise;
      if(active.current!==endpoint || generation.current!==currentGeneration)return null;
      return reload({fresh:true});
    }
    const appliedBeforeRead=lastAppliedRead.current;
    const flight={endpoint,generation:currentGeneration,promise:null};
    setRefreshing(true);
    flight.promise=(async()=>{
      try {
        const result=await request(endpoint,{},'listAccounts');
        if (!Array.isArray(result.parties) || !Array.isArray(result.invoices) || !Array.isArray(result.transactions)) throw new Error('Update the test Sheet to Code.gs 1.7.0 or newer and deploy a new version.');
        if(active.current!==endpoint || generation.current!==currentGeneration)return null;
        if(lastAppliedRead.current!==appliedBeforeRead){flight.stale=true;return snapshotRef.current?.data||null;}
        const savedAt=new Date().toISOString();
        const next={endpoint,data:result,savedAt,cached:false};
        lastAppliedRead.current++;snapshotRef.current=next;setSnapshot(next);setReadError('');
        saveAccountCache(endpoint,result,savedAt).catch(()=>{});
        return result;
      } catch(e) {
        if(active.current===endpoint && generation.current===currentGeneration)setReadError(e.message);
        return null;
      } finally {
        if(inFlight.current===flight){inFlight.current=null;setRefreshing(false);}
      }
    })();
    inFlight.current=flight;
    const result=await flight.promise;
    if(options.fresh&&flight.stale&&active.current===endpoint&&generation.current===currentGeneration)return reload({fresh:true});
    return result;
  },[endpoint,enabled]);
  useEffect(()=>{
    const currentGeneration=++generation.current;
    inFlight.current=null;setRefreshing(false);setSnapshot(null);snapshotRef.current=null;setLastInvoice(null);setReadError('');setError('');
    if(!endpoint || !enabled)return;
    const readBeforeCache=lastAppliedRead.current;
    loadAccountCache(endpoint).then(saved=>{
      if(saved && generation.current===currentGeneration && active.current===endpoint && lastAppliedRead.current===readBeforeCache){
        const next={endpoint,...saved,cached:true};snapshotRef.current=next;setSnapshot(next);
      }
    });
    reload();
    return()=>{generation.current++;};
  },[endpoint,enabled,reload]);
  const refreshIfStale=useCallback(()=>{
    const current=snapshotRef.current;
    if(!current || current.endpoint!==endpoint || current.cached || Date.now()-Date.parse(current.savedAt)>60000) return reload();
    return Promise.resolve(current.data);
  },[endpoint,reload]);
  function applyRecord(action,record){
    const current=snapshotRef.current;
    if(!current||current.endpoint!==endpoint||!record?.id)return false;
    const collection=action.includes('Party')?'parties':'invoices';
    const previous=current.data[collection].find(item=>item.id===record.id);
    const value={...previous,...record};
    if(collection==='invoices'&&!Array.isArray(value.items))return false;
    const next={...current,data:{...current.data,[collection]:[...current.data[collection].filter(item=>item.id!==value.id),value]}};
    lastAppliedRead.current++;snapshotRef.current=next;setSnapshot(next);
    saveAccountCache(endpoint,next.data,next.savedAt).catch(()=>{});
    return true;
  }
  async function send(operation){
    if(!operation||working.current)return false;
    if(!enabled||operation.endpoint!==endpoint||operation.invalid){setError('Reconnect the original Sheet and update its backend before retrying this saved request.');return false;}
    working.current=true;setBusy(true);setRejected(false);setError('');
    try{return await uploadLock(async()=>{
      // Another tab may already have completed this operation.
      const current=readAccountQueue(localStorage);syncQueue(current);
      if(!current[0]||operationKey(current[0])!==operationKey(operation))return false;
      let acknowledged=false;
      try{
        const result=await request(operation.endpoint,operation.payload,operation.action);
        if(result.id!==operation.payload.id)throw new Error('The server did not confirm this record. Retry the saved request.');
        acknowledged=true;
        if(active.current!==operation.endpoint)return false;
        let record=result.record;
        if(!applyRecord(operation.action,record)){
          const refreshed=await reload({fresh:true});
          record=operation.action.includes('Party')?refreshed?.parties.find(item=>item.id===operation.payload.id):refreshed?.invoices.find(item=>item.id===operation.payload.id);
          if(!record)throw new Error('Upload was acknowledged. Retry to confirm the saved record.');
        }
        if(operation.action==='createInvoice')setLastInvoice({id:record.id,number:record.invoiceNumber});
        await updateQueue(items=>items.filter(item=>operationKey(item)!==operationKey(operation)));
        return true;
      }catch(error){
        const failure={message:error.message,rejected:!acknowledged&&Boolean(error.code)};
        setRejected(failure.rejected);setError(failure.message);
        try{await updateQueue(items=>items.map(item=>operationKey(item)===operationKey(operation)?{...item,failure}:item));}catch{/* Keep the original durable request if storage is full. */}
        return false;
      }
    });}finally{working.current=false;setBusy(false);}
  }
  const canQueue=enabled && Boolean(endpoint) && loaded && !rejected && !queue.some(item=>item.failure?.rejected) && queue.every(item=>item.endpoint===endpoint&&!item.invalid&&['createParty','createInvoice'].includes(item.action));
  async function enqueue(action,payload){
    if(!canQueue)return false;
    const operation={endpoint,action,payload};
    try{await updateQueue(items=>{if(items.some(item=>item.failure?.rejected||item.endpoint!==endpoint||!['createParty','createInvoice'].includes(item.action)))throw new Error('Resolve the saved request before adding another record.');return items.some(item=>operationKey(item)===operationKey(operation))?items:[...items,operation];});}
    catch{setError('Browser storage is unavailable. The record was not queued.');return false;}
    if(!pending){setError('');setRejected(false);}
    return true;
  }
  // Dependent invoices wait until their newly created party is confirmed.
  useEffect(()=>{
    if(pending && !pending.failure && ['createParty','createInvoice'].includes(pending.action) && pending.endpoint===endpoint && enabled && !pending.invalid)send(pending);
  },[pending,endpoint,enabled]);
  useEffect(()=>{
    const online=()=>{const operation=queueRef.current[0];if(operation&&!operation.failure?.rejected&&['createParty','createInvoice'].includes(operation.action))send(operation);};
    window.addEventListener('online',online);return()=>window.removeEventListener('online',online);
  });
  async function save(action,payload){
    if(queueRef.current.length || working.current)return false;
    const operation={endpoint,action,payload};
    try{await updateQueue(items=>{if(items.length)throw new Error('Another request is already queued.');return [operation];});}catch{setError('Browser storage is unavailable. The record was not sent.');return false;}
    return send(operation);
  }
  async function discardRejected() {
    if (!rejected || busy || working.current) return;
    working.current=true;setBusy(true);
    try {
      const snapshot=await reload({fresh:true});
      if(!snapshot)return;
      const {action,payload}=pending;
      const existing=action.includes('Party')?snapshot.parties.find(row=>row.id===payload.id):snapshot.invoices.find(row=>row.id===payload.id);
      const mayHaveSaved=(action==='createParty'||action==='createInvoice')?Boolean(existing):action==='updateParty'?existing?.lastEditId===payload._editId:existing?.status==='cancelled';
      if(mayHaveSaved){setError('This record exists in Google Sheets. Retry the saved request to confirm it before continuing.');return;}
      if(action==='createParty' && queueRef.current.some(item=>item.action==='createInvoice'&&item.payload.partyId===payload.id)){setError('An invoice is waiting for this party. Correct the rejected party before retrying.');return;}
      await updateQueue(items=>items.filter(item=>operationKey(item)!==operationKey(pending)));setRejected(false);setError('');return true;
    } catch {setError('Could not safely clear the rejected request. Retry it before continuing.');}
    finally {working.current=false;setBusy(false);}
  }
  async function correctRejectedParty(payload){
    if(!rejected || busy || working.current || pending?.action!=='createParty' || payload.id!==pending.payload.id)return false;
    working.current=true;setBusy(true);
    try{
      const refreshed=await reload({fresh:true});
      if(!refreshed)return false;
      if(refreshed.parties.some(item=>item.id===payload.id)){setError('This party exists in Google Sheets. Retry its original upload to confirm it.');return false;}
      await updateQueue(items=>items.map(item=>operationKey(item)===operationKey(pending)?{...item,payload,failure:undefined}:item));setRejected(false);setError('');return true;
    }catch{setError('Could not save the corrected party request. The original request is still kept.');return false;}
    finally{working.current=false;setBusy(false);}
  }
  useEffect(()=>{setRejected(Boolean(pending?.failure?.rejected));},[pending]);
  useEffect(()=>{
    const changed=event=>{if(event.key!==ACCOUNT_QUEUE_KEY)return;syncQueue(readAccountQueue(localStorage));reload();};
    window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);
  },[reload]);
  const queuedHere=useMemo(()=>queue.filter(item=>item.endpoint===endpoint&&!item.invalid),[queue,endpoint]);
  const selectableParties=useMemo(()=>[...data.parties,...queuedHere.filter(item=>item.action==='createParty'&&!data.parties.some(p=>p.id===item.payload.id)).map(item=>({...item.payload,_pending:true}))],[data.parties,queuedHere]);
  const pendingInvoices=useMemo(()=>queuedHere.filter(item=>item.action==='createInvoice'&&!data.invoices.some(inv=>inv.id===item.payload.id)).map(item=>({...item.payload,invoiceNumber:'Pending RF number',status:'pending',_pending:true})),[queuedHere,data.invoices]);
  const partyBalances=useMemo(()=>accountBalances(data.parties,data.invoices,data.transactions),[data.parties,data.invoices,data.transactions]);
  return {...data,partyBalances,selectableParties,pendingInvoices,queue,canQueue,loaded,busy,refreshing,cached,error,pending,rejected,checkedAt,lastInvoice,reload,refreshIfStale,save,queueInvoice:payload=>enqueue('createInvoice',payload),queueParty:payload=>enqueue('createParty',payload),retry:()=>send(pending),discardRejected,correctRejectedParty};
}
