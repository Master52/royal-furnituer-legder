import AccountDialog from './AccountDialog.jsx';
import AccountsPanel from './AccountsPanel.jsx';
import useAccounts from './useAccounts.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { categories, methods, money, localNow, periodRange, filterTransactions, makeTransaction, paymentMethodBalance, transactionIntegrityIssue, duplicateTransactionIds } from './ledger.js';
import { request, validateEndpoint } from './api.js';
import Settings from './Settings.jsx';
import { backendInfo } from './backend.js';
import { normalizePreferences, preferenceKey, entryDefaults, csvForTransactions, downloadText } from './preferences.js';
import './styles.css';
import './pwa.css';
import './branding.css';
import './dashboard.css';
import './settlement.css';
import './outbox.css';
import './accounts.css';
import './indicators.css';
import PaymentEntry from './PaymentEntry.jsx';
import TransactionDetails from './TransactionDetails.jsx';
import SyncStatus from './SyncStatus.jsx';
import {invoiceNoteRevision} from './accounts.js';
import {planBulkDelete} from './bulkDelete.js';
import ActivityTable from './ActivityTable.jsx';
import DashboardOverview from './DashboardOverview.jsx';
import { newEntry, partyPaymentEntry, editEntry, hasDraft, shortcutAction, focusAndCenter } from './entry.js';
import { readEndpoint, loadEndpoint, saveEndpoint, clearEndpoint, loadTransactionCache, saveTransactionCache } from './storage.js';
import { applyQueuedOperation, overlayOutbox, queueRecord } from './outbox.js';

function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
const outboxKey='rf.outbox';
function initialOutbox(){
  const saved=read(outboxKey,[]);
  const queue=Array.isArray(saved)?saved:[];
  const legacy=read('rf.pending',null);
  if(legacy&&!queue.some(item=>item.id===legacy.id&&item._editId===legacy._editId))queue.unshift({...legacy,_queueId:crypto.randomUUID(),_action:legacy._action||'create',_status:legacy._endpoint?'queued':'failed',_error:legacy._endpoint?undefined:'This saved payment has no recorded Sheet destination. Confirm the connected Sheet before retrying.',_errorCode:legacy._endpoint?undefined:'MISSING_ENDPOINT',_queuedAt:new Date().toISOString()});
  return queue.map(item=>item._status==='uploading'?{...item,_status:item._endpoint?'queued':'failed',_error:item._endpoint?null:'This saved payment has no recorded Sheet destination. Confirm the connected Sheet before retrying.',_errorCode:item._endpoint?null:'MISSING_ENDPOINT'}:!item._endpoint&&item._status!=='failed'?{...item,_status:'failed',_error:'This saved payment has no recorded Sheet destination. Confirm the connected Sheet before retrying.',_errorCode:'MISSING_ENDPOINT'}:item);
}

function versionAtLeast(actual, required) {
  if (typeof actual!=='string' || !/^\d+(\.\d+)*$/.test(actual)) return false;
  const a=actual.split('.').map(Number),r=required.split('.').map(Number);
  for(let i=0;i<Math.max(a.length,r.length);i++){if((a[i]||0)>(r[i]||0))return true;if((a[i]||0)<(r[i]||0))return false;}
  return true;
}

