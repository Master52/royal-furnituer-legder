import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { categories, methods, money, localNow, periodRange, filterTransactions, totals, sumAmounts, makeTransaction, paymentMethodTotals, paymentMethodBalance, transactionIntegrityIssue, duplicateTransactionIds, SHOP_TIMEZONE } from './ledger.js';
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
import PaymentEntry from './PaymentEntry.jsx';
import { newEntry, editEntry, hasDraft, shortcutAction, focusAndCenter } from './entry.js';
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

const symbols = { Sale: '↗', Purchase: '↙', Bhara: '⇄', Expense: '−', 'Cashflow adjustment':'±' };
const dashboardCategoryOrder=['Sale','Purchase','Expense','Bhara'];
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
  const [connectionInfo, setConnectionInfo] = useState(() => { const saved = read('rf.connectionInfo', null); return saved?.endpoint === endpoint ? saved : null; });
  const [outbox,setOutbox]=useState(initialOutbox);
  const outboxRef=useRef(outbox);
  outboxRef.current=outbox;
  const pending=outbox[0]||null;
  const [period, setPeriod] = useState('month');
  const [range, setRange] = useState(() => periodRange('month'));
  const [category, setCategory] = useState('');
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
  const [view, setView] = useState('entry');
  const [editing, setEditing] = useState(null);
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
  const visible = filterTransactions(rows, { start: range[0], end: range[1], category, method, query });
  const summary = totals(visible.filter(t=>!duplicateIds.has(t.id)));
  const categoryRows = filterTransactions(calculationRows, { start: range[0], end: range[1], method, query }).filter(t=>!transactionIntegrityIssue(t));
  const paymentMethodSummary = paymentMethodTotals(calculationRows, { start: range[0], end: range[1], category, query });
  const allTimePaymentMethodSummary = useMemo(()=>paymentMethodBalance(calculationRows),[calculationRows]);
  const expectedCash=allTimePaymentMethodSummary.Cash;
  const expectedOnline=allTimePaymentMethodSummary.Online;
  const availableBalance=expectedCash+expectedOnline;
  const expectedCashForEntry=editing?.recordType==='adjustment'?expectedCash-Number(editing.cashAdjustmentMinor||0):expectedCash;
  const expectedOnlineForEntry=editing?.recordType==='adjustment'?expectedOnline-Number(editing.onlineAdjustmentMinor||0):expectedOnline;
  const methodTotal = (paymentMethod, direction) => paymentMethodSummary[paymentMethod][direction];
  const integrityIssueCount=rows.filter(transactionIntegrityIssue).length+rows.filter(t=>duplicateIds.has(t.id)).length;
  useEffect(()=>{
    if(!connectionRestored||!endpoint)return;
    saveTransactionCache(endpoint,rows,cacheSavedAt||new Date().toISOString()).catch(()=>{});
  },[rows,endpoint,connectionRestored,cacheSavedAt]);
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).catch(() => {});
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
      setSettingsFeedback('Payment restored to its original date. Refresh the Sheet Report tab to update its snapshot.');
    } catch(e) {setError(`${e.message} Reload deleted transactions to check the result, or retry Restore safely.`);} finally {lock.current=false;setBusy(false);}
  }
  function rememberInfo(target, result) {
    const info = { ...backendInfo(result), endpoint: target };
    setConnectionInfo(info);
    try { write('rf.connectionInfo', info); } catch { /* A later successful read can restore version info. */ }
  }
  async function refresh(target = endpoint) {
    if (!target || refreshInFlight.current) return;
    refreshInFlight.current=true;setRefreshing(true);setError('');
    try {
      const result=await request(target);
      if(target!==endpointRef.current)return;
      const savedAt=new Date().toISOString();
      setRows(overlayOutbox(result.transactions,outboxRef.current,target));setCacheSavedAt(savedAt);rememberInfo(target,result);setSynced(true);setNotice('Up to date with Google Sheets.');
      saveTransactionCache(target,result.transactions,savedAt).catch(()=>{});
    }
    catch (e) { if(target===endpointRef.current){setError(e.message);setSynced(false);} }
    finally { refreshInFlight.current=false;setRefreshing(false); }
  }
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
        refresh(saved);
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
        persistOutbox(remaining);setSynced(true);setNotice(`${first._action==='delete'?'Transaction deleted':first._action==='update'?'Changes saved':'Transaction saved'} to Google Sheets.`);
      } catch(e) {
        {
          const latest=outboxRef.current.map((item,index)=>index===0?{...item,_status:'failed',_error:e.message,_errorCode:e.code}:item);
          persistOutbox(latest);setSynced(false);if(e.code==='EDIT_CONFLICT')setEditConflict(true);
        }
      } finally { outboxProcessing.current=false; }
    })();
  },[outbox,endpoint,connectionRestored,busy,refreshing]);
  useEffect(()=>{ document.documentElement.dataset.theme=preferences.theme; document.documentElement.dataset.textSize=preferences.largeText?'large':'normal'; document.documentElement.dataset.printNotes=String(preferences.printNotes); document.title=preferences.shopName+' | Shop Ledger'; const description=document.querySelector('meta[name="description"]'); if(description) description.content='Royal Furnitures — Apne Gar ko do ROYAL touch sirf Royal Furnitures se. Shop ledger for payments, purchases, transport and expenses.'; },[preferences]);
  useEffect(() => { if (modal) dialog.current?.showModal(); else dialog.current?.close(); }, [modal]);
  function focusAmount() { setTimeout(() => { if (window.matchMedia('(min-width: 761px)').matches) focusAndCenter(amountRef.current); }, 0); }
  function openEntry() { setView('entry'); setError(''); focusAmount(); }
  function startNew() {
    if (lock.current) return;
    if (hasDraft(form) && !window.confirm('Discard the unsaved entry and start a new payment?')) return;
    setEditing(null); setForm(newEntry(entryDefaults(preferences))); setView('entry'); setError(''); focusAmount();
  }
  function beginEdit(transaction) {
    if (lock.current || outbox.some(item=>item.id===transaction.id)) return;
    if (hasDraft(form) && !window.confirm('Discard the current draft and edit this payment?')) return;
    setEditing({...transaction,_endpoint:endpoint}); setForm(editEntry(transaction)); setView('entry'); setError(''); setNotice(''); focusAmount();
  }
  async function reloadConflictedEdit() {
    if (lock.current || !pending || outbox.length>1 || !window.confirm('Discard this attempted edit and load the latest saved payment?')) return;
    lock.current=true;setBusy(true);
    try {
      const result=await request(endpoint);
      const latest=result.transactions.find(t=>t.id===pending.id);
      persistOutbox([]);setEditConflict(false);setRows(result.transactions);
      setEditing(latest ? {...latest,_endpoint:endpoint} : null);setForm(latest ? editEntry(latest) : newEntry());setView('entry');setError('');
      setNotice(latest?'Latest payment loaded. Review and save your changes.':'This payment was deleted. Your attempted edit was not applied.');
    } catch(e) {setError(e.message);} finally {lock.current=false;setBusy(false);}
  }
  function chooseCategory(value) { setForm(previous => ({...previous,category:value,direction:value==='Sale'?'in':'out'})); }
  function changeRecordType(value) {
    setForm(previous=>value==='transfer'
      ? {...previous,recordType:'transfer',category:'Transfer',direction:'transfer',method:'Transfer'}
      : value==='adjustment'
        ? {...previous,recordType:'adjustment',category:'Cashflow adjustment',direction:'adjustment',method:'Adjustment',adjustmentMethod:'Cash',countedBalance:'',preservedCashAdjustmentMinor:0,preservedOnlineAdjustmentMinor:0}
        : {...previous,recordType:'payment',category:categories.includes(previous.category)?previous.category:preferences.defaultCategory,direction:['in','out'].includes(previous.direction)?previous.direction:'in',method:methods.includes(previous.method)?previous.method:preferences.defaultMethod});
  }
  function openSettings() { setUrl(endpoint); setError(''); setSettingsFeedback(''); setModal('settings'); }
  function openTweak(type) {
    if(lock.current||!endpoint)return;
    if(hasDraft(form)&&!window.confirm('Discard the current entry and open this balance tool?'))return;
    const next=newEntry(entryDefaults(preferences));
    if(type==='transfer')Object.assign(next,{recordType:'transfer',category:'Transfer',direction:'transfer',method:'Transfer'});
    else Object.assign(next,{recordType:'adjustment',category:'Cashflow adjustment',direction:'adjustment',method:'Adjustment',adjustmentMethod:'Cash',countedBalance:'',preservedCashAdjustmentMinor:0,preservedOnlineAdjustmentMinor:0});
    setEditing(null);setForm(next);setView('entry');setError('');setModal('');setTimeout(()=>focusAndCenter(amountRef.current),0);
  }
  useEffect(() => { if (view==='entry' && !modal) focusAmount(); }, [view, modal]);
  useEffect(() => {
    const handler = event => {
      if (modal || busy) return;
      const action = shortcutAction(event);
      if (!action || (action !== 'new' && view !== 'entry')) return;
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
      setEditing(null);setEditConflict(false);setForm(newEntry(transaction));setNotice('Saved on this device. Uploading to Google Sheets…');focusAmount();
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
    if (editing) { setError('Finish or cancel your edit before changing connections.'); return; }
    if (pending && endpoint) { setError('Resolve the pending payment before changing connections.'); return; }
    try {
      const validated = validateEndpoint(url.trim());
      if (pending?._endpoint && pending._endpoint !== validated) throw new Error('Connect the original sheet for your pending payment.');
      if (lock.current) return;
      lock.current = true; setBusy(true);
      const result = await request(validated);
      let linkSaved = true;
      try { await saveEndpoint(validated); } catch { linkSaved = false; }
      if (validated !== endpoint) applyConnectionPreferences(validated);
      setEndpoint(validated); setUrl(validated); setRows(result.transactions); rememberInfo(validated, result); setSynced(true);
      setNotice(linkSaved ? 'Google Sheets connected. The link is saved in this browser.' : 'Google Sheets connected for this session, but browser storage blocked saving the link. Allow site storage and reconnect.');
      setModal('');
    } catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(false); }
  }
  async function disconnect() {
    if (lock.current) return;
    if (editing) { setError('Finish or cancel your edit before disconnecting.'); return; }
    if (!window.confirm('Disconnect this browser? Your Google Sheet and transactions will remain unchanged.')) return;
    try {
      await clearEndpoint(); localStorage.removeItem('rf.connectionInfo');
      applyConnectionPreferences(''); setEndpoint(''); setUrl(''); setRows([]); setConnectionInfo(null); setSynced(false); setError(''); setNotice('This browser is disconnected.');
    } catch { setError('Could not remove the saved connection. Check browser storage permissions.'); }
  }
  async function deleteTransaction(transaction) {
    if (lock.current || outbox.some(item=>item.id===transaction.id)) return;
    if (!window.confirm(`Delete ${money(transaction.amountMinor)} · ${transaction.party || transaction.category} on ${transaction.transactionDate}? This removes it from your ledger and reports.`)) return;
    const operation={id:transaction.id,_action:'delete',_endpoint:endpoint,_queueId:crypto.randomUUID(),_status:'queued',_queuedAt:new Date().toISOString()};
    if(!persistOutbox([...outboxRef.current,operation]))return;
    setRows(previous=>applyQueuedOperation(previous,operation));setNotice('Deleted on this device. Uploading deletion to Google Sheets…');
  }
  const update = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  if (!connectionRestored) return <main className="startup-loading" role="status">Restoring your saved Google Sheets connection…</main>;
  return <>
    <aside className="sidebar"><a className="brand" href="#"><img className="brand-logo" src={brandLogo} alt=""/><span>{preferences.shopName}<span className="brand-sub">SHOP LEDGER</span></span></a><p className="nav-label">YOUR WORKSPACE</p>{[['entry','＋','New transaction'],['history','⇄','History'],['dashboard','▦','Dashboard']].map(([key,icon,label])=><button key={key} className={`nav-item ${view===key?'active':''}`} onClick={()=>setView(key)} aria-current={view===key?'page':undefined}>{icon} <span>{label}</span></button>)}<button className="nav-item" onClick={openSettings}>⚙ <span>Settings</span></button><div className="sidebar-bottom"><div className="shop-icon">RF</div><strong>{preferences.shopName}</strong><small>Your everyday shop ledger</small><button className="settings-link" onClick={() => {setUrl(endpoint);setModal('settings');setError('');}}>⚙ Connection settings</button></div></aside>
    <main><header className="topbar"><button className="outline" onClick={()=>{setUrl(endpoint);setModal('settings');setError('');}}>⚙ Settings</button>{installPrompt && <button className="outline install-button" onClick={installApp}>＋ Install app</button>}<span className={`connection ${synced ? 'connected' : ''}`}><i/> {refreshing?'Updating from Sheets…':synced ? 'Sheets connected' : endpoint ? 'Connection not verified' : 'Sheets not connected'}</span></header>
      <section className="heading"><div><p className="eyebrow shop-tagline">Apne Gar ko do ROYAL touch sirf Royal Furnitures se</p><h1>{view==='entry'?(editing?`Edit ${editing.recordType==='transfer'?'cash/online exchange':editing.recordType==='adjustment'?'cashflow adjustment':'payment'}.`:form.recordType==='transfer'?'Cash & online exchange.':form.recordType==='adjustment'?'Adjust a balance.':'Record a payment.'):view==='history'?'Transaction history.':'Your shop, at a glance.'}</h1><p>{view==='entry'?(form.recordType==='transfer'?'Record an exchange between cash and online balances.':form.recordType==='adjustment'?'Correct one expected balance at a time.':'Quick entry. Clear records. Ready for the next customer.'):'Keep track of every payment. Keep business moving.'}</p></div><button className="primary" onClick={view==='entry'?startNew:openEntry} disabled={busy}>＋ {view==='entry'?'New entry':'Add transaction'} <kbd>Alt + N</kbd></button></section>
      {!endpoint && <div className="setup-banner"><div><strong>Let’s connect your ledger.</strong><span>Connect Google Sheets to start recording payments.</span></div><button onClick={() => {setUrl(endpoint);setModal('settings');setError('');}}>Connect Sheets ↗</button></div>}
      <div aria-live="polite">{notice && <p className="notice">{notice}</p>}{error && !modal && <p className="error" role="alert">{error}</p>}</div>
      {cacheSavedAt && (refreshing || (error && !synced)) && <div className={`cache-status ${error&&!synced?'cache-stale':''}`} role="status" aria-live="polite">{refreshing&&<i className="upload-spinner" aria-hidden="true"/>}<span><strong>{refreshing?'Showing saved transactions while checking Google Sheets.':'Showing saved transactions; Google Sheets could not be refreshed.'}</strong><small>Last saved snapshot: {new Date(cacheSavedAt).toLocaleString()}</small></span>{error&&!synced&&<button onClick={()=>refresh()} disabled={refreshing}>Retry refresh</button>}</div>}
      {integrityIssueCount>0 && <p className="integrity-warning" role="alert">{integrityIssueCount} Sheet record{integrityIssueCount===1?' has':'s have'} invalid or inconsistent transaction data. Affected records are excluded from totals; review those rows in Transactions before using the report.</p>}
      {pending && <div className={`upload-status ${pending._status==='failed'?'failed':''}`} role={pending._status==='failed'?'alert':'status'} aria-live="polite"><span className={pending._status==='failed'?'':'upload-spinner'} aria-hidden="true">{pending._status==='failed'?'!':''}</span><div><strong>{pending._status==='failed'?'Could not upload to Google Sheets':pending._action==='delete'?'Uploading deletion to Google Sheets…':pending._action==='update'?'Uploading changes to Google Sheets…':'Uploading transaction to Google Sheets…'}</strong>{outbox.length>1&&<small>{outbox.length-1} more change{outbox.length===2?'':'s'} waiting</small>}{pending._status==='failed'&&<small>{pending._error||'Check your connection and retry.'}</small>}</div>{pending._status==='failed'&&<button onClick={editConflict&&outbox.length===1?reloadConflictedEdit:retryUpload}>{editConflict&&outbox.length===1?'Reload latest':'Retry upload'}</button>}</div>}
      {view==='entry' && <PaymentEntry editing={editing} cancelEdit={startNew} returnToPayment={startNew} form={form} update={update} chooseCategory={chooseCategory} save={save} formRef={formRef} amountRef={amountRef} busy={busy} refreshing={refreshing} pending={pending} endpoint={endpoint} rows={rows} refresh={refresh} openHistory={()=>setView('history')} focusAndCenter={focusAndCenter} expectedCashMinor={expectedCashForEntry} expectedOnlineMinor={expectedOnlineForEntry}/>}
      <div className={`report-view ${view==='entry'?'screen-hidden':''}`}>
      <section className="period-bar"><div><span className="calendar-icon">▦</span><select aria-label="Report period" value={period} onChange={e => selectPeriod(e.target.value)}><option value="month">This month</option><option value="today">Today</option><option value="last">Last month</option><option value="custom">Custom period</option></select></div><div className="date-range"><input aria-label="Start date" type="date" value={range[0]} onChange={e => {setPeriod('custom');setRange([e.target.value,range[1]]);}}/><span>—</span><input aria-label="End date" type="date" value={range[1]} onChange={e => {setPeriod('custom');setRange([range[0],e.target.value]);}}/></div><button className="refresh" disabled={busy || refreshing || !endpoint} onClick={() => refresh()}>{refreshing ? '◌ Updating…' : '↻ Refresh'}</button></section>
      {range[0] > range[1] && <p className="error">The start date must be on or before the end date.</p>}
      <div className={view==='dashboard'?'dashboard-overview':'dashboard-overview screen-hidden'}><div className="section-title dashboard-category-heading"><h2>Sales, purchases & expenses</h2><span>For the selected period</span></div><section className="category-grid">{dashboardCategoryOrder.map(name => { const records = categoryRows.filter(t => t.category === name); return <button key={name} aria-pressed={category===name} className={`category-card tone-${categories.indexOf(name)} ${category===name?'selected':''}`} onClick={() => setCategory(category===name?'':name)}><span className="category-symbol">{symbols[name]}</span><span className="category-name">{name}<small>{name==='Bhara'?'Transport & delivery':`${records.length} transaction${records.length===1?'':'s'}`}</small></span><strong>{money(sumAmounts(records))}</strong><span className="card-arrow">↗</span></button>; })}</section>
      <section className="current-balances"><div className="section-title"><div><h2>Current balances</h2><span>All-time expected balances from recorded cash and online movements.</span></div></div><div className="current-balance-grid"><article className="summary-card balance-card"><div><span>Cash in hand</span><b>₹</b></div><h2>{money(expectedCash)}</h2><p>Expected cash balance</p></article><article className="summary-card balance-card online-balance"><div><span>Online balance</span><b>↗</b></div><h2>{money(expectedOnline)}</h2><p>Expected online balance</p></article><article className="summary-card balance-card available-balance"><div><span>Available balance</span><b>Σ</b></div><h2>{money(availableBalance)}</h2><p>Cash in hand + online</p></article></div></section>
      <section className="payment-breakdown"><div className="section-title"><h2>Cash & online</h2><span>For the selected period</span></div><div className="payment-method-grid" aria-label="Cash and online payment totals"><article className="method-total period-total"><span>Total payment in</span><strong>{money(summary.in)}</strong><small>Money received · selected period</small></article><article className="method-total period-total"><span>Total payment out</span><strong>{money(summary.out)}</strong><small>Money paid · selected period</small></article>{[['Cash received','Cash','in'],['Online received','Online','in'],['Cash paid','Cash','out'],['Online paid','Online','out']].map(([label,paymentMethod,direction])=><article className={`method-total ${direction}`} key={label}><span>{label}</span><strong>{money(methodTotal(paymentMethod,direction))}</strong><small>Payment {direction} · {paymentMethod}</small></article>)}</div></section>
      </div><section className="transactions" id="transactions"><div className="transaction-heading"><div><h2>Transactions</h2><p>Every payment, all in one place.</p></div><button className="outline" onClick={() => window.print()}>▤ Print A4 report</button></div><div className="filters"><input type="search" aria-label="Search transactions" placeholder="Search name or notes…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Filter category" value={category} onChange={e=>setCategory(e.target.value)}><option value="">All types</option>{categories.map(c=><option key={c}>{c}</option>)}<option value="Transfer">Cash/Online exchange</option><option value="Cashflow adjustment">Cashflow adjustment</option></select><select aria-label="Filter payment method" value={method} onChange={e=>setMethod(e.target.value)}><option value="">All payment methods</option>{methods.map(m=><option key={m}>{m}</option>)}<option value="Transfer">Cash/Online exchange</option><option value="Adjustment">Cashflow adjustment</option></select></div>
      <div className="print-heading"><div className="print-brand"><img src={brandLogo} alt=""/><div><h1>{preferences.shopName}</h1><p className="print-tagline">Apne Gar ko do ROYAL touch sirf Royal Furnitures se</p></div></div>{preferences.printContact && <div className="print-contact">{preferences.address && <p>{preferences.address}</p>}{preferences.phone && <p>Phone: {preferences.phone}</p>}</div>}<h2>Transaction report</h2><p>{range[0]} to {range[1]} · {category || 'All types'} · {method || 'All payment methods'}{query && ` · Search: ${query}`}</p><p>Payment in: {money(summary.in)} · Payment out: {money(summary.out)}</p><p>{synced ? 'Google Sheets records' : 'Cached records — refresh to confirm latest data'} · Timezone: {SHOP_TIMEZONE}</p></div>
      {visible.length ? <div className="table-wrap"><table><thead><tr><th>Transaction / Party</th><th>Date & time</th><th>Payment</th><th className="notes-heading">Notes</th><th className="amount">Amount</th></tr></thead><tbody>{visible.map(t=>{const transfer=t.recordType==='transfer';const adjustment=t.recordType==='adjustment';const title=adjustment?'Cashflow adjustment':transfer?'Cash/Online exchange':t.party||t.category;const rowQueued=outbox.some(item=>item.id===t.id);return <tr key={t.id}><td><span className={`row-symbol ${t.direction}`}>{symbols[t.category] || '⇄'}</span><div className="party"><strong>{title}</strong><small>{adjustment?'Balance correction':transfer?`${t.fromMethod} → ${t.toMethod}`:`${t.category}${t.category==='Bhara'?' · Delivery':''}`}</small></div></td><td>{t.transactionDate}<small>{t.transactionTime}</small></td><td><span className="badge">{adjustment?'Cash & online':transfer?`${t.fromMethod} → ${t.toMethod}`:t.method}</span>{!transfer && t.chequeDate && <small>Given: {t.chequeDate}</small>}{!transfer && Number(t.cashReceivedMinor)>Number(t.amountMinor) && <small>Cash received {money(t.cashReceivedMinor)} · Cash change {money(t.cashChangeMinor || 0)} · Online change {money(t.onlineChangeMinor || 0)}</small>}{adjustment && <small>Cash {money(t.expectedCashMinor)} → {money(t.countedCashMinor)} · Online {money(t.expectedOnlineMinor)} → {money(t.countedOnlineMinor)}</small>}{transfer && <small>Balance exchange · no income/expense</small>}</td><td className="notes-cell">{t.notes || '—'}</td><td className={`amount ${t.direction==='in'?'in':t.direction==='out'?'out':''}`}>{adjustment?'±':t.direction==='in'?'+':t.direction==='out'?'−':''}{money(t.amountMinor)}<small>{adjustment?'Balance adjustment':transfer?'Balance exchange':`Payment ${t.direction}`}</small><button className="edit-transaction" disabled={busy || rowQueued || !endpoint} aria-label={`Edit transaction for ${title}, ${money(t.amountMinor)}`} onClick={()=>beginEdit(t)}>Edit</button><button className="delete-transaction" disabled={busy || rowQueued || !endpoint} aria-label={`Delete transaction for ${title}, ${money(t.amountMinor)}, ${t.transactionDate}`} onClick={()=>deleteTransaction(t)}>Delete</button></td></tr>;})}</tbody></table></div> : <div className="empty"><span>▤</span><h3>No transactions in this period</h3><p>{rows.length ? 'Try a different period or clear your filters.' : 'Your first payment is the start of a clearer picture.'}</p><button onClick={openEntry}>＋ Record a payment</button></div>}
      <div className="table-footer"><span>{visible.length} transaction{visible.length===1?'':'s'}</span><span>Amounts in INR · {SHOP_TIMEZONE}</span></div></section></div><footer>{preferences.shopName}<a href="https://www.instagram.com/royalfurniture45/" target="_blank" rel="noreferrer">Instagram · @royalfurniture45</a><span>Apne Gar ko do ROYAL touch</span><button onClick={()=>{setUrl(endpoint);setModal('settings');setError('');}}>Settings</button></footer>
    </main>
    <nav className="mobile-nav" aria-label="Main navigation">{[['entry','＋','Entry'],['history','⇄','History'],['dashboard','▦','Dashboard']].map(([key,icon,label])=><button key={key} className={!modal && view===key?'active':''} aria-current={!modal && view===key?'page':undefined} onClick={()=>setView(key)}><span>{icon}</span>{label}</button>)}<button onClick={openSettings}><span>⚙</span>Settings</button></nav>
    <dialog className={modal==='settings' ? 'settings-dialog' : ''} ref={dialog} onCancel={e => {if(busy)e.preventDefault();else setModal('');}}><div className="dialog-heading"><div><p className="eyebrow">SHOP LEDGER</p><h2>Settings & sheet setup</h2></div><button className="close" aria-label="Close dialog" disabled={busy} onClick={()=>setModal('')}>×</button></div>{error && <p className="error" role="alert">{error}</p>}
      {modal && <Settings preferences={preferences} savePreferences={savePreferences} range={range} exportCsv={exportCsv} deleted={deleted} loadDeleted={loadDeleted} restore={restore} feedback={settingsFeedback} endpoint={endpoint} info={connectionInfo} synced={synced} url={url} setUrl={setUrl} connect={connect} disconnect={disconnect} busy={busy} pending={pending} openTweak={openTweak}/>}

    </dialog>
  </>;
}
createRoot(document.getElementById('root')).render(<App/>);
