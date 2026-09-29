import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from './api.js';
import { loadAccountCache, saveAccountCache } from './storage.js';
const EMPTY_ACCOUNTS = {parties:[],invoices:[],transactions:[]};
const KEY = 'rf.accounts.pending';
function readPending() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; }
  catch { return { invalid: true }; }
}
export default function useAccounts(endpoint, enabled) {
  const [snapshot,setSnapshot] = useState(null);
  const [busy,setBusy] = useState(false);
  const [refreshing,setRefreshing] = useState(false);
  const [error,setError] = useState('');
  const [pending,setPending] = useState(readPending);
  const [rejected,setRejected] = useState(false);
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
      return reload();
    }
    const flight={endpoint,generation:currentGeneration,promise:null};
    setRefreshing(true);
    flight.promise=(async()=>{
      try {
        const result=await request(endpoint,{},'listAccounts');
        if (!Array.isArray(result.parties) || !Array.isArray(result.invoices) || !Array.isArray(result.transactions)) throw new Error('Update the test Sheet to Code.gs 1.7.0 or newer and deploy a new version.');
        if(active.current!==endpoint || generation.current!==currentGeneration)return null;
        const savedAt=new Date().toISOString();
        const next={endpoint,data:result,savedAt,cached:false};
        lastAppliedRead.current++;snapshotRef.current=next;setSnapshot(next);setError('');
        saveAccountCache(endpoint,result,savedAt).catch(()=>{});
        return result;
      } catch(e) {
        if(active.current===endpoint && generation.current===currentGeneration)setError(e.message);
        return null;
      } finally {
        if(inFlight.current===flight){inFlight.current=null;setRefreshing(false);}
      }
    })();
    inFlight.current=flight;
    return flight.promise;
  },[endpoint,enabled]);
  useEffect(()=>{
    const currentGeneration=++generation.current;
    inFlight.current=null;setRefreshing(false);setSnapshot(null);snapshotRef.current=null;setError('');
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
  async function send(operation) {
    if (working.current) return false;
    if (!enabled || operation.endpoint!==endpoint || operation.invalid) {setError('Reconnect the original Sheet and update its backend before retrying this saved request.');return false;}
    working.current=true;setBusy(true);setRejected(false);setError('');
    let confirmed=false;
    try {
      const result=await request(operation.endpoint,operation.payload,operation.action);
      if(result.id!==operation.payload.id)throw new Error('The server did not confirm this record. Retry the saved request.');
      confirmed=true;
      localStorage.removeItem(KEY);setPending(null);
      await reload({fresh:true});
      return true;
    } catch(e) {
      // A received backend rejection is distinct from an ambiguous network timeout.
      setRejected(!confirmed && Boolean(e.code));setError(e.message);return false;
    } finally {working.current=false;setBusy(false);}
  }
  async function save(action,payload) {
    if (pending || working.current) return false;
    const operation={endpoint,action,payload};
    try {localStorage.setItem(KEY,JSON.stringify(operation));setPending(operation);}
    catch {setError('Browser storage is unavailable. The record was not sent.');return false;}
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
      localStorage.removeItem(KEY);setPending(null);setRejected(false);setError('');
    } catch {setError('Could not safely clear the rejected request. Retry it before continuing.');}
    finally {working.current=false;setBusy(false);}
  }
  return {...data,loaded,busy,refreshing,cached,error,pending,rejected,checkedAt,reload,refreshIfStale,save,retry:()=>send(pending),discardRejected};
}
