import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { categories, methods, money, localNow, periodRange, filterTransactions, totals, sumAmounts, makeTransaction, paymentMethodTotals, transactionIntegrityIssue, duplicateTransactionIds, SHOP_TIMEZONE } from './ledger.js';
import { request, validateEndpoint } from './api.js';
import Settings from './Settings.jsx';
import { backendInfo } from './backend.js';
import { normalizePreferences, preferenceKey, entryDefaults, csvForTransactions, downloadText } from './preferences.js';
import './styles.css';
import './pwa.css';
import './branding.css';
import './dashboard.css';
import './settlement.css';
import PaymentEntry from './PaymentEntry.jsx';
import { newEntry, editEntry, hasDraft, shortcutAction, focusAndCenter } from './entry.js';
import { readEndpoint, loadEndpoint, saveEndpoint, clearEndpoint } from './storage.js';

function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

const symbols = { Sale: '↗', Purchase: '↙', Bhara: '⇄', Expense: '−' };
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
  const [preferences,setPreferences] = useState(()=>normalizePreferences(read(preferenceKey(endpoint), {})));
  const [deleted,setDeleted] = useState(null);
  const [settingsFeedback,setSettingsFeedback] = useState('');
  const [rows, setRows] = useState([]);
  const [connectionInfo, setConnectionInfo] = useState(() => { const saved = read('rf.connectionInfo', null); return saved?.endpoint === endpoint ? saved : null; });
  const [pending, setPending] = useState(() => read(pendingKey, null));
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
  const dialog = useRef(null);
  const duplicateIds=duplicateTransactionIds(rows);
  const calculationRows=rows.filter(t=>!duplicateIds.has(t.id));
  const visible = filterTransactions(rows, { start: range[0], end: range[1], category, method, query });
  const summary = totals(visible.filter(t=>!duplicateIds.has(t.id)));
  const categoryRows = filterTransactions(calculationRows, { start: range[0], end: range[1], method, query }).filter(t=>!transactionIntegrityIssue(t));
  const paymentMethodSummary = paymentMethodTotals(calculationRows, { start: range[0], end: range[1], category, query });
  const methodTotal = (paymentMethod, direction) => paymentMethodSummary[paymentMethod][direction];
  const integrityIssueCount=rows.filter(transactionIntegrityIssue).length+rows.filter(t=>duplicateIds.has(t.id)).length;
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
      const result=await request(endpoint);setRows(result.transactions);rememberInfo(endpoint,result);setSynced(true);
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
      const current=await request(endpoint);setRows(current.transactions);setSynced(true);
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
    if (!target || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { const result = await request(target); setRows(result.transactions); rememberInfo(target, result); setSynced(true); setNotice('Up to date with Google Sheets.'); }
    catch (e) { setError(e.message); setSynced(false); }
    finally { lock.current = false; setBusy(false); }
  }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadEndpoint();
      if (cancelled) return;
      if (saved) {
        if (saved !== endpoint) {
          setEndpoint(saved);
          setUrl(saved);
          applyConnectionPreferences(saved);
        }
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
  useEffect(()=>{ document.documentElement.dataset.theme=preferences.theme; document.documentElement.dataset.textSize=preferences.largeText?'large':'normal'; document.documentElement.dataset.printNotes=String(preferences.printNotes); document.title=preferences.shopName+' | Shop Ledger'; const description=document.querySelector('meta[name="description"]'); if(description) description.content='Royal Furnitures — Apne Gar ko do ROYAL touch sirf Royal Furnitures se. Shop ledger for payments, purchases, transport and expenses.'; },[preferences]);
  useEffect(() => { if (modal) dialog.current?.showModal(); else dialog.current?.close(); }, [modal]);
  function focusAmount() { setTimeout(() => { if (window.matchMedia('(min-width: 761px)').matches) focusAndCenter(amountRef.current); }, 0); }
  function openEntry() { setView('entry'); setError(''); focusAmount(); }
  function startNew() {
    if (lock.current || pending) return;
    if (hasDraft(form) && !window.confirm('Discard the unsaved entry and start a new payment?')) return;
    setEditing(null); setForm(newEntry(entryDefaults(preferences))); setView('entry'); setError(''); focusAmount();
  }
  function beginEdit(transaction) {
    if (lock.current || pending) return;
    if (hasDraft(form) && !window.confirm('Discard the current draft and edit this payment?')) return;
    setEditing({...transaction,_endpoint:endpoint}); setForm(editEntry(transaction)); setView('entry'); setError(''); setNotice(''); focusAmount();
  }
  async function reloadConflictedEdit() {
    if (lock.current || !pending || !window.confirm('Discard this attempted edit and load the latest saved payment?')) return;
    lock.current=true;setBusy(true);
    try {
      const result=await request(endpoint);
      const latest=result.transactions.find(t=>t.id===pending.id);
      write(pendingKey,null);setPending(null);setEditConflict(false);setRows(result.transactions);
      setEditing(latest ? {...latest,_endpoint:endpoint} : null);setForm(latest ? editEntry(latest) : newEntry());setView('entry');setError('');
      setNotice(latest?'Latest payment loaded. Review and save your changes.':'This payment was deleted. Your attempted edit was not applied.');
    } catch(e) {setError(e.message);} finally {lock.current=false;setBusy(false);}
  }
  function chooseCategory(value) { setForm(previous => ({...previous,category:value,direction:value==='Sale'?'in':'out'})); }
  function changeRecordType(value) {
    setForm(previous=>value==='transfer'
      ? {...previous,recordType:'transfer',category:'Transfer',direction:'transfer',method:'Transfer'}
      : {...previous,recordType:'payment',category:categories.includes(previous.category)?previous.category:preferences.defaultCategory,direction:['in','out'].includes(previous.direction)?previous.direction:'in',method:methods.includes(previous.method)?previous.method:preferences.defaultMethod});
  }
  function openSettings() { setUrl(endpoint); setError(''); setSettingsFeedback(''); setModal('settings'); }
  useEffect(() => { if (view==='entry' && !modal) focusAmount(); }, [view, modal]);
  useEffect(() => {
    const handler = event => {
      if (modal || busy || pending) return;
      const action = shortcutAction(event);
      if (!action || (action !== 'new' && view !== 'entry')) return;
      event.preventDefault();
      if (action==='new') startNew();
      else if (action==='save') { if (endpoint) formRef.current?.requestSubmit(); }
      else if (action==='payment-mode' || action==='exchange-mode') { if (editing) return; const type=action==='exchange-mode'?'transfer':'payment';changeRecordType(type);focusAndCenter(document.querySelector(`[data-shortcut="${action}"]`)); }
      else if (action==='exchange-cash-online' || action==='exchange-online-cash') { if (form.recordType!=='transfer') return;const direction=action==='exchange-cash-online'?'receive-cash-send-online':'receive-online-give-cash';update('exchangeDirection',direction);focusAndCenter(document.querySelector(`[data-shortcut="${action}"]`)); }
      else if (['cash-received','cash-change','online-change'].includes(action)) { if (form.recordType==='transfer') return;focusAndCenter(document.querySelector(`[data-shortcut="${action}"]`)); }
      else if (form.recordType==='transfer' && !['amount','vendor','notes'].includes(action)) return;
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
    const handler = event => { if (hasDraft(form) && !pending) { event.preventDefault(); event.returnValue=''; } };
    window.addEventListener('beforeunload',handler);
    return () => window.removeEventListener('beforeunload',handler);
  }, [form,pending]);
  function selectPeriod(value) { setPeriod(value); if (value !== 'custom') setRange(periodRange(value)); }
  async function save(event, retry = false) {
    event?.preventDefault();
    if (lock.current) return;
    setError('');
    if (!endpoint) { setError('Connect Google Sheets in settings before recording a payment.'); return; }
    let transaction;
    try {
      transaction = retry ? pending : makeTransaction({...form,dateTime:form.customDate?form.dateTime:localNow()}, editing?.id);
      if (!transaction) return;
      if ((transaction.recordType==='transfer' || Number(transaction.onlineChangeMinor||0)>0 || Number(transaction.cashChangeMinor||0)>0) && !versionAtLeast(connectionInfo?.version,'1.4.0')) throw new Error('Update Code.gs to version 1.4.0 before saving a cash/online exchange or a sale with change. Open Settings → Google Sheets setup, copy the included Code.gs, replace the Apps Script, and deploy a new version.');
      if (!retry && pending) throw new Error('Retry the pending payment before adding another.');
      if (retry && transaction._endpoint && transaction._endpoint !== endpoint) throw new Error('This payment belongs to another connection. Reconnect its original sheet before retrying.');
      if (retry && !transaction._endpoint && !window.confirm('This older pending payment has no saved sheet link. Confirm that the connected sheet is its original destination before retrying.')) return;
      if (!retry && editing) {
        if (editing._endpoint !== endpoint) throw new Error('Reconnect the original sheet before saving this edit.');
        transaction = {...transaction,_action:'update',_editId:crypto.randomUUID(),_expectedRevision:Number(editing.revision || 0)};
      }
      transaction = { ...transaction, _endpoint: endpoint };
      write(pendingKey, transaction); setPending(transaction);
    } catch (e) { setError(e.message); return; }
    lock.current = true; setBusy(true);
    try {
      const result = await request(endpoint, transaction, transaction._action || 'create');
      if (transaction._action==='update' && (!result.updated || result.transaction?.id!==transaction.id)) throw new Error('Edit was not confirmed. Update Code.gs from Settings and retry.');
      if (result.id !== transaction.id) throw new Error('Save confirmation did not match. Retry the pending payment.');
      const next = [...rows.filter(t => t.id !== transaction.id), result.transaction || transaction];
      setRows(next); write(pendingKey, null); setPending(null); setEditing(null); setEditConflict(false); setForm(newEntry(transaction)); setNotice(`${transaction._action==='update'?'Changes to ':''}${money(transaction.amountMinor)} saved to Google Sheets${transaction.transactionDate!==localNow().slice(0,10)?' · '+transaction.transactionDate:''}. Ready for the next payment.`); focusAmount();
    } catch (e) { if (e.code==='EDIT_CONFLICT') setEditConflict(true); setError(`${e.message} Your attempted change is kept on this device. ${e.code==='EDIT_CONFLICT'?'Use Reload latest to resolve the conflict.':'Retry is safe.'}`); }
    finally { lock.current = false; setBusy(false); }
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
    if (lock.current || pending) return;
    if (editing) { setError('Finish or cancel your edit before disconnecting.'); return; }
    if (!window.confirm('Disconnect this browser? Your Google Sheet and transactions will remain unchanged.')) return;
    try {
      await clearEndpoint(); localStorage.removeItem('rf.connectionInfo');
      applyConnectionPreferences(''); setEndpoint(''); setUrl(''); setRows([]); setConnectionInfo(null); setSynced(false); setError(''); setNotice('This browser is disconnected.');
    } catch { setError('Could not remove the saved connection. Check browser storage permissions.'); }
  }
  async function deleteTransaction(transaction) {
    if (lock.current || pending) return;
    if (!window.confirm(`Delete ${money(transaction.amountMinor)} · ${transaction.party || transaction.category} on ${transaction.transactionDate}? This removes it from your ledger and reports.`)) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await request(endpoint, { id: transaction.id }, 'delete');
      if (result.id !== transaction.id || result.deleted !== true) throw new Error('Deletion was not confirmed. Update your Apps Script deployment and retry.');
      const next = rows.filter(t => t.id !== transaction.id);
      setRows(next); setNotice('Transaction deleted. Refresh the Report tab in Sheets to update its snapshot.');
    } catch (e) { setSynced(false); setError(`${e.message} Refresh to check whether deletion completed, or retry Delete safely.`); }
    finally { lock.current = false; setBusy(false); }
  }
  const update = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  if (!connectionRestored) return <main className="startup-loading" role="status">Restoring your saved Google Sheets connection…</main>;
  return <>
    <aside className="sidebar"><a className="brand" href="#"><img className="brand-logo" src={brandLogo} alt=""/><span>{preferences.shopName}<span className="brand-sub">SHOP LEDGER</span></span></a><p className="nav-label">YOUR WORKSPACE</p>{[['entry','＋','New transaction'],['history','⇄','History'],['dashboard','▦','Dashboard']].map(([key,icon,label])=><button key={key} className={`nav-item ${view===key?'active':''}`} onClick={()=>setView(key)} aria-current={view===key?'page':undefined}>{icon} <span>{label}</span></button>)}<button className="nav-item" onClick={openSettings}>⚙ <span>Settings</span></button><div className="sidebar-bottom"><div className="shop-icon">RF</div><strong>{preferences.shopName}</strong><small>Your everyday shop ledger</small><button className="settings-link" onClick={() => {setUrl(endpoint);setModal('settings');setError('');}}>⚙ Connection settings</button></div></aside>
    <main><header className="topbar"><button className="outline" onClick={()=>{setUrl(endpoint);setModal('settings');setError('');}}>⚙ Settings</button>{installPrompt && <button className="outline install-button" onClick={installApp}>＋ Install app</button>}<span className={`connection ${synced ? 'connected' : ''}`}><i/> {synced ? 'Sheets connected' : endpoint ? 'Connection not verified' : 'Sheets not connected'}</span></header>
      <section className="heading"><div><p className="eyebrow shop-tagline">Apne Gar ko do ROYAL touch sirf Royal Furnitures se</p><h1>{view==='entry'?(editing?'Edit payment.':'Record a payment.'):view==='history'?'Transaction history.':'Your shop, at a glance.'}</h1><p>{view==='entry'?'Quick entry. Clear records. Ready for the next customer.':'Keep track of every payment. Keep business moving.'}</p></div><button className="primary" onClick={view==='entry'?startNew:openEntry} disabled={busy || !!pending}>＋ {view==='entry'?'New entry':'Add transaction'} <kbd>Alt + N</kbd></button></section>
      {!endpoint && <div className="setup-banner"><div><strong>Let’s connect your ledger.</strong><span>Connect Google Sheets to start recording payments.</span></div><button onClick={() => {setUrl(endpoint);setModal('settings');setError('');}}>Connect Sheets ↗</button></div>}
      <div aria-live="polite">{notice && <p className="notice">{notice}</p>}{error && !modal && <p className="error" role="alert">{error}</p>}</div>
      {integrityIssueCount>0 && <p className="integrity-warning" role="alert">{integrityIssueCount} Sheet record{integrityIssueCount===1?' has':'s have'} invalid or inconsistent transaction data. Affected records are excluded from totals; review those rows in Transactions before using the report.</p>}
      {pending && <div className="pending"><span><strong>{pending._action==='update'?'Edit awaiting confirmation':'Payment awaiting confirmation'}</strong> · {money(pending.amountMinor)} · {pending.party || pending.category}</span><button disabled={busy} onClick={editConflict?reloadConflictedEdit:()=>save(null,true)}>{busy ? 'Please wait…' : editConflict?'Reload latest':'Retry save'}</button></div>}
      {view==='entry' && <PaymentEntry editing={editing} cancelEdit={startNew} form={form} update={update} chooseCategory={chooseCategory} setRecordType={changeRecordType} save={save} formRef={formRef} amountRef={amountRef} busy={busy} pending={pending} endpoint={endpoint} rows={rows} refresh={refresh} openHistory={()=>setView('history')} focusAndCenter={focusAndCenter}/>}
      <div className={`report-view ${view==='entry'?'screen-hidden':''}`}>
      <section className="period-bar"><div><span className="calendar-icon">▦</span><select aria-label="Report period" value={period} onChange={e => selectPeriod(e.target.value)}><option value="month">This month</option><option value="today">Today</option><option value="last">Last month</option><option value="custom">Custom period</option></select></div><div className="date-range"><input aria-label="Start date" type="date" value={range[0]} onChange={e => {setPeriod('custom');setRange([e.target.value,range[1]]);}}/><span>—</span><input aria-label="End date" type="date" value={range[1]} onChange={e => {setPeriod('custom');setRange([range[0],e.target.value]);}}/></div><button className="refresh" disabled={busy || !endpoint} onClick={() => refresh()}>↻ {busy ? 'Syncing…' : 'Refresh'}</button></section>
      {range[0] > range[1] && <p className="error">The start date must be on or before the end date.</p>}
      <div className={view==='dashboard'?'dashboard-overview':'dashboard-overview screen-hidden'}><div className="summary-grid"><article className="summary-card"><div><span>Total payment in</span><b className="icon-in">↙</b></div><h2>{money(summary.in)}</h2><p><span className="dot green"/> Money received</p></article><article className="summary-card"><div><span>Total payment out</span><b className="icon-out">↗</b></div><h2>{money(summary.out)}</h2><p><span className="dot orange"/> Money paid</p></article><article className="summary-card net"><div><span>Net cash flow</span><b>⇄</b></div><h2>{money(summary.in-summary.out)}</h2><p>Payment in minus payment out</p></article></div>
      <div className="payment-breakdown" aria-label="Cash and online payment totals"><div className="section-title"><h2>Cash & online</h2><span>For the selected period and type</span></div><section className="payment-method-grid">{[['Cash received','Cash','in'],['Online received','Online','in'],['Cash paid','Cash','out'],['Online paid','Online','out']].map(([label,paymentMethod,direction])=><article className={`method-total ${direction}`} key={label}><span>{label}</span><strong>{money(methodTotal(paymentMethod,direction))}</strong><small>Payment {direction} · {paymentMethod}</small></article>)}</section></div>
      <div className="section-title"><h2>By transaction type</h2><span>Period, payment and search filters</span></div><section className="category-grid">{categories.map((name,i) => { const records = categoryRows.filter(t => t.category === name); return <button key={name} aria-pressed={category===name} className={`category-card tone-${i} ${category===name?'selected':''}`} onClick={() => setCategory(category===name?'':name)}><span className="category-symbol">{symbols[name]}</span><span className="category-name">{name}<small>{name==='Bhara'?'Transport & delivery':`${records.length} transaction${records.length===1?'':'s'}`}</small></span><strong>{money(sumAmounts(records))}</strong><span className="card-arrow">↗</span></button>; })}</section>
      </div><section className="transactions" id="transactions"><div className="transaction-heading"><div><h2>Transactions</h2><p>Every payment, all in one place.</p></div><button className="outline" onClick={() => window.print()}>▤ Print A4 report</button></div><div className="filters"><input type="search" aria-label="Search transactions" placeholder="Search name or notes…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Filter category" value={category} onChange={e=>setCategory(e.target.value)}><option value="">All types</option>{categories.map(c=><option key={c}>{c}</option>)}<option value="Transfer">Cash/Online exchange</option></select><select aria-label="Filter payment method" value={method} onChange={e=>setMethod(e.target.value)}><option value="">All payment methods</option>{methods.map(m=><option key={m}>{m}</option>)}<option value="Transfer">Cash/Online exchange</option></select></div>
      <div className="print-heading"><div className="print-brand"><img src={brandLogo} alt=""/><div><h1>{preferences.shopName}</h1><p className="print-tagline">Apne Gar ko do ROYAL touch sirf Royal Furnitures se</p></div></div>{preferences.printContact && <div className="print-contact">{preferences.address && <p>{preferences.address}</p>}{preferences.phone && <p>Phone: {preferences.phone}</p>}</div>}<h2>Transaction report</h2><p>{range[0]} to {range[1]} · {category || 'All types'} · {method || 'All payment methods'}{query && ` · Search: ${query}`}</p><p>Payment in: {money(summary.in)} · Payment out: {money(summary.out)} · Net: {money(summary.in-summary.out)}</p><p>{synced ? 'Google Sheets records' : 'Cached records — refresh to confirm latest data'} · Timezone: {SHOP_TIMEZONE}</p></div>
      {visible.length ? <div className="table-wrap"><table><thead><tr><th>Transaction / Party</th><th>Date & time</th><th>Payment</th><th className="notes-heading">Notes</th><th className="amount">Amount</th></tr></thead><tbody>{visible.map(t=>{const transfer=t.recordType==='transfer';const title=transfer?'Cash/Online exchange':t.party||t.category;return <tr key={t.id}><td><span className={`row-symbol ${t.direction}`}>{symbols[t.category] || '⇄'}</span><div className="party"><strong>{title}</strong><small>{transfer?`${t.fromMethod} → ${t.toMethod}`:`${t.category}${t.category==='Bhara'?' · Delivery':''}`}</small></div></td><td>{t.transactionDate}<small>{t.transactionTime}</small></td><td><span className="badge">{transfer?`${t.fromMethod} → ${t.toMethod}`:t.method}</span>{!transfer && t.chequeDate && <small>Given: {t.chequeDate}</small>}{!transfer && Number(t.cashReceivedMinor)>Number(t.amountMinor) && <small>Cash received {money(t.cashReceivedMinor)} · Cash change {money(t.cashChangeMinor || 0)} · Online change {money(t.onlineChangeMinor || 0)}</small>}{transfer && <small>Balance exchange · no income/expense</small>}</td><td className="notes-cell">{t.notes || '—'}</td><td className={`amount ${t.direction==='in'?'in':t.direction==='out'?'out':''}`}>{t.direction==='in'?'+':t.direction==='out'?'−':''}{money(t.amountMinor)}<small>{transfer?'Balance exchange':`Payment ${t.direction}`}</small><button className="edit-transaction" disabled={busy || !!pending || !endpoint} aria-label={`Edit transaction for ${title}, ${money(t.amountMinor)}`} onClick={()=>beginEdit(t)}>Edit</button><button className="delete-transaction" disabled={busy || !!pending || !endpoint} aria-label={`Delete transaction for ${title}, ${money(t.amountMinor)}, ${t.transactionDate}`} onClick={()=>deleteTransaction(t)}>Delete</button></td></tr>;})}</tbody></table></div> : <div className="empty"><span>▤</span><h3>No transactions yet</h3><p>{rows.length ? 'Try a different period or clear your filters.' : 'Your first payment is the start of a clearer picture.'}</p><button onClick={openEntry}>＋ Record a payment</button></div>}
      <div className="table-footer"><span>{visible.length} transaction{visible.length===1?'':'s'}</span><span>Amounts in INR · {SHOP_TIMEZONE}</span></div></section></div><footer>{preferences.shopName}<a href="https://www.instagram.com/royalfurniture45/" target="_blank" rel="noreferrer">Instagram · @royalfurniture45</a><span>Apne Gar ko do ROYAL touch</span><button onClick={()=>{setUrl(endpoint);setModal('settings');setError('');}}>Settings</button></footer>
    </main>
    <nav className="mobile-nav" aria-label="Main navigation">{[['entry','＋','Entry'],['history','⇄','History'],['dashboard','▦','Dashboard']].map(([key,icon,label])=><button key={key} className={!modal && view===key?'active':''} aria-current={!modal && view===key?'page':undefined} onClick={()=>setView(key)}><span>{icon}</span>{label}</button>)}<button onClick={openSettings}><span>⚙</span>Settings</button></nav>
    <dialog className={modal==='settings' ? 'settings-dialog' : ''} ref={dialog} onCancel={e => {if(busy)e.preventDefault();else setModal('');}}><div className="dialog-heading"><div><p className="eyebrow">SHOP LEDGER</p><h2>Settings & sheet setup</h2></div><button className="close" aria-label="Close dialog" disabled={busy} onClick={()=>setModal('')}>×</button></div>{error && <p className="error" role="alert">{error}</p>}
      {modal && <Settings preferences={preferences} savePreferences={savePreferences} range={range} exportCsv={exportCsv} deleted={deleted} loadDeleted={loadDeleted} restore={restore} feedback={settingsFeedback} endpoint={endpoint} info={connectionInfo} synced={synced} url={url} setUrl={setUrl} connect={connect} disconnect={disconnect} busy={busy} pending={pending}/>}

    </dialog>
  </>;
}
createRoot(document.getElementById('root')).render(<App/>);
