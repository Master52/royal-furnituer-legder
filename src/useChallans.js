import {randomUUID} from './uuid.js';
import {useCallback,useEffect,useRef,useState} from 'react';
import {request,ACCESS_CHANGED_EVENT} from './api.js';
import {loadChallanQueue,mutateChallanQueue} from './storage.js';
import {validateCapture} from './challans.js';
export default function useChallans(endpoint,enabled,active){
 const [rows,setRows]=useState([]),[queue,setQueue]=useState([]),[ready,setReady]=useState(false),[loaded,setLoaded]=useState(false),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[storageReady,setStorageReady]=useState(false),[cleanupReady,setCleanupReady]=useState(false),[tick,setTick]=useState(0);
 const current=useRef(endpoint),generation=useRef(0),working=useRef(false),flight=useRef(null);current.current=endpoint;
 const update=useCallback(async change=>{const next=await mutateChallanQueue(endpoint,change);if(current.current===endpoint)setQueue(next);try{localStorage.setItem('rf.challans.changed',JSON.stringify({endpoint,at:Date.now(),id:randomUUID()}));}catch{}return next;},[endpoint]);
 const reload=useCallback(async({fresh=false,throwOnError=false}={})=>{
  if(!enabled||!endpoint)return;
  if(flight.current?.endpoint===endpoint){const waiting=flight.current.promise;if(!fresh)return waiting;await waiting;if(current.current!==endpoint)return;return reload({throwOnError});}
  const gen=generation.current,job={endpoint,promise:null};setLoading(true);
  job.promise=(async()=>{try{const result=await request(endpoint,{},'listChallans');if(!Array.isArray(result.challans))throw new Error('Challan records were not returned. Update the backend and retry.');if(gen!==generation.current)return;setRows(result.challans);setStorageReady(result.storageReady);setCleanupReady(result.cleanupReady);setLoaded(true);setError('');return result;}catch(e){if(gen===generation.current)setError(e.message);if(throwOnError)throw e;}finally{if(flight.current===job){flight.current=null;setLoading(false);}}})();flight.current=job;return job.promise;
 },[endpoint,enabled]);
 useEffect(()=>{
  const gen=++generation.current;setRows([]);setQueue([]);setReady(false);setLoaded(false);setError('');setStorageReady(false);setCleanupReady(false);flight.current=null;setLoading(false);
  if(!endpoint||!enabled)return;
  loadChallanQueue(endpoint).then(rows=>{if(gen===generation.current){setQueue(rows);setReady(true);}}).catch(e=>{if(gen===generation.current)setError(e.message);});
  return()=>{generation.current++;};
 },[endpoint,enabled]);
 useEffect(()=>{if(active&&enabled)reload();},[active,enabled,reload]);
 useEffect(()=>{
  const changed=event=>{if(event.key!=='rf.challans.changed')return;loadChallanQueue(endpoint).then(rows=>{if(current.current===endpoint){setQueue(rows);reload();}}).catch(e=>setError(e.message));};
  window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);
 },[endpoint,reload]);
 const pending=queue[0]||null;
 const retry=useCallback(async()=>{
  if(working.current||!enabled||!endpoint||!ready)return;
  working.current=true;setBusy(true);const target=endpoint;
  try{
   if(!navigator.locks)throw new Error('This browser cannot safely coordinate photo uploads.');
   let refresh=false;
   await navigator.locks.request('rf.challan-upload:'+target,async()=>{
    const saved=await loadChallanQueue(target),operation=saved[0];if(!operation){if(current.current===target)setQueue([]);return;}
    try{
     const result=await request(target,operation.payload,operation.action);if(result.id!==operation.payload.id)throw new Error('The photo upload was not confirmed. Retry the saved request.');
     const remaining=await update(rows=>rows.filter(row=>row.key!==operation.key));
     // One refresh per completed photo batch, rather than rereading Sheets for every page.
     refresh=operation.action!=='uploadChallanPhoto'||remaining[0]?.payload.challanId!==operation.payload.challanId;
     if(current.current===target)setError('');
    }catch(e){try{await update(rows=>rows.map(row=>row.key===operation.key?{...row,failure:e.message}:row));}catch(storageError){if(current.current===target)setReady(false);throw new Error(e.message+' The saved queue could not be updated: '+storageError.message);}throw e;}
   });
   if(refresh&&current.current===target)await reload({fresh:true});
  }catch(e){if(current.current===target)setError(e.message);}
  finally{working.current=false;setBusy(false);setTick(value=>value+1);}
 },[endpoint,enabled,ready,update,reload]);
 useEffect(()=>{if(ready&&pending&&!pending.failure&&!busy)retry();},[ready,pending,busy,retry,tick]);
 useEffect(()=>{
  const online=()=>{if(pending?.failure)retry();};
  const verified=event=>{if(event.detail?.endpoint===endpoint){reload();if(pending?.failure)retry();}};
  window.addEventListener('online',online);window.addEventListener(ACCESS_CHANGED_EVENT,verified);
  return()=>{window.removeEventListener('online',online);window.removeEventListener(ACCESS_CHANGED_EVENT,verified);};
 },[pending,retry,reload,endpoint]);
 async function capture(name,photos,autoDelete){
  validateCapture(name,photos);
  if(!enabled||!endpoint)throw new Error('Connect your Sheet and deploy Code.gs 1.30.0 or newer before uploading challan photos.');
  // The dashboard can open Capture before the first setup/IndexedDB read finishes.
  // Verify authoritative state here instead of rejecting that temporary UI state.
  let saved;
  try{saved=await loadChallanQueue(endpoint);}catch(e){throw new Error('This browser could not read saved challan uploads: '+e.message+' Your selected photos are kept in this form.');}
  if(current.current!==endpoint)throw new Error('The Sheet connection changed. Reopen Capture for the intended Sheet.');
  setQueue(saved);setReady(true);
  if(saved.some(operation=>operation.failure))throw new Error('An earlier challan upload failed. Use Retry earlier upload below, then save these photos again. Your selected photos are kept.');
  const setup=loaded&&storageReady?{storageReady,cleanupReady}:await reload({fresh:true,throwOnError:true});
  if(!setup||current.current!==endpoint)throw new Error('The challan setup check could not finish. Retry saving; your selected photos are kept.');
  if(!setup.storageReady)throw new Error('Challan photo storage is not configured for this Sheet. Open the Sheet → Extensions → Apps Script, run setupChallanStorage(), approve Google permissions, then click Check setup again below.');
  if(autoDelete&&!setup.cleanupReady)throw new Error('Automatic photo cleanup is not configured. Run setupChallanStorage(), or leave the 30-day deletion checkbox unchecked.');
  const id=randomUUID();
  const operations=[{action:'createChallan',payload:{id,name:name.trim(),autoDelete}},...photos.map(photo=>({action:'uploadChallanPhoto',payload:{...photo,challanId:id}}))].map(operation=>({...operation,key:randomUUID()}));
  await update(rows=>{if(rows.some(operation=>operation.failure))throw new Error('An earlier challan upload failed. Retry it before saving these photos. Your selected photos are kept.');return [...rows,...operations];});setError('');return id;
 }
 async function retention(record,autoDelete){
  if(queue.length)throw new Error('Finish pending challan uploads before changing retention.');
  await update(rows=>{if(rows.length)throw new Error('Another challan upload is pending.');return [{key:randomUUID(),action:'updateChallanRetention',payload:{id:record.id,autoDelete,_expectedRevision:record.revision,_editId:randomUUID()}}];});
 }
 async function deletePhotos(record){
  if(queue.length)throw new Error('Finish pending challan uploads before deleting photos.');
  await update(rows=>{if(rows.length)throw new Error('Another challan upload is pending.');return [{key:randomUUID(),action:'deleteChallanPhotos',payload:{id:record.id}}];});
 }
 async function useSavedRetention(){
  if(working.current||queue[0]?.action!=='updateChallanRetention')return;
  const fresh=await reload({fresh:true});if(!fresh)return;
  await update(rows=>rows[0]?.key===queue[0]?.key?rows.slice(1):rows);setError('');
 }
 const local=queue.filter(op=>op.action==='createChallan'&&!rows.some(row=>row.id===op.payload.id)).map(op=>({...op.payload,photos:[],_pending:true}));
 const visible=[...rows,...local].map(row=>({...row,_pending:queue.some(op=>op.payload.id===row.id||op.payload.challanId===row.id)}));
 return {rows:visible,queue,pending,ready,loaded,loading,busy,error,storageReady,cleanupReady,reload,retry,capture,retention,deletePhotos,useSavedRetention};
}
