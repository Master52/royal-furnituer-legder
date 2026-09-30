import React, { useEffect, useMemo, useRef, useState } from 'react';
import { localNow, money, periodRange } from './ledger.js';
import { blankInvoice, blankItem, makeInvoice, makeParty, partyStatement, invoiceSummary, invoiceDraftFromRecord } from './accounts.js';
import PartyStatement from './PartyStatement.jsx';
import { createPortal } from 'react-dom';
import AccountDialog from './AccountDialog.jsx';
import InvoiceDocument from './InvoiceDocument.jsx';
import PartyPicker from './PartyPicker.jsx';
import { hasInvoiceDraft, invoiceDraftKey, readInvoiceDraft } from './invoiceDraft.js';

const newParty = () => ({name:'',phone:'',address:'',openingDate:localNow().slice(0,10),openingBalance:'0',openingDirection:'receivable'});
export function InvoiceDashboard({ accounts, range, onOpenInvoice }) {
  const [showProfit,setShowProfit]=useState(false);
  if (!accounts.loaded) return null;
  const summary=invoiceSummary(accounts.invoices,...range);
  const receivable=accounts.partyBalances.reduce((sum,row)=>sum+Math.max(0,row.balance||0),0);
  const payable=accounts.partyBalances.reduce((sum,row)=>sum-Math.min(0,row.balance||0),0);
  const balanceError=accounts.partyBalances.some(row=>row.balance===null)?'A party has invalid linked payments.':'';
  return <section className="invoice-dashboard"><div className="section-title"><h2>Invoices & party balances</h2><button className="outline" disabled={accounts.busy} onClick={accounts.reload}>Refresh invoices</button></div>{accounts.error && <p className="error">Invoice figures may be stale: {accounts.error}</p>}<div className="account-metrics">{[['Invoiced sales',summary.sales],['Invoiced purchases',summary.purchases],['Gross profit · costed sales',summary.grossProfit]].map(([label,value])=><article key={label}><span>{label}</span><strong>{label.startsWith('Gross profit')&&!showProfit?'••••':money(value)}</strong>{label.startsWith('Gross profit')&&<button type="button" className="profit-eye" aria-label={showProfit?'Hide gross profit':'Show gross profit'} aria-pressed={showProfit} onClick={()=>setShowProfit(!showProfit)}>{showProfit?'◉ Hide':'◎ Show'}</button>}<small>Selected date period · issued invoices</small></article>)}<article><span>Party receivables</span><strong>{balanceError?'Unavailable':money(receivable)}</strong><small>All recorded dates · net balance per party</small></article><article><span>Party payables</span><strong>{balanceError?'Unavailable':money(payable)}</strong><small>All recorded dates · net balance per party</small></article></div><details className="invoice-dashboard-list"><summary>Invoices ({accounts.invoices.length+accounts.pendingInvoices.length})</summary><div>{[...accounts.invoices,...accounts.pendingInvoices].sort((a,b)=>b.invoiceDate.localeCompare(a.invoiceDate)).map(inv=><button type="button" key={inv.id} onClick={()=>onOpenInvoice(inv.id)}><span><strong>{inv.invoiceNumber}</strong><small>{inv.partyName} · {inv.invoiceDate} · {inv.type==='sale'?'Sale':'Purchase'} · {inv.status}</small></span><strong>{money(inv.totalMinor)}</strong></button>)}{!accounts.invoices.length&&!accounts.pendingInvoices.length&&<p>No invoices yet.</p>}</div></details><p className="help">Confirmed Sheet snapshot: {accounts.checkedAt?new Date(accounts.checkedAt).toLocaleString():'Not refreshed'}. {summary.missingCosts?`${summary.missingCosts} sales invoice(s) have missing costs and are excluded from gross profit. `:''}Gross profit excludes operating expenses. Invoice totals and payment totals are separate; do not add them together. {balanceError}</p></section>;
}
export default function AccountsPanel({ accounts, endpoint, enabled, preferences, onPayment, paymentPending, invoiceCreateRequest = 0, invoiceResumeRequest = 0, onDraftChange, invoiceOpenRequest = null, onNavigateParties, onNavigateDashboard }) {
  const [selected,setSelected]=useState('');
  const [balanceTab,setBalanceTab]=useState('receive');
  const [partySearch,setPartySearch]=useState('');
  const [partyForm,setPartyForm]=useState(newParty);
  const [editParty,setEditParty]=useState(null);
  const [correctPartyId,setCorrectPartyId]=useState('');
  const [showParty,setShowParty]=useState(false);
  const [initialDraft]=useState(()=>readInvoiceDraft(localStorage,endpoint));
  const [invoice,setInvoice]=useState(initialDraft.draft);
  const [showInvoiceForm,setShowInvoiceForm]=useState(false);
  const [partyQuery,setPartyQuery]=useState(initialDraft.draft.partyQuery||'');
  const issuing=useRef(false);
  const savingParty=useRef(false);
  const [partySaving,setPartySaving]=useState(false);
  const [returnToInvoice,setReturnToInvoice]=useState(false);
  const [showDraftProfit,setShowDraftProfit]=useState(false);
  const [range,setRange]=useState(()=>periodRange('month'));
  const [detailed,setDetailed]=useState(false);
  const [showPrint,setShowPrint]=useState(false);
  const [preparingPrint,setPreparingPrint]=useState(false);
  const [invoiceDetailId,setInvoiceDetailId]=useState('');
  const [invoicePrintSnapshot,setInvoicePrintSnapshot]=useState(null);
  const activeParty=useRef('');
  activeParty.current=selected;
  useEffect(()=>{setShowPrint(false);setPrinting(false);setPrintSnapshot(null);setInvoiceDetailId('');setInvoicePrintSnapshot(null);delete document.body.dataset.accountPrint;},[selected]);
  const [error,setError]=useState(initialDraft.error);
  const [notice,setNotice]=useState('');
  // This panel remounts when the Sheet endpoint changes. Old navigation requests
  // must not open an invoice or replace the newly connected Sheet's saved draft.
  const createRequestSeen=useRef(invoiceCreateRequest),resumeRequestSeen=useRef(invoiceResumeRequest),openRequestSeen=useRef(invoiceOpenRequest);
  useEffect(()=>{if(invoiceCreateRequest!==createRequestSeen.current){createRequestSeen.current=invoiceCreateRequest;issuing.current=false;setInvoice(blankInvoice());setPartyQuery('');setInvoiceDetailId('');setShowParty(false);setReturnToInvoice(false);setCorrectPartyId('');setShowInvoiceForm(true);setShowDraftProfit(false);setError('');setNotice('');}},[invoiceCreateRequest]);
  useEffect(()=>{if(invoiceOpenRequest!==openRequestSeen.current){openRequestSeen.current=invoiceOpenRequest;if(invoiceOpenRequest?.id){setShowInvoiceForm(false);setInvoiceDetailId(invoiceOpenRequest.id);setError('');}}},[invoiceOpenRequest]);
  useEffect(()=>{if(invoiceResumeRequest!==resumeRequestSeen.current){resumeRequestSeen.current=invoiceResumeRequest;if(!hasInvoiceDraft({...invoice,partyQuery}))return;issuing.current=false;setInvoiceDetailId('');setShowParty(false);setReturnToInvoice(false);setShowInvoiceForm(true);setShowDraftProfit(false);setError('');setNotice('');}},[invoiceResumeRequest]);
  useEffect(()=>{onDraftChange?.(hasInvoiceDraft({...invoice,partyQuery}));},[invoice,partyQuery,onDraftChange]);
  useEffect(()=>{if(!showInvoiceForm)return;const timer=setTimeout(()=>document.querySelector('.account-invoice-dialog input[name=invoice-party]')?.focus(),0);return()=>clearTimeout(timer);},[showInvoiceForm]);
  useEffect(()=>{if(invoice.partyId){const match=accounts.selectableParties.find(item=>item.id===invoice.partyId);if(match)setPartyQuery(match.name);}},[invoice.partyId,accounts.selectableParties]);
  const [printing,setPrinting]=useState(false);
  const [printSnapshot,setPrintSnapshot]=useState(null);
  const party=accounts.parties.find(p=>p.id===selected);
  const invoiceDetail=accounts.invoices.find(inv=>inv.id===invoiceDetailId)||accounts.pendingInvoices.find(inv=>inv.id===invoiceDetailId);
  const partyInvoices=[...accounts.invoices,...accounts.pendingInvoices].filter(inv=>inv.partyId===selected).sort((a,b)=>b.invoiceDate.localeCompare(a.invoiceDate)||String(b.createdAt).localeCompare(String(a.createdAt)));
  const blocked=accounts.busy || Boolean(accounts.pending) || !enabled || !accounts.loaded;
  useEffect(()=>{try{localStorage.setItem(invoiceDraftKey(endpoint),JSON.stringify({...invoice,partyQuery}));}catch{setError('Invoice draft could not be saved on this browser. Keep this page open until it is issued.');}},[endpoint,invoice,partyQuery]);
  useEffect(()=>{
    const handler=e=>{if(invoice.items.some(i=>i.description || i.rate) || showParty || accounts.pending){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);
  },[invoice,showParty,accounts.pending]);
  useEffect(()=>{const done=()=>{delete document.body.dataset.accountPrint;setPrinting(false);};window.addEventListener('afterprint',done);return()=>{window.removeEventListener('afterprint',done);delete document.body.dataset.accountPrint;};},[]);
  useEffect(()=>{if(!printing)return;document.body.dataset.accountPrint=printing;const timer=setTimeout(()=>window.print(),0);return()=>clearTimeout(timer);},[printing]);
  const update=(key,value)=>setInvoice(old=>({...old,[key]:value}));
  function addInvoiceItem(){setInvoice(old=>({...old,items:[...old.items,blankItem()]}));setTimeout(()=>document.querySelector('.account-invoice-dialog .invoice-item-editor:last-of-type input')?.focus(),0);}
  useEffect(()=>{
    if(!showInvoiceForm)return;
    const handler=event=>{
      if(!document.querySelector('dialog.account-invoice-dialog[open]') || document.querySelector('dialog.account-invoice-dialog fieldset:disabled') || event.repeat || event.isComposing || event.getModifierState?.('AltGraph'))return;
      const key=event.key.toLowerCase();
      if((event.ctrlKey||event.metaKey) && !event.altKey && !event.shiftKey && key==='enter'){event.preventDefault();document.querySelector('.account-invoice-dialog form')?.requestSubmit();return;}
      if(!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)return;
      if(key==='a' && invoice.items.length<50 && accounts.canQueue){event.preventDefault();addInvoiceItem();}
      else if(key==='1' || key==='2'){event.preventDefault();update('type',key==='1'?'sale':'purchase');}
      else if(key==='q'){event.preventDefault();document.querySelector('.account-invoice-dialog input[name=invoice-party]')?.focus();}
    };
    window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  },[showInvoiceForm,invoice.items.length,accounts.canQueue]);
  function updateItem(index,key,value){setInvoice(old=>({...old,items:old.items.map((item,i)=>i===index?{...item,[key]:value}:item)}));}
  function selectInvoiceParty(account){setInvoice(old=>({...old,partyId:account.id}));setPartyQuery(account.name);}
  function createPartyFromInvoice(){setCorrectPartyId('');setReturnToInvoice(true);setShowInvoiceForm(false);setShowParty(true);setEditParty(null);setSelected('');setPartyForm({...newParty(),name:partyQuery.trim(),openingDate:invoice.invoiceDate});onNavigateParties();}
  function cancelPartyForm(){setShowParty(false);setCorrectPartyId('');setError('');if(returnToInvoice){setReturnToInvoice(false);setShowInvoiceForm(true);onNavigateDashboard();}}
  function createPartyInvoice(){
    if(!party || blocked)return;
    issuing.current=false;setInvoice({...blankInvoice(),partyId:party.id});setPartyQuery(party.name);
    setShowInvoiceForm(true);setError('');setNotice('');
  }
  function payFromInvoice(){
    if(!invoiceDetail || invoiceDetail.status!=='issued' || blocked)return;
    const account=accounts.parties.find(item=>item.id===invoiceDetail.partyId);
    if(!account){setError('Refresh parties before recording this payment.');return;}
    if(onPayment(account,invoiceDetail.type==='sale'?'in':'out'))setInvoiceDetailId('');
  }
  async function printInvoice(){
    if(preparingPrint || blocked || !invoiceDetail)return;
    const id=invoiceDetail.id;
    setPreparingPrint(true);setError('');
    try{
      const result=await accounts.reload({fresh:true});
      if(!result)return;
      const freshInvoice=result.invoices.find(inv=>inv.id===id);
      if(!freshInvoice)throw new Error('Invoice no longer exists. Refresh the invoice list.');
      setInvoicePrintSnapshot(freshInvoice);setPrinting('invoice');
    }catch(e){setError(e.message);}
    finally{setPreparingPrint(false);}
  }
  async function saveParty(e){
    e.preventDefault();if(savingParty.current)return;savingParty.current=true;setPartySaving(true);setError('');setNotice('');
    try{
      const payload=editParty?{id:editParty.id,name:partyForm.name.trim(),phone:partyForm.phone.trim(),address:partyForm.address.trim(),_editId:crypto.randomUUID(),_expectedRevision:Number(editParty.revision||0)}:makeParty(partyForm,correctPartyId||undefined);
      if(correctPartyId){if(await accounts.correctRejectedParty(payload)){setCorrectPartyId('');setShowParty(false);setPartyForm(newParty());}return;}
      if(returnToInvoice&&!editParty){
        if(await accounts.queueParty(payload)){setInvoice(old=>({...old,partyId:payload.id}));setPartyQuery(payload.name);setReturnToInvoice(false);setShowParty(false);setPartyForm(newParty());setShowInvoiceForm(true);onNavigateDashboard();}
        return;
      }
      if(await accounts.save(editParty?'updateParty':'createParty',payload)){setSelected(payload.id);setShowParty(false);setPartyForm(newParty());setEditParty(null);setNotice('Party saved.');}
    }catch(e){setError(e.message);}finally{savingParty.current=false;setPartySaving(false);}
  }
  async function issue(e){
    e.preventDefault();if(issuing.current)return;issuing.current=true;setError('');setNotice('');
    try{
      const payload=makeInvoice(invoice);
      const account=accounts.selectableParties.find(item=>item.id===payload.partyId);
      if(!account)throw new Error('Select an existing party or create a new party.');
      if(payload.invoiceDate<account.openingDate)throw new Error('Invoice date cannot predate the party opening balance date.');
      Object.assign(payload,{partyName:account.name,partyPhone:account.phone,partyAddress:account.address});
      if(!window.confirm(`Issue ${invoice.type} invoice for ${money(payload.totalMinor)}? Its RF number will be assigned by Google Sheets. It will affect the party balance. Issued invoices cannot be edited; cancel and replace if needed.`)){issuing.current=false;return;}
      if(await accounts.queueInvoice(payload)){setInvoice(blankInvoice());setPartyQuery('');setShowInvoiceForm(false);setInvoiceDetailId(payload.id);setNotice('Invoice saved on this device. Uploading to Google Sheets in the background.');}else issuing.current=false;
    }catch(e){issuing.current=false;setError(e.message);}
  }
  async function retry(){if(await accounts.retry())setNotice('Saved request confirmed by Google Sheets.');}
  async function discardRejectedRequest(){
    const operation=accounts.pending;
    if(operation?.action==='createInvoice'&&invoice.items.some(item=>item.description||item.rate)&&!window.confirm('Restoring the rejected invoice will replace your current unsaved draft. Continue?'))return;
    if(!window.confirm(operation?.action==='createInvoice'?'Discard the rejected upload and restore its invoice draft for correction?':'Discard the request rejected by the server? Review the draft before trying again.'))return;
    let restored=null;
    if(operation?.action==='createInvoice'){
      const saved=operation.payload;
      restored=invoiceDraftFromRecord(saved);
      try{localStorage.setItem(invoiceDraftKey(endpoint),JSON.stringify(restored));setInvoice(restored);}
      catch{setError('Could not restore the invoice draft. The saved upload request is still kept on this device.');return;}
    }
    if(await accounts.discardRejected()){
      if(restored){issuing.current=false;setInvoiceDetailId('');setShowInvoiceForm(true);setShowDraftProfit(false);onNavigateDashboard();}
    }
  }
  async function cancel(inv){
    const reason=window.prompt(`Cancel invoice ${inv.invoiceNumber}? Payments stay unchanged. Enter the reason:`);
    if(!reason?.trim())return;
    if(await accounts.save('cancelInvoice',{id:inv.id,reason:reason.trim()}))setNotice('Invoice cancelled; party balance updated. Payments are unchanged.');
  }
  const partyBalances=accounts.partyBalances;
  const currentBalance=partyBalances.find(row=>row.party.id===selected)?.balance??null;
  const {statement,statementError}=useMemo(()=>{
    if(!party)return {statement:null,statementError:''};
    try{if(!range[0]||!range[1]||range[0]>range[1])throw new Error('Choose a valid statement date range.');return {statement:partyStatement(party,accounts.invoices,accounts.transactions,...range),statementError:''};}
    catch(error){return {statement:null,statementError:error.message};}
  },[party,accounts.invoices,accounts.transactions,range]);
  const searchTerm=partySearch.trim().normalize('NFKC').toLocaleLowerCase();
  const visibleParties=partyBalances
    .filter(row=>searchTerm?[row.party.name,row.party.phone].some(value=>String(value||'').normalize('NFKC').toLocaleLowerCase().includes(searchTerm)):row.balance!==null && (balanceTab==='receive'?row.balance>0:row.balance<0))
    .sort((a,b)=>Math.abs(b.balance||0)-Math.abs(a.balance||0)||a.party.name.localeCompare(b.party.name));
  const unavailableBalances=partyBalances.filter(row=>row.balance===null);
  const receiveTotal=partyBalances.reduce((sum,row)=>sum+(row.balance>0?row.balance:0),0);
  const payTotal=partyBalances.reduce((sum,row)=>sum+(row.balance<0?-row.balance:0),0);
  const totalLabel=amount=>!accounts.loaded?'—':unavailableBalances.length?'Unavailable':money(amount);
  const preview=useMemo(()=>{try{return makeInvoice({...invoice,partyId:invoice.partyId||'preview-party',invoiceDate:invoice.invoiceDate||localNow().slice(0,10)},'preview-invoice-0000000000');}catch{return null;}},[invoice]);
  async function printStatement(){
    if(preparingPrint || blocked)return;
    if(paymentPending){setError('Wait for pending payments to sync before printing a confirmed statement.');return;}
    if(statementError){setError(statementError);return;}
    const partyId=selected,printRange=[...range],printDetailed=detailed;
    setPreparingPrint(true);setError('');
    try{
      const result=await accounts.reload({fresh:true});
      if(!result || activeParty.current!==partyId)return;
      const freshParty=result.parties.find(p=>p.id===partyId);
      if(!freshParty)throw new Error('Party no longer exists.');
      const freshStatement=partyStatement(freshParty,result.invoices,result.transactions,...printRange);
      setPrintSnapshot({party:freshParty,statement:freshStatement,range:printRange,detailed:printDetailed,checkedAt:new Date().toISOString()});setPrinting('statement');
    }catch(e){setError(e.message);}
    finally{setPreparingPrint(false);}
  }
  if(!endpoint)return <section className="accounts-panel"><p>Connect the test Google Sheet in Settings to start.</p></section>;
  if(!enabled)return <section className="accounts-panel"><h2>Update the test Sheet backend</h2><p>Parties and invoices need Code.gs 1.8.0. Download it in Settings → Google Sheets setup, paste it into the copied TEST Sheet’s Apps Script, run setup, and deploy a new version. Then test the connection again.</p><p>Existing payments continue to work with the old backend.</p></section>;
  return <section className="accounts-panel">
    <div className="accounts-controls parties-page-heading"><h1>{party?'Party details':'Parties'}</h1>{accounts.error&&<button className="outline" disabled={accounts.busy} onClick={accounts.reload}>{accounts.error?'Retry refresh':'Refresh from Sheets'}</button>}{!party&&<button className="primary" disabled={blocked} onClick={()=>{setError('');setEditParty(null);setPartyForm(newParty());setShowParty(true);}}>＋ Add Party</button>}</div>

    {(error||accounts.error)&&<p className="error" role="alert">{error||accounts.error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
    {!accounts.loaded && !accounts.error && <p role="status">Loading parties and invoices…</p>}
    {accounts.loaded&&(accounts.refreshing||accounts.cached||accounts.error)&&<p className="help" role="status">{accounts.refreshing?'Updating balances…':accounts.cached||accounts.error?'Showing saved balances.':''} {accounts.checkedAt&&`Last updated: ${new Date(accounts.checkedAt).toLocaleString()}`}</p>}
    {accounts.pending&&<div className="account-pending"><strong>{accounts.busy?'Saving to Google Sheets…':'A saved request needs confirmation.'}</strong><p>The original request is kept on this device. Uploads run in order. Resolve any failed request before switching Sheets.</p><button className="outline" disabled={accounts.busy||accounts.pending.invalid} onClick={retry}>Retry saved request</button>{accounts.rejected&&<button className="outline" disabled={accounts.busy} onClick={discardRejectedRequest}>Discard rejected request</button>}{accounts.rejected&&accounts.pending.action==='createParty'&&<button className="outline" disabled={accounts.busy} onClick={()=>{const saved=accounts.pending.payload;setCorrectPartyId(saved.id);setEditParty(null);setSelected('');setShowParty(true);setPartyForm({...newParty(),...saved,openingBalance:(Math.abs(saved.openingBalanceMinor)/100).toFixed(2),openingDirection:saved.openingBalanceMinor<0?'payable':'receivable'});}}>Correct rejected party</button>}</div>}
    {showParty&&<AccountDialog className="account-party-dialog" initialFocus="input[name=party-name]" title={editParty?'Edit party contact details':correctPartyId?'Correct rejected party':'New party'} busy={partySaving} onClose={cancelPartyForm}>{(error||accounts.error)&&<p className="error" role="alert">{error||accounts.error}</p>}<form className="account-form party-form" onSubmit={saveParty}><fieldset disabled={partySaving||(correctPartyId?accounts.busy:returnToInvoice?!accounts.canQueue:blocked)}><div className="account-fields"><label>Name<input name="party-name" required maxLength="150" value={partyForm.name} onChange={e=>setPartyForm({...partyForm,name:e.target.value})}/></label><label>Phone<input maxLength="50" value={partyForm.phone} onChange={e=>setPartyForm({...partyForm,phone:e.target.value})}/></label><label>Address<textarea maxLength="500" value={partyForm.address} onChange={e=>setPartyForm({...partyForm,address:e.target.value})}/></label></div>{!editParty&&<><div className="account-fields"><label>Opening balance date<input type="date" required value={partyForm.openingDate} onChange={e=>setPartyForm({...partyForm,openingDate:e.target.value})}/></label><label>Opening amount (₹)<input type="number" min="0" step="0.01" required value={partyForm.openingBalance} onChange={e=>setPartyForm({...partyForm,openingBalance:e.target.value})}/></label><label>Who owes?<select value={partyForm.openingDirection} onChange={e=>setPartyForm({...partyForm,openingDirection:e.target.value})}><option value="receivable">Party owes us</option><option value="payable">We owe party</option></select></label></div><p className="help">Enter the balance immediately before this date’s entries. Opening balances cannot be edited in this first version. Choose a date before any invoices or payments you intend to add. Existing name-only payments are not linked automatically.</p></>}<button className="primary">Save party</button> <button type="button" className="outline" onClick={cancelPartyForm}>{returnToInvoice?'Back to invoice':'Cancel'}</button></fieldset></form></AccountDialog>}
    {!party&&<section className="party-directory">
      <div className="party-directory-search"><label htmlFor="party-directory-query">Search all parties</label><div><input id="party-directory-query" type="search" value={partySearch} placeholder="Name or phone, including settled parties" onChange={event=>setPartySearch(event.target.value)}/>{partySearch&&<button type="button" className="outline" onClick={()=>setPartySearch('')}>Clear search</button>}</div>{searchTerm&&<p className="help">Search includes parties who owe, parties we owe, and settled accounts.</p>}</div>
      <div className="party-balance-tabs" role="group" aria-label="Party balance filter">
        <button type="button" aria-pressed={!searchTerm&&balanceTab==='receive'} onClick={()=>{setBalanceTab('receive');setPartySearch('');}}><span>To Receive</span><strong>{totalLabel(receiveTotal)}</strong></button>
        <button type="button" aria-pressed={!searchTerm&&balanceTab==='pay'} onClick={()=>{setBalanceTab('pay');setPartySearch('');}}><span>To Pay</span><strong>{totalLabel(payTotal)}</strong></button>
      </div>
      {unavailableBalances.length>0&&<p className="error">Balances unavailable for {unavailableBalances.map(row=>row.party.name).join(', ')}. Correct their linked payments before using these totals.</p>}
      <div className="party-list-columns" aria-hidden="true"><span>Party name</span><span>Contact number</span><span>Amount</span></div>
      <ul className="party-balance-list">{visibleParties.map(({party:account,balance})=><li key={account.id}><button type="button" className="party-balance-row" onClick={()=>setSelected(account.id)}><strong>{account.name}</strong><span className="party-phone">{account.phone||'No contact number'}</span><span className={`party-amount ${balance<0?'pay':'receive'}`}>{balance===null?'Unavailable':money(Math.abs(balance))}{searchTerm&&<small>{balance===null?'Check payments':balance>0?'To Receive':balance<0?'To Pay':'Settled'}</small>}<span aria-hidden="true"> ›</span></span></button></li>)}</ul>
      {accounts.loaded&&!visibleParties.length&&<div className="party-list-empty">{searchTerm?'No parties match this search.':accounts.parties.length?balanceTab==='receive'?'No amounts to receive.':'No amounts to pay.':'No parties yet. Add a party to get started.'}</div>}
    </section>}
    {party&&<button type="button" className="outline party-back" onClick={()=>{setSelected('');setShowParty(false);}}>← Back to parties</button>}
    {party&&<>
      <div className="party-overview">
        <div className="party-detail-heading"><div><h2>{party.name}</h2><dl className="party-contact-details"><div><dt>Contact number</dt><dd>{party.phone||'—'}</dd></div><div><dt>Address</dt><dd>{party.address||'—'}</dd></div></dl></div><div className="party-total"><span>Total balance</span><strong>{currentBalance===null?'Unavailable':money(Math.abs(currentBalance))}</strong><small>{currentBalance===null?'':currentBalance>0?'To Receive':currentBalance<0?'To Pay':'Settled'}</small></div></div>
        <div className="accounts-controls"><button className="outline" disabled={blocked} onClick={()=>{setError('');setEditParty(party);setPartyForm({...newParty(),...party});setShowParty(true);}}>Edit contact details</button><button className="primary" disabled={blocked||paymentPending} onClick={()=>onPayment(party,'in')}>Receive payment</button><button className="outline" disabled={blocked||paymentPending} onClick={()=>onPayment(party,'out')}>Make payment</button><button type="button" className="outline" disabled={blocked} onClick={createPartyInvoice}>Create Invoice</button><button type="button" className="outline" aria-haspopup="dialog" onClick={()=>{setError('');setShowPrint(true);}} disabled={printing||preparingPrint}>Print Statement</button></div>
      </div>
      <section className="invoice-register party-invoices"><h3>Invoices</h3>{partyInvoices.map(inv=><article key={inv.id}><button type="button" className="invoice-open-row" aria-haspopup="dialog" onClick={()=>{setError('');setInvoiceDetailId(inv.id);}}><div><strong>{inv.invoiceNumber}</strong><small>{inv.invoiceDate} · {inv.type==='sale'?'Sales invoice':'Purchase invoice'}</small>{inv.cancelReason&&<small>Cancellation: {inv.cancelReason}</small>}</div><div className="party-invoice-amount"><strong>{money(inv.totalMinor)}</strong><small>{inv.status==='cancelled'?'Cancelled':inv._pending?'Pending upload':'Issued'}</small></div></button></article>)}{!partyInvoices.length&&<p>No invoices for this party yet.</p>}</section>
    </>}
    {showInvoiceForm&&<AccountDialog className="account-invoice-dialog" title="Create Invoice" busy={false} onClose={()=>setShowInvoiceForm(false)}>
      {(error||accounts.error)&&<p className="error" role="alert">{error||accounts.error}</p>}
      {accounts.pending&&<p className="account-pending">Requests upload in the background. New invoices will wait for their party to finish saving.</p>}
      <form className="account-form invoice-form" onSubmit={issue}><fieldset disabled={!accounts.canQueue}><div className="invoice-edit-content"><p className="help">Draft saved on this browser. Issuing an invoice changes the party balance; payment is recorded separately.</p><div className="account-fields"><label>Type <kbd>Alt + 1 / 2</kbd><select value={invoice.type} onChange={e=>update('type',e.target.value)}><option value="sale">Sales invoice</option><option value="purchase">Purchase invoice</option></select></label><PartyPicker parties={accounts.selectableParties} value={partyQuery} selectedId={invoice.partyId} onChange={value=>{setPartyQuery(value);update('partyId','');}} onSelect={selectInvoiceParty} onCreate={createPartyFromInvoice}/><div className="invoice-number-hint"><span>Invoice number</span><strong>{invoice.type==='sale'?'RF-S-…':'RF-P-…'}</strong><small>Assigned automatically when issued</small></div><label>Invoice date<input type="date" required min={accounts.selectableParties.find(p=>p.id===invoice.partyId)?.openingDate} value={invoice.invoiceDate} onChange={e=>update('invoiceDate',e.target.value)}/></label></div>
    <div className="invoice-pos-layout"><div className="invoice-pos-items"><h3>Items</h3>{invoice.items.map((item,index)=><div className="invoice-item-editor" key={index}><label>Item {index+1}<input aria-label={`Item ${index+1} description`} required maxLength="300" value={item.description} onChange={e=>updateItem(index,'description',e.target.value)}/></label><label>Quantity<input type="number" min="0.001" max="1000000" step="0.001" required value={item.quantity} onChange={e=>updateItem(index,'quantity',e.target.value)}/></label><label>Rate (₹)<input type="number" min="0" step="0.01" required value={item.rate} onChange={e=>updateItem(index,'rate',e.target.value)}/></label><label>Line discount (₹)<input type="number" min="0" step="0.01" value={item.discount} onChange={e=>updateItem(index,'discount',e.target.value)}/></label>{invoice.type==='sale'&&<label>Internal unit cost (₹)<input type="number" min="0" step="0.01" value={item.cost} onChange={e=>updateItem(index,'cost',e.target.value)} placeholder="Optional"/></label>}<button type="button" className="outline" disabled={invoice.items.length===1} onClick={()=>update('items',invoice.items.filter((_,i)=>i!==index))}>Remove</button></div>)}
    <button type="button" className="outline" disabled={invoice.items.length>=50} onClick={addInvoiceItem}>＋ Add item <kbd>Alt + A</kbd></button><label>Invoice notes<textarea maxLength="1000" value={invoice.notes} onChange={e=>update('notes',e.target.value)}/></label>
    </div><aside className="invoice-pos-summary"><span>Invoice total</span><strong>{preview?money(preview.totalMinor):'—'}</strong><small>{invoice.items.length} item{invoice.items.length===1?'':'s'}</small>{invoice.type==='sale'&&<p className="draft-profit"><span>Gross profit</span><button type="button" aria-label={showDraftProfit?'Hide gross profit':'Show gross profit'} aria-pressed={showDraftProfit} onClick={()=>setShowDraftProfit(!showDraftProfit)}>{showDraftProfit?'◉ Hide':'◎ Show'}</button><strong>{showDraftProfit?(preview?.costTotalMinor===null?'Unavailable — enter all unit costs':preview?money(preview.totalMinor-preview.costTotalMinor):'—'):'••••'}</strong></p>}<p className="help">Review the invoice before issuing. Payments are recorded separately.</p></aside></div>
    <p className="help">Internal cost and profit are never printed on party statements. Blank costs are unknown, not zero.</p><button type="button" className="outline" onClick={()=>{if(window.confirm('Clear this invoice draft?')){setInvoice(blankInvoice());setPartyQuery('');setShowDraftProfit(false);}}}>Clear draft</button></div><div className="invoice-submit-bar"><div className="invoice-submit-total"><span>Invoice total</span><strong>{preview?money(preview.totalMinor):'—'}</strong></div><button className="primary">Issue invoice <kbd>Ctrl + Enter</kbd></button></div></fieldset></form>
    </AccountDialog>}
    {party&&showPrint&&<AccountDialog title="Print Statement" busy={preparingPrint||Boolean(printing)} onClose={()=>setShowPrint(false)}>
      <section className="party-statement-workspace">
      {(error||accounts.error)&&<p className="error" role="alert">{error||accounts.error}</p>}
      <div className="statement-controls">
        <fieldset className="statement-options" disabled={preparingPrint||printing}>
          <div className="account-fields"><label>From<input type="date" required value={range[0]} onChange={e=>setRange([e.target.value,range[1]])}/></label><label>To<input type="date" required min={range[0]} value={range[1]} onChange={e=>setRange([range[0],e.target.value])}/></label></div>
          <div className="statement-format-options" role="group" aria-label="Statement format"><button type="button" aria-pressed={!detailed} onClick={()=>setDetailed(false)}><strong>Ledger Statement</strong><span>Invoice totals and payments</span></button><button type="button" aria-pressed={detailed} onClick={()=>setDetailed(true)}><strong>Detailed Ledger Statement</strong><span>Includes each invoice’s items</span></button></div>
          <button className="primary" disabled={blocked||!!statementError||paymentPending} onClick={printStatement}>{preparingPrint?'Preparing statement…':detailed?'Print Detailed Ledger Statement':'Print Ledger Statement'}</button>
        </fieldset>
        {paymentPending&&<p className="help">Wait for pending payments to finish uploading before printing.</p>}
      </div>
      {statementError?<p className="error">{statementError}</p>:<PartyStatement party={party} statement={statement} range={range} detailed={detailed} preferences={preferences} checkedAt={accounts.checkedAt}/>}
      </section>
    </AccountDialog>}
    {invoiceDetail&&<AccountDialog title={`Invoice ${invoiceDetail.invoiceNumber}`} busy={preparingPrint||Boolean(printing)} onClose={()=>setInvoiceDetailId('')}>
      {(error||accounts.error)&&<p className="error" role="alert">{error||accounts.error}</p>}
      {invoiceDetail._pending&&<p className="notice" role="status">Saved on this device. Uploading in the background; the RF number will appear after confirmation. Printing is available once uploaded.</p>}
      <div className="invoice-popup-actions">{invoiceDetail.status==='issued'&&<button type="button" className="primary" disabled={blocked||paymentPending||preparingPrint||Boolean(printing)} onClick={payFromInvoice}>{invoiceDetail.type==='sale'?'Receive Payment':'Make Payment'}</button>}{invoiceDetail.status==='issued'&&<button type="button" className="outline" disabled={blocked||preparingPrint||Boolean(printing)} onClick={()=>cancel(invoiceDetail)}>Cancel Invoice</button>}<button type="button" className="primary" disabled={invoiceDetail._pending||blocked||preparingPrint||Boolean(printing)} onClick={printInvoice}>{preparingPrint?'Preparing invoice…':'Print Invoice'}</button></div>
      <InvoiceDocument invoice={invoiceDetail} preferences={preferences}/>
    </AccountDialog>}
    {printing&&createPortal(<div className="account-print-output">{printing==='statement'&&printSnapshot?<PartyStatement {...printSnapshot} preferences={preferences}/>:printing==='invoice'&&invoicePrintSnapshot?<InvoiceDocument invoice={invoicePrintSnapshot} preferences={preferences}/>:null}</div>,document.body)}
  </section>;
}
