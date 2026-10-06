import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {request,serializeRequest} from './api.js';
import {applyPendingStock} from './stock.js';
const EMPTY={items:[],movements:[],reviews:[],operations:[],openingDate:''};
export default function useStock(endpoint,enabled){
 const [data,setData]=useState(EMPTY),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[queue,setQueue]=useState([]),[tick,setTick]=useState(0);
 const generation=useRef(0),flight=useRef(null),working=useRef(false),currentEndpoint=useRef(endpoint);currentEndpoint.current=endpoint;
 const key=`rf.stock-pending:${endpoint}`,pending=queue[0]||null;
 function read(key){const value=JSON.parse(localStorage.getItem(key)||'null'),rows=value?.queue|| (value?[value]:[]);if(!Array.isArray(rows)||rows.some(row=>!row.payload?.id||!row.action))throw new Error('The saved stock queue cannot be read.');return rows.map(row=>row.rejected?{...row,failed:true}:row);}
 const readPending=useCallback(()=>{try{const rows=read(key);setQueue(rows);return rows;}catch(e){setError(e.message);setQueue([{invalid:true}]);return []; }},[key]);
 async function mutate(target,callback){return navigator.locks.request(`rf.stock.queue:${target}`,()=>{const storageKey=`rf.stock-pending:${target}`,rows=callback(read(storageKey));if(rows.length)localStorage.setItem(storageKey,JSON.stringify({queue:rows}));else localStorage.removeItem(storageKey);if(currentEndpoint.current===target)setQueue(rows);return rows;});}
 const reload=useCallback(async()=>{
  if(!enabled||!endpoint)return null;const gen=generation.current;if(flight.current?.gen===gen)return flight.current.promise;setLoading(true);const job={gen,promise:null};
  job.promise=(async()=>{try{const result=await request(endpoint,{},'listStock');if(gen!==generation.current)return null;setData(result);return result;}catch(e){if(gen===generation.current)setError(e.message);return null;}finally{if(flight.current===job){flight.current=null;setLoading(false);}}})();flight.current=job;return job.promise;
 },[endpoint,enabled]);
 useEffect(()=>{generation.current++;setData(EMPTY);setError('');flight.current=null;setLoading(false);readPending();reload();const changed=e=>{if(e.key===key){readPending();reload();}};window.addEventListener('storage',changed);return()=>{generation.current++;window.removeEventListener('storage',changed);};},[key,reload,readPending]);
 async function send(operation,target){
  try{const result=await request(target,operation.payload,operation.action);if(!result.ok||!result.stock)throw new Error('Stock update was not confirmed. Retry the saved request.');
   if(currentEndpoint.current===target){generation.current++;flight.current=null;setLoading(false);setData(result.stock);setError('');}
   await mutate(target,rows=>rows.filter(row=>row.payload.id!==operation.payload.id));return true;
  }catch(e){try{await mutate(target,rows=>rows.map(row=>row.payload.id===operation.payload.id?{...row,failed:true,rejected:e.code==='STOCK_REJECTED'}:row));}catch{if(currentEndpoint.current===target)setQueue(rows=>rows.map(row=>row.payload?.id===operation.payload.id?{...row,failed:true}:row));}if(currentEndpoint.current===target)setError(e.message);return false;}
 }
 async function run(callback){if(working.current||!enabled||!endpoint)return false;working.current=true;setBusy(true);const target=endpoint;
  try{if(!navigator.locks)throw new Error('Use a browser with Web Locks support.');return await navigator.locks.request('rf.stock.upload',()=>callback(target));}catch(e){if(currentEndpoint.current===target){setError(e.message);setQueue(rows=>rows.map((row,index)=>index===0?{...row,failed:true}:row));}return false;}finally{working.current=false;setBusy(false);setTick(value=>value+1);}
 }
 async function save(action,payload){return run(async target=>{serializeRequest(target,payload,action);await mutate(target,rows=>{if(rows.length)throw new Error('Confirm pending stock updates first.');return [{action,payload}];});return send({action,payload},target);});}
 async function queueStock(action,payload){
  if(!enabled||!endpoint)return false;
  try{
   if(!['reviewInvoiceStock','recordStock','updateStockItem'].includes(action))throw new Error('Invalid stock queue action.');
   serializeRequest(endpoint,payload,action);
   await mutate(endpoint,rows=>{
    const compatible=action==='updateStockItem'?['updateStockItem']:['reviewInvoiceStock','recordStock'];
    if(rows.some(row=>row.failed||row.invalid||!compatible.includes(row.action)))throw new Error('Resolve the pending stock request first.');
    if(payload.invoiceId&&rows.some(row=>row.payload.invoiceId===payload.invoiceId))throw new Error('This invoice already has a queued stock update.');
    return [...rows,{action,payload,queuedAt:new Date().toISOString()}];
   });setError('');return true;
  }catch(e){setError(e.message);return false;}
 }
 async function retry(){return run(async target=>{const first=read(`rf.stock-pending:${target}`)[0];return first?send(first,target):false;});}
 async function discardRejected(){return run(async target=>{await mutate(target,rows=>{if(!rows[0]?.rejected)throw new Error('Only rejected requests can be discarded.');return rows.slice(1);});setError('');await reload();return true;});}
 useEffect(()=>{if(!busy&&pending&&!pending.failed&&!pending.invalid&&enabled)retry();},[pending,busy,enabled,endpoint,tick]);
 useEffect(()=>{const online=()=>{if(pending?.failed&&!pending.rejected)retry();};window.addEventListener('online',online);return()=>window.removeEventListener('online',online);},[pending,endpoint]);
 const canQueueItemEdits=enabled&&Boolean(endpoint)&&(!busy||queue.length>0)&&queue.every(row=>!row.failed&&!row.invalid&&row.action==='updateStockItem');
 const optimistic=useMemo(()=>applyPendingStock(data,queue),[data,queue]);
 const items=useMemo(()=>optimistic.items.filter(item=>item.status!=='deleted'),[optimistic.items]);
 const archivedItems=useMemo(()=>optimistic.items.filter(item=>item.status==='deleted'),[optimistic.items]);
 return {...optimistic,items,archivedItems,busy,loading,error,pending,queue,canQueueItemEdits,reload,save,queueStock,queueReview:payload=>queueStock('reviewInvoiceStock',payload),retry,discardRejected};
}
