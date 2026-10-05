import {useCallback,useEffect,useRef,useState} from 'react';
import {request,serializeRequest} from './api.js';
const EMPTY={items:[],movements:[],reviews:[],operations:[],openingDate:''};
export default function useStock(endpoint,enabled){
 const [data,setData]=useState(EMPTY),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState(null);
 const generation=useRef(0),flight=useRef(null),working=useRef(false),currentEndpoint=useRef(endpoint);currentEndpoint.current=endpoint;
 const key=`rf.stock-pending:${endpoint}`;
 const readPending=useCallback(()=>{try{const operation=JSON.parse(localStorage.getItem(key)||'null');if(operation&&(!operation.payload?.id||!operation.action))throw new Error();setPending(operation);return operation;}catch{setError('The saved stock request cannot be read. Recover it before saving.');const invalid={invalid:true};setPending(invalid);return invalid;}},[key]);
 const reload=useCallback(async()=>{
  if(!enabled||!endpoint)return null;
  const gen=generation.current;if(flight.current?.gen===gen)return flight.current.promise;
  setLoading(true);const job={gen,promise:null};
  job.promise=(async()=>{try{const result=await request(endpoint,{},'listStock');if(gen!==generation.current)return null;setData(result);setError('');return result;}catch(e){if(gen===generation.current)setError(e.message);return null;}finally{if(flight.current===job){flight.current=null;setLoading(false);}}})();flight.current=job;return job.promise;
 },[endpoint,enabled]);
 useEffect(()=>{generation.current++;setData(EMPTY);setError('');flight.current=null;setLoading(false);setBusy(false);readPending();reload();const changed=e=>{if(e.key===key){readPending();reload();}};window.addEventListener('storage',changed);return()=>{generation.current++;window.removeEventListener('storage',changed);};},[key,reload,readPending]);
 async function locked(callback){if(!navigator.locks)throw new Error('Use a browser with Web Locks support to safely save stock.');return navigator.locks.request('rf.stock.upload',callback);}
 async function sendUnlocked(operation,target,gen){
  try{
   const result=await request(target,operation.payload,operation.action);if(!result.ok||!result.stock)throw new Error('Stock update was not confirmed. Keep this request and retry.');
   localStorage.removeItem(`rf.stock-pending:${target}`);
   if(gen!==generation.current||currentEndpoint.current!==target)return false;
   generation.current++;flight.current=null;setLoading(false);setData(result.stock);setPending(null);return true;
  }catch(e){
   if(e.code==='STOCK_REJECTED'){const rejected={...operation,rejected:true};localStorage.setItem(`rf.stock-pending:${target}`,JSON.stringify(rejected));if(gen===generation.current)setPending(rejected);}
   if(gen===generation.current)setError(e.message);return false;
  }
 }
 async function run(callback){
  if(working.current||!enabled||!endpoint)return false;working.current=true;setBusy(true);setError('');const target=endpoint,gen=generation.current;
  try{return await locked(()=>callback(target,gen));}catch(e){if(gen===generation.current)setError(e.message);return false;}finally{working.current=false;if(currentEndpoint.current===target)setBusy(false);}
 }
 async function save(action,payload){return run(async(target,gen)=>{
  if(gen!==generation.current||currentEndpoint.current!==target)return false;
  if(localStorage.getItem(key)){readPending();throw new Error('Confirm or discard the existing stock request first.');}
  serializeRequest(target,payload,action);const operation={action,payload};localStorage.setItem(key,JSON.stringify(operation));setPending(operation);return sendUnlocked(operation,target,gen);
 });}
 async function retry(){return run(async(target,gen)=>{const operation=readPending();if(!operation||operation.invalid||gen!==generation.current)return false;return sendUnlocked(operation,target,gen);});}
 async function discardRejected(){return run(async(target,gen)=>{const operation=readPending();if(!operation?.rejected||gen!==generation.current)return false;localStorage.removeItem(key);setPending(null);await reload();return true;});}
 return {...data,busy,loading,error,pending,reload,save,retry,discardRejected};
}
