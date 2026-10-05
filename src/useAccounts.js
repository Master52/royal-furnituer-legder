import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request, serializeRequest, ACCESS_CHANGED_EVENT } from './api.js';
import { accountBalances } from './accounts.js';
import { loadAccountCache, saveAccountCache } from './storage.js';
const EMPTY_NOTES=[];
const EMPTY_ACCOUNTS = {catalogue:[],parties:[],invoices:[],transactions:[],notes:[]};
import { ACCOUNT_QUEUE_KEY, operationKey, readAccountQueue, writeAccountQueue, queueLock, uploadLock } from './accountQueue.js';
export default function useAccounts(endpoint, enabled) {
  const [snapshot,setSnapshot] = useState(null);
  const [busy,setBusy] = useState(false);
  const [refreshing,setRefreshing] = useState(false);
  const [mutationError,setError] = useState('');
  const [catalogueWarning,setCatalogueWarning]=useState('');
  useEffect(()=>setCatalogueWarning(''),[endpoint]);
  const [readError,setReadError] = useState('');
  const [queue,setQueue] = useState(()=>readAccountQueue(localStorage));
  const pending=queue[0]||null;
  const [rejected,setRejected] = useState(false);
  const [lastInvoice,setLastInvoice] = useState(null);
  const [uploadTick,setUploadTick] = useState(0);
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
        const result=await request(endpoint,{summary:true},'listAccounts');
        if (!Array.isArray(result.parties) || !Array.isArray(result.invoices) || !Array.isArray(result.transactions)) throw new Error('Update the test Sheet to Code.gs 1.7.0 or newer and deploy a new version.');
        if(active.current!==endpoint || generation.current!==currentGeneration)return null;
        if(lastAppliedRead.current!==appliedBeforeRead){flight.stale=true;return snapshotRef.current?.data||null;}
        const savedAt=new Date().toISOString();
        // Summary reads invalidate old line items, including direct Sheet edits
        // that retain the same revision. Open documents fetch details on demand.
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
  const detailFlights=useRef(new Map());
  async function loadInvoiceDetails(ids,{fresh=false}={}){
    const generationAtStart=generation.current,target=endpoint;
    const current=snapshotRef.current;
    if(!current||current.endpoint!==target)throw new Error('Refresh your Sheet connection before loading invoice details.');
    const currentById=new Map(current.data.invoices.map(record=>[record.id,record]));
    const version=String(current?.data.backendVersion||'').split('.').map(Number);
    const supportsDetails=version[0]>1||version[0]===1&&version[1]>=13;
    if(!supportsDetails){const records=ids.map(id=>currentById.get(id));if(records.every(record=>Array.isArray(record?.items)))return records;throw new Error('Refresh your Sheet connection to load invoice details.');}
    ids=[...new Set(ids)];
    const missing=ids.filter(id=>fresh||!Array.isArray(currentById.get(id)?.items));
    if(!missing.length)return ids.map(id=>currentById.get(id));
    const key=generationAtStart+':'+target+':'+[...new Set(missing)].sort().join('|');
    const previous=detailFlights.current.get(key);
    if(previous){
      if(!fresh)return previous;
      try{await previous;}catch{/* A fresh read can recover a failed earlier read. */}
      if(active.current!==target||generation.current!==generationAtStart)throw new Error('The Sheet connection changed.');
      return loadInvoiceDetails(ids,{fresh:true});
    }
    const appliedBeforeDetails=lastAppliedRead.current;
    const promise=(async()=>{
      const records=[];
      for(let offset=0;offset<missing.length;offset+=500){const result=await request(target,{ids:missing.slice(offset,offset+500)},'getInvoices');if(!Array.isArray(result.invoices))throw new Error('Invoice details were not returned. Refresh and check the backend.');const requested=new Set(missing.slice(offset,offset+500));const returned=new Set(result.invoices.map(record=>record?.id));if(returned.size!==requested.size||result.invoices.length!==requested.size||result.invoices.some(record=>!requested.has(record?.id)||!Array.isArray(record.items)))throw new Error('Incomplete invoice details were returned. Refresh and try again.');records.push(...result.invoices);}
      if(active.current!==target||generation.current!==generationAtStart)throw new Error('The Sheet connection changed.');
      const latest=snapshotRef.current;
      const byId=new Map(records.map(record=>[record.id,record]));
      const latestById=new Map(latest.data.invoices.map(record=>[record.id,record]));
      if(records.some(record=>{const base=latestById.get(record.id);return !base||base!==currentById.get(record.id)||Number(base.revision||0)!==Number(record.revision||0)||base.status==='deleted'||lastAppliedRead.current!==appliedBeforeDetails&&base.status!==record.status;}))throw new Error('Invoice changed while loading. Refresh and open it again.');
      const next={...latest,data:{...latest.data,invoices:latest.data.invoices.map(base=>byId.has(base.id)?{...byId.get(base.id),_summary:false}:base)}};
      lastAppliedRead.current++;snapshotRef.current=next;setSnapshot(next);saveAccountCache(target,next.data,next.savedAt).catch(()=>{});
      const nextById=new Map(next.data.invoices.map(record=>[record.id,record]));
      return ids.map(id=>nextById.get(id));
    })();detailFlights.current.set(key,promise);
    try{return await promise;}finally{detailFlights.current.delete(key);}
  }
  const refreshIfStale=useCallback(()=>{
    const current=snapshotRef.current;
    if(!current || current.endpoint!==endpoint || current.cached || Date.now()-Date.parse(current.savedAt)>60000) return reload();
    return Promise.resolve(current.data);
  },[endpoint,reload]);
  useEffect(()=>{
    if(!endpoint||!enabled)return;
    const recover=()=>{
      if(navigator.onLine===false||document.visibilityState==='hidden')return;
      if(readError)reload();else refreshIfStale();
    };
    window.addEventListener('online',recover);
    window.addEventListener('focus',recover);
    document.addEventListener('visibilitychange',recover);
    return()=>{window.removeEventListener('online',recover);window.removeEventListener('focus',recover);document.removeEventListener('visibilitychange',recover);};
  },[endpoint,enabled,readError,reload,refreshIfStale]);
  function applyRecord(action,record){
    const current=snapshotRef.current;
    if(!current||current.endpoint!==endpoint||!record?.id)return false;
    const collection=action==='create'?'transactions':action.includes('Note')?'notes':action.includes('Party')?'parties':'invoices';
    const previous=(current.data[collection]||[]).find(item=>item.id===record.id);
    const value={...previous,...record};
    if(collection==='invoices'&&!Array.isArray(value.items))return false;
    if(collection==='invoices'){value._summary=false;value.itemSearch=value.items.flatMap(item=>[item.description,item.itemNote,...(item.measurements||[]).map(row=>row.description)]).join(' ');}
    const next={...current,data:{...current.data,[collection]:[...(current.data[collection]||[]).filter(item=>item.id!==value.id),value]}};
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
        if(operation.action==='deletePayment'){
          if(result.deleted!==true)throw new Error('Payment deletion was not confirmed.');
          const current=snapshotRef.current;const next={...current,data:{...current.data,transactions:current.data.transactions.filter(row=>row.id!==operation.payload.id)}};lastAppliedRead.current++;snapshotRef.current=next;setSnapshot(next);saveAccountCache(endpoint,next.data,next.savedAt).catch(()=>{});
        }else if(!applyRecord(operation.action,operation.action==='create'?result.transaction:record)){
          const refreshed=await reload({fresh:true});
          record=operation.action==='create'?refreshed?.transactions.find(item=>item.id===operation.payload.id):operation.action.includes('Note')?refreshed?.notes?.find(item=>item.id===operation.payload.id):operation.action.includes('Party')?refreshed?.parties.find(item=>item.id===operation.payload.id):refreshed?.invoices.find(item=>item.id===operation.payload.id);
          if(!record)throw new Error('Upload was acknowledged. Retry to confirm the saved record.');
        }
        if(operation.action==='createInvoice'&&operation.payload.payment){
          if(result.transaction?.id!==operation.payload.paymentId)throw new Error('Invoice uploaded; retry to confirm its linked payment.');
          if(!applyRecord('create',result.transaction)){const refreshed=await reload({fresh:true});if(!refreshed?.transactions.some(row=>row.id===operation.payload.paymentId))throw new Error('Retry to confirm the linked invoice payment.');}
        }
        if(Array.isArray(result.catalogue)){const current=snapshotRef.current;const next={...current,data:{...current.data,catalogue:result.catalogue}};lastAppliedRead.current++;snapshotRef.current=next;setSnapshot(next);saveAccountCache(endpoint,next.data,next.savedAt).catch(()=>{});}
        setCatalogueWarning(result.catalogueWarning||'');
        if(operation.action==='deleteInvoice')setLastInvoice(previous=>previous?.id===record.id?null:previous);
        if(operation.action==='createInvoice')setLastInvoice({id:record.id,number:record.invoiceNumber});
        await updateQueue(items=>items.filter(item=>operationKey(item)!==operationKey(operation)));
        return true;
      }catch(error){
        const failure={message:error.message,code:error.code,rejected:!acknowledged&&Boolean(error.code)&&error.code!=='UNAUTHORIZED'};
        setRejected(failure.rejected);setError(failure.message);
        const failed=items=>items.map(item=>operationKey(item)===operationKey(operation)?{...item,failure}:item);
        try{await updateQueue(failed);}catch{syncQueue(failed(queueRef.current));}
        return false;
      }
    });}catch(error){
      const failure={message:error.message||'The upload could not start. Your saved request remains on this device.',rejected:false};
      setError(failure.message);
      const failed=items=>items.map(item=>operationKey(item)===operationKey(operation)?{...item,failure}:item);
      try{await updateQueue(failed);}catch{syncQueue(failed(queueRef.current));}
      return false;
    }finally{working.current=false;setBusy(false);setUploadTick(value=>value+1);}
  }
  const canQueue=enabled && Boolean(endpoint) && loaded && !rejected && !queue.some(item=>item.failure?.rejected) && queue.every(item=>item.endpoint===endpoint&&!item.invalid&&['createParty','createInvoice','createInvoiceNote'].includes(item.action));
  async function enqueue(action,payload){
    if(!canQueue)return false;
    const operation={endpoint,action,payload};
    try{serializeRequest(endpoint,payload,action);await updateQueue(items=>{if(items.some(item=>item.failure?.rejected||item.endpoint!==endpoint||!['createParty','createInvoice','createInvoiceNote'].includes(item.action)))throw new Error('Resolve the saved request before adding another record.');return items.some(item=>operationKey(item)===operationKey(operation))?items:[...items,operation];});}
    catch(error){setError(error.message||'Browser storage is unavailable. The record was not queued.');return false;}
    if(!pending){setError('');setRejected(false);}
    return true;
  }
  // Dependent invoices wait until their newly created party is confirmed.
  useEffect(()=>{
    if(pending && !pending.failure && ['create','createParty','createInvoice','createInvoiceNote','updateInvoice','deleteParty','deleteInvoice','updateInvoiceNote','deleteInvoiceNote','deletePayment'].includes(pending.action) && pending.endpoint===endpoint && enabled && !pending.invalid)send(pending);
  },[pending,endpoint,enabled,uploadTick]);
  useEffect(()=>{
    const online=()=>{const operation=queueRef.current[0];if(operation&&!operation.failure?.rejected&&['create','createParty','createInvoice','createInvoiceNote','updateInvoice','deleteParty','deleteInvoice','updateInvoiceNote','deleteInvoiceNote','deletePayment'].includes(operation.action))send(operation);};
    window.addEventListener('online',online);return()=>window.removeEventListener('online',online);
  });
  useEffect(()=>{
    const changed=event=>{if(event.detail?.endpoint!==endpoint)return;setReadError('');setError('');reload({fresh:true});const operation=queueRef.current[0];if(operation?.failure?.code==='UNAUTHORIZED')send(operation);};
    window.addEventListener(ACCESS_CHANGED_EVENT,changed);return()=>window.removeEventListener(ACCESS_CHANGED_EVENT,changed);
  });
  async function save(action,payload){
    if(queueRef.current.length || working.current)return false;
    working.current=true;setBusy(true);
    const operation={endpoint,action,payload};
    try{serializeRequest(endpoint,payload,action);await updateQueue(items=>{if(items.length)throw new Error('Another request is already queued.');return [operation];});}catch(error){working.current=false;setBusy(false);setError(error.message||'Browser storage is unavailable. The record was not sent.');return false;}
    working.current=false;
    return send(operation);
  }
  async function queueDeletes(operations){
    if(!loaded||busy||working.current||queueRef.current.length||!operations.length)return false;
    try{await updateQueue(items=>{if(items.length)throw new Error('Another upload is pending.');return operations.map(operation=>({...operation,endpoint}));});setError('');setRejected(false);return true;}
    catch(error){setError(error.message||'Could not save deletion requests on this device.');return false;}
  }
  async function discardRejected() {
    if (!rejected || busy || working.current) return;
    working.current=true;setBusy(true);
    try {
      const snapshot=await reload({fresh:true});
      if(!snapshot)return;
      const {action,payload}=pending;
      const existing=['create','deletePayment'].includes(action)?snapshot.transactions.find(row=>row.id===payload.id):action.includes('Note')?snapshot.notes?.find(row=>row.id===payload.id):action.includes('Party')?snapshot.parties.find(row=>row.id===payload.id):snapshot.invoices.find(row=>row.id===payload.id);
      const mayHaveSaved=action==='deletePayment'?!existing:action==='deleteParty'?Boolean(existing?.archivedAt):['deleteInvoice','deleteInvoiceNote'].includes(action)?existing?.status==='deleted':['create','createParty','createInvoice','createInvoiceNote'].includes(action)?Boolean(existing):['updateParty','updateInvoice','updateInvoiceNote'].includes(action)?existing?.lastEditId===payload._editId:existing?.status==='cancelled';
      if(mayHaveSaved){setError('This record exists in Google Sheets. Retry the saved request to confirm it before continuing.');return;}
      if(action==='createParty' && queueRef.current.some(item=>item.action==='createInvoice'&&item.payload.partyId===payload.id)){setError('An invoice is waiting for this party. Correct the rejected party before retrying.');return;}
      await updateQueue(items=>items.filter(item=>pending.settlementId&&pending.action==='create'?item.settlementId!==pending.settlementId:operationKey(item)!==operationKey(pending)));setRejected(false);setError('');return true;
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
  const parties=useMemo(()=>data.parties.filter(party=>!party.archivedAt),[data.parties]);
  const invoices=useMemo(()=>data.invoices.filter(invoice=>invoice.status!=='deleted'),[data.invoices]);
  const partyIds=useMemo(()=>new Set(data.parties.map(party=>party.id)),[data.parties]);
  const invoiceById=useMemo(()=>new Map(data.invoices.map(invoice=>[invoice.id,invoice])),[data.invoices]);
  const noteIds=useMemo(()=>new Set((data.notes||EMPTY_NOTES).map(note=>note.id)),[data.notes]);
  const selectableParties=useMemo(()=>[...parties,...queuedHere.filter(item=>item.action==='createParty'&&!partyIds.has(item.payload.id)).map(item=>({...item.payload,_pending:true}))],[parties,partyIds,queuedHere]);
  const pendingInvoices=useMemo(()=>queuedHere.filter(item=>item.action==='createInvoice'&&!invoiceById.has(item.payload.id)).map(item=>({...item.payload,invoiceNumber:'Pending RF number',status:'pending',_pending:true})),[queuedHere,invoiceById]);
  const notes=useMemo(()=>{const deleted=new Set(data.invoices.filter(invoice=>invoice.status==='deleted').map(invoice=>invoice.id));return (data.notes||EMPTY_NOTES).filter(note=>note.status!=='deleted'&&!deleted.has(note.invoiceId));},[data.notes,data.invoices]);
  const pendingNotes=useMemo(()=>queuedHere.filter(item=>item.action==='createInvoiceNote'&&!noteIds.has(item.payload.id)&&invoiceById.has(item.payload.invoiceId)&&invoiceById.get(item.payload.invoiceId).status!=='deleted').map(item=>{const invoice=invoiceById.get(item.payload.invoiceId);return {...item.payload,invoiceNumber:invoice?.invoiceNumber,partyId:invoice?.partyId,partyName:invoice?.partyName,partyPhone:invoice?.partyPhone,partyAddress:invoice?.partyAddress,invoiceType:invoice?.type,status:'pending',_pending:true,noteNumber:'Awaiting note number'};}),[queuedHere,noteIds,invoiceById]);
  const partyBalances=useMemo(()=>accountBalances(parties,invoices,data.transactions,notes),[parties,invoices,data.transactions,notes]);
  const notedInvoiceIds=useMemo(()=>new Set((data.notes||EMPTY_NOTES).map(note=>note.invoiceId)),[data.notes]);
  return {...data,stockInvoices:data.invoices,catalogueWarning,notedInvoiceIds,parties,invoices,notes,pendingNotes,partyBalances,selectableParties,pendingInvoices,queue,canQueue,loaded,busy,refreshing,cached,error,pending,rejected,checkedAt,lastInvoice,reload,loadInvoiceDetails,refreshIfStale,save,queueDeletes,queueInvoice:payload=>enqueue('createInvoice',payload),queueParty:payload=>enqueue('createParty',payload),queueNote:payload=>enqueue('createInvoiceNote',payload),retry:()=>send(pending),discardRejected,correctRejectedParty};
}