function App() {
  const pendingKey = 'rf.pending';
  const brandLogo = new URL('icons/royal-logo.png', document.baseURI).href;
  const [endpoint, setEndpoint] = useState(readEndpoint);
  const endpointRef=useRef(endpoint);
  endpointRef.current=endpoint;
  const [preferences,setPreferences] = useState(()=>normalizePreferences(read(preferenceKey(endpoint), {})));
  const [deleted,setDeleted] = useState(null);
  const [settingsFeedback,setSettingsFeedback] = useState('');
  const [rows, setRows] = useState([]);
  const [cacheSavedAt,setCacheSavedAt]=useState('');
  const [refreshing,setRefreshing]=useState(false);
  const [refreshReadError,setRefreshReadError]=useState('');
  const [connectionInfo, setConnectionInfo] = useState(() => { const saved = read('rf.connectionInfo', null); return saved?.endpoint === endpoint ? saved : null; });
  const [outbox,setOutbox]=useState(initialOutbox);
  const outboxRef=useRef(outbox);
  outboxRef.current=outbox;
  const pending=outbox[0]||null;
  const accountsEnabled=versionAtLeast(connectionInfo?.version,'1.8.0');
  const accounts=useAccounts(endpoint,accountsEnabled);
  useEffect(()=>{if(accounts.loaded&&!accounts.cached&&accounts.backendVersion&&accounts.backendVersion!==connectionInfo?.version)rememberInfo(endpoint,{backendVersion:accounts.backendVersion});},[accounts.loaded,accounts.cached,accounts.backendVersion,connectionInfo?.version,endpoint]);
  const [period, setPeriod] = useState('month');
  const [range, setRange] = useState(() => periodRange('month'));
  const [historyCategory, setHistoryCategory] = useState('');
  const [invoiceCreateRequest, setInvoiceCreateRequest] = useState(0);
  const [invoiceResumeRequest, setInvoiceResumeRequest] = useState(0);
  const [hasInvoiceDraft, setHasInvoiceDraft] = useState(false);
  const [invoiceOpenRequest, setInvoiceOpenRequest] = useState(null);
  const [noteOpenRequest,setNoteOpenRequest]=useState(null);
  const [method, setMethod] = useState('');
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState(() => endpoint ? '' : 'settings');
  const [connectionRestored, setConnectionRestored] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [form, setForm] = useState(()=>newEntry(entryDefaults(preferences)));
  const [url, setUrl] = useState(endpoint);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [synced, setSynced] = useState(false);
  const [view, setView] = useState('dashboard');
  const [paymentOpen,setPaymentOpen] = useState(false);
  useEffect(()=>{if(['accounts','dashboard','history'].includes(view))accounts.refreshIfStale();},[view,accounts.refreshIfStale]);
  const [printingTransactions,setPrintingTransactions]=useState(false);
  useEffect(()=>{const before=()=>{if(!document.body.dataset.accountPrint)flushSync(()=>setPrintingTransactions(true));};const after=()=>setPrintingTransactions(false);window.addEventListener('beforeprint',before);window.addEventListener('afterprint',after);return()=>{window.removeEventListener('beforeprint',before);window.removeEventListener('afterprint',after);};},[]);
  const [editing, setEditing] = useState(null);
  const [transactionSelection,setTransactionSelection]=useState(null);
  const transactionDetail=transactionSelection?.endpoint===endpoint?(rows.find(row=>row===transactionSelection.record)||rows.find(row=>row.id===transactionSelection.id)):null;
  useEffect(()=>{if(transactionSelection&&!transactionDetail)setTransactionSelection(null);},[transactionSelection,transactionDetail]);
  const [editConflict, setEditConflict] = useState(false);
  const amountRef = useRef(null);
  const formRef = useRef(null);
  const lock = useRef(false);
  const refreshInFlight=useRef(false);
  const outboxProcessing=useRef(false);
  function persistOutbox(queue) {
    try { write(outboxKey,queue); setOutbox(queue); try { localStorage.removeItem(pendingKey); } catch { /* The durable outbox write already succeeded. */ } return true; }
    catch { setError('Could not save the upload queue on this device. Check browser storage and try again.'); return false; }
  }
  const dialog = useRef(null);
  const duplicateIds=useMemo(()=>duplicateTransactionIds(rows),[rows]);
  const calculationRows=useMemo(()=>rows.filter(t=>!duplicateIds.has(t.id)),[rows,duplicateIds]);
  const allTimePaymentMethodSummary = useMemo(()=>paymentMethodBalance(calculationRows),[calculationRows]);
  const expectedCash=allTimePaymentMethodSummary.Cash;
  const expectedOnline=allTimePaymentMethodSummary.Online;
  const expectedCashForEntry=editing?.recordType==='adjustment'?expectedCash-Number(editing.cashAdjustmentMinor||0):expectedCash;
  const expectedOnlineForEntry=editing?.recordType==='adjustment'?expectedOnline-Number(editing.onlineAdjustmentMinor||0):expectedOnline;
  const integrityIssueCount=rows.filter(transactionIntegrityIssue).length+rows.filter(t=>duplicateIds.has(t.id)).length;
  useEffect(()=>{
    if(!connectionRestored||!endpoint)return;
    saveTransactionCache(endpoint,rows,cacheSavedAt||new Date().toISOString()).catch(()=>{});
  },[rows,endpoint,connectionRestored,cacheSavedAt]);
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      if (['localhost','127.0.0.1','[::1]'].includes(window.location.hostname)) {
        navigator.serviceWorker.getRegistration(new URL('./', document.baseURI)).then(registration => {
          if (!registration) return;
          registration.unregister().then(removed => { if (removed && navigator.serviceWorker.controller) window.location.reload(); });
        }).catch(() => {});
      } else navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).catch(() => {});
    }
    const handleInstallPrompt = event => { event.preventDefault(); setInstallPrompt(event); };
    const handleInstalled = () => setInstallPrompt(null);
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);
  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }
  function applyConnectionPreferences(target) {
    const next=normalizePreferences(read(preferenceKey(target),{}));
    setPreferences(next);setDeleted(null);setSettingsFeedback('');
    if (!hasDraft(form) && !editing && !pending) setForm(newEntry(entryDefaults(next)));
  }
  function savePreferences(values) {
    setError('');
    try {
      const next=normalizePreferences(values);write(preferenceKey(endpoint),next);setPreferences(next);
      if (!hasDraft(form) && !editing && !pending) setForm(newEntry(entryDefaults(next)));
      setSettingsFeedback('Preferences saved for this connection in this browser.');
    } catch {setError('Preferences could not be saved. Check browser storage permissions.');}
  }
  async function exportCsv(dates) {
    if (lock.current || !endpoint) return;
    if (!dates[0] || !dates[1] || dates[0]>dates[1]) {setError('Choose a valid export date range.');return;}
    lock.current=true;setBusy(true);setError('');setSettingsFeedback('');
    try {
      const result=await request(endpoint);setRows(overlayOutbox(result.transactions,outboxRef.current,endpoint));setCacheSavedAt(new Date().toISOString());rememberInfo(endpoint,result);setSynced(true);
      const records=filterTransactions(result.transactions,{start:dates[0],end:dates[1]});
      downloadText(csvForTransactions(records),`transactions-${dates[0]}-to-${dates[1]}.csv`,'text/csv;charset=utf-8');
      setSettingsFeedback(`Exported ${records.length} active transactions from ${dates[0]} to ${dates[1]}.`);
    } catch(e) {setError(e.message);} finally {lock.current=false;setBusy(false);}
  }
  async function loadDeleted() {
    if (lock.current || !endpoint) return;
    lock.current=true;setBusy(true);setError('');setSettingsFeedback('');
    try {
      const result=await request(endpoint,{},'listDeleted');
      if (!Array.isArray(result.transactions)) throw new Error('Update Code.gs to enable deleted-transaction recovery.');
      setDeleted(result.transactions);rememberInfo(endpoint,result);
      const current=await request(endpoint);setRows(overlayOutbox(current.transactions,outboxRef.current,endpoint));setCacheSavedAt(new Date().toISOString());setSynced(true);
    } catch(e) {setError(e.message);} finally {lock.current=false;setBusy(false);}
  }
  async function restore(transaction) {
    if (lock.current || pending || !endpoint) return;
    if (!window.confirm(`Restore ${money(transaction.amountMinor)} for ${transaction.party || transaction.category} on ${transaction.transactionDate}?`)) return;
    lock.current=true;setBusy(true);setError('');setSettingsFeedback('');
    try {
      const result=await request(endpoint,{id:transaction.id,deletedAt:transaction.deletedAt,_expectedRevision:Number(transaction.revision || 0)},'restore');
      if (!result.restored || result.transaction?.id!==transaction.id) throw new Error('Restore was not confirmed. Update your Code.gs deployment.');
      setRows(previous=>[...previous.filter(t=>t.id!==transaction.id),result.transaction]);
      setDeleted(previous=>previous?.filter(t=>t.id!==transaction.id) ?? null);
      accounts.reload({fresh:true});
      setSettingsFeedback('Payment restored to its original date. Refresh the Sheet Report tab to update its snapshot.');
    } catch(e) {setError(`${e.message} Reload deleted transactions to check the result, or retry Restore safely.`);} finally {lock.current=false;setBusy(false);}
  }
  function rememberInfo(target, result) {
    const info = { ...backendInfo(result), endpoint: target };
    setConnectionInfo(info);
    try { write('rf.connectionInfo', info); } catch { /* A later successful read can restore version info. */ }
  }
  async function refresh(target = endpoint,{reuseFresh=false}={}) {
    if (!target || refreshInFlight.current) return;
    refreshInFlight.current=true;setRefreshing(true);setRefreshReadError('');
    try {
      const result=target===endpoint&&accountsEnabled?await (reuseFresh?accounts.refreshIfStale():accounts.reload()):await request(target);
      if(!result)throw new Error('Google Sheets could not be refreshed.');
      if(target!==endpointRef.current)return;
      const savedAt=new Date().toISOString();
      setRows(overlayOutbox(result.transactions,outboxRef.current,target));setCacheSavedAt(savedAt);rememberInfo(target,result);setSynced(true);setNotice('Up to date with Google Sheets.');
      saveTransactionCache(target,result.transactions,savedAt).catch(()=>{});
    }
    catch (e) { if(target===endpointRef.current){setRefreshReadError(e.message);setSynced(false);} }
    finally { refreshInFlight.current=false;setRefreshing(false); }
  }
  useEffect(()=>{
    if(!accounts.loaded)return;
    setRows(overlayOutbox(accounts.transactions,outboxRef.current,endpoint));setCacheSavedAt(accounts.checkedAt||'');
    if(!accounts.cached){setSynced(true);setRefreshReadError('');saveTransactionCache(endpoint,accounts.transactions,accounts.checkedAt).catch(()=>{});}
  },[accounts.loaded,accounts.transactions,accounts.checkedAt,accounts.cached,endpoint]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadEndpoint();
      if (cancelled) return;
      if (saved) {
        const cached=await loadTransactionCache(saved);
        if(cancelled)return;
        if (saved !== endpoint) {
          setEndpoint(saved);
          setUrl(saved);
          applyConnectionPreferences(saved);
        }
        if(cached){setRows(overlayOutbox(cached.transactions,outboxRef.current,saved));setCacheSavedAt(cached.savedAt||'');}
        setModal('');
        setConnectionRestored(true);
        refresh(saved,{reuseFresh:true});
      } else {
        setModal('settings');
        setConnectionRestored(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!connectionRestored || !endpoint || busy || refreshing || outboxProcessing.current || !outbox.length || outbox[0]._status === 'failed') return;
    const first = outbox[0];
    if (first._endpoint && first._endpoint !== endpoint) return;
    outboxProcessing.current = true;
    persistOutbox(outbox.map((item,index)=>index===0?{...item,_status:'uploading',_error:null}:item));
    (async () => {
      try {
        const payload=queueRecord(first);
        const result=await request(endpoint,payload,first._action || 'create');
        if(first._action==='delete') {
          if(result.id!==first.id||result.deleted!==true)throw new Error('Delete was not confirmed by Google Sheets.');
          setRows(previous=>previous.filter(row=>row.id!==first.id));
        } else {
          if(result.id!==first.id)throw new Error('Save confirmation did not match this transaction.');
          if(first._action==='update'&&(!result.updated||result.transaction?.id!==first.id))throw new Error('Edit was not confirmed. Update Code.gs and retry.');
          if(result.transaction)setRows(previous=>[...previous.filter(row=>row.id!==first.id),result.transaction]);
        }
        const remaining=outboxRef.current.filter(item=>item._queueId!==first._queueId);
        persistOutbox(remaining);if(!remaining.length)accounts.reload({fresh:true});setSynced(true);setNotice(`${first._action==='delete'?'Transaction deleted':first._action==='update'?'Changes saved':'Transaction saved'} to Google Sheets.`);
      } catch(e) {
        {
          const latest=outboxRef.current.map((item,index)=>index===0?{...item,_status:'failed',_error:e.message,_errorCode:e.code}:item);
          persistOutbox(latest);setSynced(false);if(e.code==='EDIT_CONFLICT')setEditConflict(true);
        }
      } finally { outboxProcessing.current=false; }
    })();
  },[outbox,endpoint,connectionRestored,busy,refreshing]);
  useEffect(()=>{ document.documentElement.dataset.theme=preferences.theme; document.documentElement.dataset.textSize=preferences.largeText?'large':'normal'; document.documentElement.dataset.printNotes=String(preferences.printNotes); document.title=preferences.shopName+' | Shop Ledger'; const description=document.querySelector('meta[name="description"]'); if(description) description.content='Royal Furnitures — Apne Gar ko do ROYAL touch sirf Royal Furnitures se. Shop ledger for payments, purchases, transport and expenses.'; },[preferences]);
  useEffect(() => {
    // The startup screen does not mount the dialog until restoration finishes.
    if (!connectionRestored || !dialog.current) return;
    if (modal) {
      if (!dialog.current.open) dialog.current.showModal();
    } else {
      dialog.current.close();
    }
  }, [modal, connectionRestored]);
  function focusAmount() { setTimeout(() => { if (window.matchMedia('(min-width: 761px)').matches) focusAndCenter(amountRef.current); }, 0); }
  function openEntry() { setPaymentOpen(true); setError(''); focusAmount(); }
  function closePayment() {
    if(lock.current)return;
    if(hasDraft(form) && !window.confirm('Discard this unsaved payment and close?'))return;
    setPaymentOpen(false);setEditing(null);setForm(newEntry(entryDefaults(preferences)));setError('');
  }
  function startNew() {
    if (lock.current) return;
    if (hasDraft(form) && !window.confirm('Discard the unsaved entry and start a new payment?')) return;
    setEditing(null); setForm(newEntry(entryDefaults(preferences))); setPaymentOpen(true); setError(''); focusAmount();
  }
  function beginEdit(transaction) {
    if (lock.current || outbox.some(item=>item.id===transaction.id)) return;
    if (hasDraft(form) && !window.confirm('Discard the current draft and edit this payment?')) return;
    setEditing({...transaction,_endpoint:endpoint}); setForm(editEntry(transaction)); setPaymentOpen(true); setError(''); setNotice(''); focusAmount();
  }
  async function reloadConflictedEdit() {
    if (lock.current || !pending || outbox.length>1 || !window.confirm('Discard this attempted edit and load the latest saved payment?')) return;
    lock.current=true;setBusy(true);
    try {
      const result=await request(endpoint);
      const latest=result.transactions.find(t=>t.id===pending.id);
      persistOutbox([]);setEditConflict(false);setRows(result.transactions);
      setEditing(latest ? {...latest,_endpoint:endpoint} : null);setForm(latest ? editEntry(latest) : newEntry());setPaymentOpen(true);setError('');
      setNotice(latest?'Latest payment loaded. Review and save your changes.':'This payment was deleted. Your attempted edit was not applied.');
    } catch(e) {setError(e.message);} finally {lock.current=false;setBusy(false);}
  }
  function chooseCategory(value) { setForm(previous => ({...previous,category:value,direction:previous.explicitChoices?previous.direction:value==='Sale'?'in':'out'})); }
  function changeRecordType(value) {
    setForm(previous=>value==='transfer'
      ? {...previous,recordType:'transfer',category:'Transfer',direction:'transfer',method:'Transfer'}
      : value==='adjustment'
        ? {...previous,recordType:'adjustment',category:'Cashflow adjustment',direction:'adjustment',method:'Adjustment',adjustmentMethod:'Cash',countedBalance:'',preservedCashAdjustmentMinor:0,preservedOnlineAdjustmentMinor:0}
        : {...previous,recordType:'payment',category:categories.includes(previous.category)?previous.category:preferences.defaultCategory,direction:['in','out'].includes(previous.direction)?previous.direction:'in',method:methods.includes(previous.method)?previous.method:preferences.defaultMethod});
  }
  function partyPayment(party) {
    if(lock.current)return false;
    if (hasDraft(form) && !window.confirm('Discard the current payment draft?')) return false;
    setEditing(null);setForm(partyPaymentEntry(party));setPaymentOpen(true);setError('');focusAmount();return true;
  }
  function openSettings() { setUrl(endpoint); setError(''); setSettingsFeedback(''); setModal('settings'); }
  function openTweak(type) {
    if(lock.current||!endpoint)return;
    if(hasDraft(form)&&!window.confirm('Discard the current entry and open this balance tool?'))return;
    const next=newEntry(entryDefaults(preferences));
    if(type==='transfer')Object.assign(next,{recordType:'transfer',category:'Transfer',direction:'transfer',method:'Transfer'});
    else Object.assign(next,{recordType:'adjustment',category:'Cashflow adjustment',direction:'adjustment',method:'Adjustment',adjustmentMethod:'Cash',countedBalance:'',preservedCashAdjustmentMinor:0,preservedOnlineAdjustmentMinor:0});
    setEditing(null);setForm(next);setPaymentOpen(true);setError('');setModal('');setTimeout(()=>focusAndCenter(amountRef.current),0);
  }
  useEffect(() => { if (paymentOpen && !modal) focusAmount(); }, [paymentOpen, modal]);
  useEffect(() => {
    const handler = event => {
      if (modal || busy || (!paymentOpen && document.querySelector('dialog[open]'))) return;
      if (!paymentOpen && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase()==='i' && !event.repeat && !event.isComposing && !event.getModifierState?.('AltGraph')) {
        if (accounts.canQueue) { event.preventDefault(); setInvoiceCreateRequest(request=>request+1); }
        return;
      }
      const action = shortcutAction(event);
      if (!action || (action !== 'new' && !paymentOpen)) return;
      event.preventDefault();
      if (action==='new') startNew();
      else if (action==='save') { if (endpoint) formRef.current?.requestSubmit(); }
      else if (action==='payment-mode') { if (editing) return; changeRecordType('payment'); }
      else if (action==='exchange-cash-online' || action==='exchange-online-cash') { if (form.recordType!=='transfer') return;const direction=action==='exchange-cash-online'?'receive-cash-send-online':'receive-online-give-cash';update('exchangeDirection',direction);focusAndCenter(document.querySelector(`[data-shortcut="${action}"]`)); }
      else if (action==='adjustment-method') { if(form.recordType!=='adjustment')return;focusAndCenter(document.querySelector('[data-shortcut="adjustment-method"]')); }
      else if (['cash-received','cash-change','online-change'].includes(action)) { if (form.recordType==='transfer'||form.recordType==='adjustment') return;focusAndCenter(document.querySelector(`[data-shortcut="${action}"]`)); }
      else if (action==='cash-counted'||action==='online-counted') {if(form.recordType!=='adjustment')return;const adjustmentMethod=action==='cash-counted'?'Cash':'Online';setForm(previous=>({...previous,adjustmentMethod,countedBalance:previous.adjustmentMethod===adjustmentMethod?previous.countedBalance:''}));setTimeout(()=>focusAndCenter(document.querySelector(`[data-shortcut="${action}"]`)),0);}
      else if (form.recordType==='transfer' && !['amount','vendor','notes'].includes(action)) return;
      else if (form.recordType==='adjustment' && !['vendor','notes'].includes(action)) return;
      else if (action==='amount') focusAndCenter(document.querySelector('[data-shortcut="amount"]'));
      else if (action==='in' || action==='out') { update('direction',action);focusAndCenter(document.querySelector(`[data-shortcut="direction-${action}"]`)); }
      else if (action==='vendor' || action==='notes') focusAndCenter(document.querySelector(`[data-shortcut="${action}"]`));
      else if (action==='Cash' || action==='Online') { update('method',action);focusAndCenter(document.querySelector(`[data-shortcut="method-${action}"]`)); }
      else { chooseCategory(action);focusAndCenter(document.querySelector(`[data-shortcut="category-${action}"]`)); }
    };
    window.addEventListener('keydown',handler);
    return () => window.removeEventListener('keydown',handler);
  });
  useEffect(() => {
    const handler = event => { if (hasDraft(form)) { event.preventDefault(); event.returnValue=''; } };
    window.addEventListener('beforeunload',handler);
    return () => window.removeEventListener('beforeunload',handler);
  }, [form]);
  function selectPeriod(value) { setPeriod(value); if (value !== 'custom') setRange(periodRange(value)); }
  async function save(event, retry = false) {
    event?.preventDefault();
    if (lock.current || (outbox[0]?._status==='failed' && !retry)) return;
    setError('');
    if (!endpoint) { setError('Connect Google Sheets in settings before recording a payment.'); return; }
    let transaction;
    try {
      transaction = makeTransaction({...form,dateTime:form.customDate?form.dateTime:localNow(),expectedCashMinor:expectedCashForEntry,expectedOnlineMinor:expectedOnlineForEntry}, editing?.id);
      if (!transaction) return;
      if (transaction.partyId && !accountsEnabled) throw new Error('Update the Sheet backend to 1.8.0 before saving party-linked payments.');
      if ((transaction.recordType==='transfer' || Number(transaction.onlineChangeMinor||0)>0 || Number(transaction.cashChangeMinor||0)>0) && !versionAtLeast(connectionInfo?.version,'1.4.0')) throw new Error('Update Code.gs to version 1.4.0 before saving a cash/online exchange or a sale with change. Open Settings → Google Sheets setup, copy the included Code.gs, replace the Apps Script, and deploy a new version.');
      if (transaction.recordType==='adjustment' && !versionAtLeast(connectionInfo?.version,'1.6.0')) throw new Error('Update Code.gs to version 1.6.0 before saving cashflow adjustments. Open Settings → Google Sheets setup, copy the included Code.gs, replace the Apps Script, and deploy a new version.');
      if (retry) return retryUpload();
      if (!retry && editing) {
        if (editing._endpoint !== endpoint) throw new Error('Reconnect the original sheet before saving this edit.');
        transaction = {...transaction,_action:'update',_editId:crypto.randomUUID(),_expectedRevision:Number(editing.revision || 0)};
      }
      transaction = { ...transaction, _endpoint: endpoint, _action:transaction._action||'create', _queueId:crypto.randomUUID(), _status:'queued', _queuedAt:new Date().toISOString() };
      const next=[...outboxRef.current,transaction];
      if(!persistOutbox(next))return;
      setRows(previous=>applyQueuedOperation(previous,transaction));
      setEditing(null);setEditConflict(false);setForm(newEntry(transaction));setNotice('Saved on this device. Uploading to Google Sheets…');setPaymentOpen(false);
    } catch (e) { setError(e.message); return; }
  }
  function retryUpload() {
    const first=outboxRef.current[0];
    if(!first||first._status!=='failed')return;
    if(first._endpoint&&first._endpoint!==endpoint){setError('Reconnect the original Sheet before retrying this queued transaction.');return;}
    if(!first._endpoint&&!window.confirm('This saved payment has no recorded Sheet destination. Confirm that the currently connected Google Sheet is its intended destination before uploading.'))return;
    setEditConflict(first._errorCode==='EDIT_CONFLICT');
    persistOutbox(outboxRef.current.map((item,index)=>index===0?{...item,_endpoint:endpoint,_status:'queued',_error:null,_errorCode:null}:item));
    setError('');setNotice('Retrying upload to Google Sheets…');
  }
  async function connect(event) {
    event.preventDefault(); setError('');
    if (accounts.busy) { setError('Wait for the party or invoice request to finish.'); return; }
    if (editing) { setError('Finish or cancel your edit before changing connections.'); return; }
    if (pending && endpoint) { setError('Resolve the pending payment before changing connections.'); return; }
    try {
      const validated = validateEndpoint(url.trim());
      if (accounts.pending && accounts.pending.endpoint !== validated) throw new Error('Reconnect the original Sheet for your saved party or invoice request.');
      if (pending?._endpoint && pending._endpoint !== validated) throw new Error('Connect the original sheet for your pending payment.');
      if (lock.current) return;
      lock.current = true; setBusy(true);
      const result = await request(validated);
      let linkSaved = true;
      try { await saveEndpoint(validated); } catch { linkSaved = false; }
      if (validated !== endpoint) applyConnectionPreferences(validated);
      setRefreshReadError('');setEndpoint(validated); setUrl(validated); setRows(result.transactions); rememberInfo(validated, result); setSynced(true);
      setNotice(linkSaved ? 'Google Sheets connected. The link is saved in this browser.' : 'Google Sheets connected for this session, but browser storage blocked saving the link. Allow site storage and reconnect.');
      setModal('');
    } catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(false); }
  }
  async function disconnect() {
    if (lock.current) return;
    if (accounts.pending || accounts.busy) { setError('Resolve the saved party or invoice request before disconnecting.'); return; }
    if (pending) {setError('Resolve pending payments before disconnecting.');return;}
    if (editing) { setError('Finish or cancel your edit before disconnecting.'); return; }
    if (!window.confirm('Disconnect this browser? Your Google Sheet and transactions will remain unchanged.')) return;
    try {
      await clearEndpoint(); localStorage.removeItem('rf.connectionInfo');
      applyConnectionPreferences(''); setEndpoint(''); setUrl(''); setRows([]); setConnectionInfo(null); setSynced(false); setError(''); setNotice('This browser is disconnected.');
    } catch { setError('Could not remove the saved connection. Check browser storage permissions.'); }
  }
  function openActivity(row,action=''){
    if(row.kind==='invoice'){setInvoiceOpenRequest({id:row.record.id,action,request:Date.now()});return;}
    if(row.kind==='note'){setNoteOpenRequest({id:row.record.id,action,request:Date.now()});return;}
    if(action==='edit')beginEdit(row.record);
    else if(action==='delete')deleteTransaction(row.record);
    else setTransactionSelection({endpoint,id:row.record.id,record:row.record,action});
  }
  async function bulkDelete(selection){
    if(busy||accounts.busy||accounts.pending||outboxRef.current.length)return false;
    const invoices=selection.filter(row=>row.kind==='invoice').length,notes=selection.filter(row=>row.kind==='note').length,payments=selection.filter(row=>row.kind==='payment').length;
    selection=selection.map(row=>row.kind==='invoice'?{...row,expectedNotes:invoiceNoteRevision(accounts.notes,row.record.id)}:row);
    const reason=window.prompt(`Delete ${selection.length} selected records (${invoices} invoices, ${notes} notes, ${payments} payments)? Deleted invoices also remove their notes from the active ledger. All Sheet rows are retained. Enter a reason:`);
    if(!reason?.trim())return false;
    setError('');
    try{const fresh=await accounts.reload({fresh:true});if(!fresh)throw new Error('Refresh failed. Nothing was queued for deletion.');if(!versionAtLeast(fresh.backendVersion,'1.14.0'))throw new Error('Deploy backend 1.14.0 before bulk deletion.');const operations=planBulkDelete(selection,fresh,reason.trim());if(await accounts.queueDeletes(operations)){setNotice(`${selection.length} selected records queued for deletion. Follow progress in Sync status.`);return true;}}
    catch(error){setError(error.message);}return false;
  }
  async function deleteTransaction(transaction) {
    if (lock.current || outbox.some(item=>item.id===transaction.id)) return;
    if (!window.confirm(`Delete ${money(transaction.amountMinor)} · ${transaction.party || transaction.category} on ${transaction.transactionDate}? This removes it from your ledger and reports.`)) return;
    const operation={id:transaction.id,_action:'delete',_endpoint:endpoint,_queueId:crypto.randomUUID(),_status:'queued',_queuedAt:new Date().toISOString()};
    if(!persistOutbox([...outboxRef.current,operation]))return;
    setRows(previous=>applyQueuedOperation(previous,operation));setNotice('Deleted on this device. Uploading deletion to Google Sheets…');
  }
  const update = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  const invocation=<div className="app-invocation" lang="ar" dir="rtl">بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</div>;
  if (!connectionRestored) return <>{invocation}<main className="startup-loading" role="status">Restoring your saved Google Sheets connection…</main></>;
  return <>
    {invocation}
    <aside className="sidebar"><div className="brand-invocation" lang="ar" dir="rtl">یاحسین</div><a className="brand" href="#"><img className="brand-logo" src={brandLogo} alt=""/><span>{preferences.shopName}<span className="brand-sub">SHOP LEDGER</span></span></a><p className="nav-label">YOUR WORKSPACE</p>{[['dashboard','▦','Dashboard'],['accounts','◎','Parties'],['history','⇄','History']].map(([key,icon,label])=><button key={key} className={`nav-item ${view===key?'active':''}`} onClick={()=>setView(key)} aria-current={view===key?'page':undefined}>{icon} <span>{label}</span></button>)}<button className="nav-item" onClick={openSettings}>⚙ <span>Settings</span></button><div className="sidebar-bottom"><div className="shop-icon">RF</div><strong>{preferences.shopName}</strong><small>Your everyday shop ledger</small><button className="settings-link" onClick={() => {setUrl(endpoint);setModal('settings');setError('');}}>⚙ Connection settings</button></div></aside>
    <main><header className="topbar"><button className="outline" onClick={()=>{setUrl(endpoint);setModal('settings');setError('');}}>⚙ Settings</button>{installPrompt && <button className="outline install-button" onClick={installApp}>＋ Install app</button>}<span className={`connection ${synced ? 'connected' : ''}`}><i/> {refreshing?'Updating from Sheets…':synced ? 'Sheets connected' : endpoint ? 'Connection not verified' : 'Sheets not connected'}</span></header>
      {(view==='history'||view==='dashboard')&&<section className="heading"><div><h1>{view==='history'?'History':'Dashboard'}</h1></div>{<div className="dashboard-actions"><button className="primary" onClick={openEntry} disabled={busy}>＋ Record Payment <kbd>Alt + N</kbd></button><button className="outline" disabled={busy||!accounts.canQueue} onClick={()=>setInvoiceCreateRequest(request=>request+1)}>＋ New Invoice / Note <kbd>Alt + I</kbd></button><button className="outline" disabled={busy||!accounts.canQueue||!hasInvoiceDraft} onClick={()=>setInvoiceResumeRequest(request=>request+1)}>Resume draft</button></div>}</section>}
      {!endpoint && <div className="setup-banner"><div><strong>Let’s connect your ledger.</strong><span>Connect Google Sheets to start recording payments.</span></div><button onClick={() => {setUrl(endpoint);setModal('settings');setError('');}}>Connect Sheets ↗</button></div>}
      <div aria-live="polite">{notice && <p className="notice">{notice}</p>}{error && !modal && <p className="error" role="alert">{error}</p>}{refreshReadError && !modal && <p className="error" role="alert">{refreshReadError}</p>}</div>
      {cacheSavedAt && (refreshing || ((refreshReadError || error) && !synced)) && <div className={`cache-status ${(refreshReadError||error)&&!synced?'cache-stale':''}`} role="status" aria-live="polite">{refreshing&&<i className="upload-spinner" aria-hidden="true"/>}<span><strong>{refreshing?'Showing saved transactions while checking Google Sheets.':'Showing saved transactions; Google Sheets could not be refreshed.'}</strong><small>Last saved snapshot: {new Date(cacheSavedAt).toLocaleString()}</small></span>{(refreshReadError||error)&&!synced&&<button onClick={()=>refresh()} disabled={refreshing}>Retry refresh</button>}</div>}
      {integrityIssueCount>0 && <p className="integrity-warning" role="alert">{integrityIssueCount} Sheet record{integrityIssueCount===1?' has':'s have'} invalid or inconsistent transaction data. Affected records are excluded from totals; review those rows in Transactions before using the report.</p>}
      <SyncStatus endpoint={endpoint} accounts={accounts} outbox={outbox} synced={synced} refreshing={refreshing} readError={refreshReadError||(error&&!synced?error:'')} onRefresh={()=>refresh()} onRetryPayment={editConflict&&outbox.length===1?reloadConflictedEdit:retryUpload} onReviewAccounts={()=>setView('accounts')}/>
      {!accounts.pending&&accounts.lastInvoice&&<p className="notice" role="status">Invoice {accounts.lastInvoice.number} saved to Google Sheets. <button className="outline" onClick={()=>setInvoiceOpenRequest({id:accounts.lastInvoice.id,request:Date.now()})}>View invoice</button></p>}
      {transactionDetail&&<TransactionDetails preferences={preferences} initialAction={transactionSelection?.action} onPreparePrint={async()=>{const fresh=accountsEnabled?await accounts.reload({fresh:true}):await request(endpoint);const record=fresh?.transactions.find(row=>row.id===transactionDetail.id);if(!record)throw new Error('Refresh and confirm this payment before printing.');return record;}} onEdit={()=>{setTransactionSelection(null);beginEdit(transactionDetail);}} onDelete={()=>{setTransactionSelection(null);deleteTransaction(transactionDetail);}} transaction={transactionDetail} duplicate={duplicateIds.has(transactionDetail.id)} queued={outbox.filter(item=>item.id===transactionDetail.id).at(-1)} onClose={()=>setTransactionSelection(null)}/>}
      {paymentOpen&&<AccountDialog className="payment-dialog" title={editing?'Edit payment':form.recordType==='transfer'?'Cash ↔ Online exchange':form.recordType==='adjustment'?'Adjust a balance':form.partyId?`${form.direction==='in'?'Receive payment':form.direction==='out'?'Make payment':'Record payment'} · ${form.party}`:'Record Payment'} busy={busy} onClose={closePayment}>
        {error&&<p className="error" role="alert">{error}</p>}
        {pending?._status==='failed'&&<div className="account-pending" role="alert"><p>{pending._error||'A payment could not upload. Retry it before adding another.'}</p><button type="button" className="outline" onClick={editConflict&&outbox.length===1?reloadConflictedEdit:retryUpload}>{editConflict&&outbox.length===1?'Reload latest':'Retry upload'}</button></div>}
        <PaymentEntry compact parties={accounts.parties} accountsEnabled={accountsEnabled} editing={editing} cancelEdit={closePayment} returnToPayment={startNew} form={form} update={update} chooseCategory={chooseCategory} save={save} formRef={formRef} amountRef={amountRef} busy={busy} refreshing={refreshing} pending={pending} endpoint={endpoint} rows={rows} refresh={refresh} openHistory={()=>{closePayment();setView('history');}} focusAndCenter={focusAndCenter} expectedCashMinor={expectedCashForEntry} expectedOnlineMinor={expectedOnlineForEntry}/>
      </AccountDialog>}
      <div className={view==='accounts'?'accounts-view':'accounts-view screen-hidden'}><AccountsPanel itemDescriptionsEnabled={versionAtLeast(accounts.backendVersion||connectionInfo?.version,'1.15.2')} measurementEnabled={versionAtLeast(accounts.backendVersion||connectionInfo?.version,'1.15.0')} openingBalanceDeletionEnabled={versionAtLeast(accounts.backendVersion||connectionInfo?.version,'1.14.1')} challanEnabled={versionAtLeast(accounts.backendVersion||connectionInfo?.version,'1.13.0')} noteChangesEnabled={versionAtLeast(accounts.backendVersion || connectionInfo?.version,'1.12.0')} deletionEnabled={versionAtLeast(accounts.backendVersion || connectionInfo?.version,'1.11.0')} noteOpenRequest={noteOpenRequest} notesEnabled={versionAtLeast(accounts.backendVersion || connectionInfo?.version,'1.10.0')} invoiceEditingEnabled={versionAtLeast(accounts.backendVersion || connectionInfo?.version,'1.9.0')} invoiceResumeRequest={invoiceResumeRequest} onDraftChange={setHasInvoiceDraft} invoiceCreateRequest={invoiceCreateRequest} invoiceOpenRequest={invoiceOpenRequest} onNavigateParties={()=>setView('accounts')} onNavigateDashboard={()=>setView('dashboard')} key={endpoint} accounts={accounts} endpoint={endpoint} enabled={accountsEnabled} preferences={preferences} onPayment={partyPayment} paymentPending={!!pending}/></div>
      <div className={`report-view ${view==='accounts'?'screen-hidden':''}`}>
      <section className="period-bar"><div><span className="calendar-icon">▦</span><select aria-label="Report period" value={period} onChange={e => selectPeriod(e.target.value)}><option value="month">This month</option><option value="today">Today</option><option value="last">Last month</option><option value="custom">Custom period</option></select></div><div className="date-range"><input aria-label="Start date" type="date" value={range[0]} onChange={e => {setPeriod('custom');setRange([e.target.value,range[1]]);}}/><span>—</span><input aria-label="End date" type="date" value={range[1]} onChange={e => {setPeriod('custom');setRange([range[0],e.target.value]);}}/></div><button className="refresh" disabled={busy || refreshing || !endpoint} onClick={() => {refresh();}}>{refreshing ? '◌ Updating…' : '↻ Refresh'}</button></section>
      {range[0] > range[1] && <p className="error">The start date must be on or before the end date.</p>}
      {view==='dashboard'&&<DashboardOverview onCategory={name=>{setHistoryCategory(name);setMethod('');setQuery('');setView('history');}} accounts={accounts} transactions={calculationRows.filter(row=>!outbox.some(op=>op.id===row.id))} range={range} cash={expectedCash} online={expectedOnline}/>}
      {view==='history'&&<section className="history-controls"><div className="history-category-tabs" role="group" aria-label="Transaction category">{['',...categories].map(value=><button key={value||'all'} data-tone={value==='Sale'?'sale':value==='Purchase'?'purchase':undefined} type="button" className={historyCategory===value?'active':''} aria-pressed={historyCategory===value} onClick={()=>setHistoryCategory(value)}>{value||'All'}</button>)}</div><div className="activity-filters"><input type="search" aria-label="Search history" placeholder="Search party, reference, challan, item or notes…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Filter payment method" value={method} onChange={e=>setMethod(e.target.value)}><option value="">All payment methods</option>{methods.map(value=><option key={value}>{value}</option>)}<option value="Transfer">Cash/Online exchange</option><option value="Adjustment">Cashflow adjustment</option></select><button type="button" className="outline" onClick={()=>window.print()}>Print history</button></div></section>}
      <ActivityTable key={view} accounts={accounts} transactions={rows} outbox={outbox} range={range} category={view==='history'?historyCategory:''} method={view==='history'?method:''} query={view==='history'?query:''} history={view==='history'} printing={printingTransactions} editingEnabled={versionAtLeast(accounts.backendVersion||connectionInfo?.version,'1.9.0')} deletionEnabled={versionAtLeast(accounts.backendVersion||connectionInfo?.version,'1.11.0')} noteChangesEnabled={versionAtLeast(accounts.backendVersion||connectionInfo?.version,'1.12.0')} bulkDeleteEnabled={versionAtLeast(accounts.backendVersion||connectionInfo?.version,'1.14.0')&&!outbox.length} onBulkDelete={bulkDelete} paymentBusy={busy||!endpoint||!!accounts.pending} onOpen={row=>openActivity(row)} onEdit={row=>openActivity(row,'edit')} onDelete={row=>openActivity(row,'delete')} onPrint={row=>openActivity(row,'print')} onHistory={()=>{setHistoryCategory('');setView('history');}}/>
      </div><footer>{preferences.shopName}<a href="https://www.instagram.com/royalfurniture45/" target="_blank" rel="noreferrer">Instagram · @royalfurniture45</a><span>Apne Gar ko do ROYAL touch</span><button onClick={()=>{setUrl(endpoint);setModal('settings');setError('');}}>Settings</button></footer>
    </main>
    <nav className="mobile-nav" aria-label="Main navigation">{[['dashboard','▦','Dashboard'],['accounts','◎','Parties'],['history','⇄','History']].map(([key,icon,label])=><button key={key} className={!modal && view===key?'active':''} aria-current={!modal && view===key?'page':undefined} onClick={()=>setView(key)}><span>{icon}</span>{label}</button>)}<button onClick={openSettings}><span>⚙</span>Settings</button></nav>
    <dialog className={modal==='settings' ? 'settings-dialog' : ''} ref={dialog} onCancel={e => {if(busy)e.preventDefault();else setModal('');}}><div className="dialog-heading"><div><p className="eyebrow">SHOP LEDGER</p><h2>Settings & sheet setup</h2></div><button className="close" aria-label="Close dialog" disabled={busy} onClick={()=>setModal('')}>×</button></div>{error && <p className="error" role="alert">{error}</p>}
      {modal && <Settings preferences={preferences} savePreferences={savePreferences} range={range} exportCsv={exportCsv} deleted={deleted} loadDeleted={loadDeleted} restore={restore} feedback={settingsFeedback} endpoint={endpoint} info={connectionInfo} synced={synced} url={url} setUrl={setUrl} connect={connect} disconnect={disconnect} busy={busy||accounts.busy} pending={pending||accounts.pending} openTweak={openTweak}/>}

    </dialog>
  </>;
}
createRoot(document.getElementById('root')).render(<App/>);
