import React, { useEffect, useMemo, useRef, useState } from 'react';
import { localNow, money, periodRange } from './ledger.js';
import { blankInvoice, blankItem, makeInvoice, makeParty, partyStatement, invoiceSummary } from './accounts.js';
import PartyStatement from './PartyStatement.jsx';
import { createPortal } from 'react-dom';
import AccountDialog from './AccountDialog.jsx';
import InvoiceDocument from './InvoiceDocument.jsx';

const newParty = () => ({name:'',phone:'',address:'',openingDate:localNow().slice(0,10),openingBalance:'0',openingDirection:'receivable'});
function readDraft(endpoint) {try{return JSON.parse(localStorage.getItem(`rf.invoiceDraft.${endpoint}`)) || blankInvoice();}catch{return blankInvoice();}}
export function InvoiceDashboard({ accounts, range }) {
  if (!accounts.loaded) return null;
  const summary=invoiceSummary(accounts.invoices,...range);
  let receivable=0,payable=0,balanceError='';
  try { for(const party of accounts.parties){const balance=partyStatement(party,accounts.invoices,accounts.transactions).closing;if(balance>0)receivable+=balance;else payable-=balance;} }
  catch(e){balanceError=e.message;}
  return <section className="invoice-dashboard"><div className="section-title"><h2>Invoices & party balances</h2><button className="outline" disabled={accounts.busy} onClick={accounts.reload}>Refresh invoices</button></div>{accounts.error && <p className="error">Invoice figures may be stale: {accounts.error}</p>}<div className="account-metrics">{[['Invoiced sales',summary.sales],['Invoiced purchases',summary.purchases],['Gross profit · costed sales',summary.grossProfit]].map(([label,value])=><article key={label}><span>{label}</span><strong>{money(value)}</strong><small>Selected date period · issued invoices</small></article>)}<article><span>Party receivables</span><strong>{balanceError?'Unavailable':money(receivable)}</strong><small>All recorded dates · net balance per party</small></article><article><span>Party payables</span><strong>{balanceError?'Unavailable':money(payable)}</strong><small>All recorded dates · net balance per party</small></article></div><p className="help">Confirmed Sheet snapshot: {accounts.checkedAt?new Date(accounts.checkedAt).toLocaleString():'Not refreshed'}. {summary.missingCosts?`${summary.missingCosts} sales invoice(s) have missing costs and are excluded from gross profit. `:''}Gross profit excludes operating expenses. Invoice totals and payment totals are separate; do not add them together. {balanceError}</p></section>;
}
export default function AccountsPanel({ accounts, endpoint, enabled, preferences, onPayment, paymentPending, section = 'parties', onOpenInvoices, invoiceCreateRequest = 0 }) {
  const [selected,setSelected]=useState('');
  const [balanceTab,setBalanceTab]=useState('receive');
  const isParties=section==='parties';
  useEffect(()=>{setSelected('');setShowParty(false);},[section]);
  const [partyForm,setPartyForm]=useState(newParty);
  const [editParty,setEditParty]=useState(null);
  const [showParty,setShowParty]=useState(false);
  const [invoice,setInvoice]=useState(()=>readDraft(endpoint));
  const [showInvoiceForm,setShowInvoiceForm]=useState(false);
  const [range,setRange]=useState(()=>periodRange('month'));
  const [detailed,setDetailed]=useState(false);
  const [showPrint,setShowPrint]=useState(false);
  const [preparingPrint,setPreparingPrint]=useState(false);
  const [invoiceDetailId,setInvoiceDetailId]=useState('');
  const [invoicePrintSnapshot,setInvoicePrintSnapshot]=useState(null);
  const activeParty=useRef('');
  activeParty.current=isParties?selected:'';
  useEffect(()=>{setShowPrint(false);setPrinting(false);setPrintSnapshot(null);setInvoiceDetailId('');setInvoicePrintSnapshot(null);delete document.body.dataset.accountPrint;},[selected,section]);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  useEffect(()=>{if(invoiceCreateRequest){setShowInvoiceForm(true);setError('');setNotice('');}},[invoiceCreateRequest]);
  const [printing,setPrinting]=useState(false);
  const [printSnapshot,setPrintSnapshot]=useState(null);
  const party=accounts.parties.find(p=>p.id===selected);
  const invoiceDetail=accounts.invoices.find(inv=>inv.id===invoiceDetailId);
  const partyInvoices=accounts.invoices.filter(inv=>inv.partyId===selected).sort((a,b)=>b.invoiceDate.localeCompare(a.invoiceDate)||String(b.createdAt).localeCompare(String(a.createdAt)));
  const blocked=accounts.busy || Boolean(accounts.pending) || !enabled || !accounts.loaded;
  useEffect(()=>{try{localStorage.setItem(`rf.invoiceDraft.${endpoint}`,JSON.stringify(invoice));}catch{setError('Invoice draft could not be saved on this browser. Keep this page open until it is issued.');}},[endpoint,invoice]);
  useEffect(()=>{
    const handler=e=>{if(invoice.items.some(i=>i.description || i.rate) || showParty || accounts.pending){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);
  },[invoice,showParty,accounts.pending]);
  useEffect(()=>{const done=()=>{delete document.body.dataset.accountPrint;setPrinting(false);};window.addEventListener('afterprint',done);return()=>{window.removeEventListener('afterprint',done);delete document.body.dataset.accountPrint;};},[]);
  useEffect(()=>{if(!printing)return;document.body.dataset.accountPrint=printing;const timer=setTimeout(()=>window.print(),0);return()=>clearTimeout(timer);},[printing]);
  const update=(key,value)=>setInvoice(old=>({...old,[key]:value}));
  function updateItem(index,key,value){setInvoice(old=>({...old,items:old.items.map((item,i)=>i===index?{...item,[key]:value}:item)}));}
  function createPartyInvoice(){
    if(!party || blocked)return;
    const hasInvoiceDraft=invoice.invoiceNumber || invoice.notes || invoice.items.some(item=>item.description || item.rate || item.cost);
    if(hasInvoiceDraft && invoice.partyId!==party.id && !window.confirm('Replace the current invoice draft with a new invoice for this party?'))return;
    if(!hasInvoiceDraft || invoice.partyId!==party.id)setInvoice({...blankInvoice(),partyId:party.id});
    setShowInvoiceForm(true);setError('');setNotice('');onOpenInvoices();
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
    e.preventDefault();setError('');setNotice('');
    try{
      const payload=editParty?{id:editParty.id,name:partyForm.name.trim(),phone:partyForm.phone.trim(),address:partyForm.address.trim(),_editId:crypto.randomUUID(),_expectedRevision:Number(editParty.revision||0)}:makeParty(partyForm);
      if(await accounts.save(editParty?'updateParty':'createParty',payload)){setSelected(payload.id);setShowParty(false);setPartyForm(newParty());setEditParty(null);setNotice('Party saved.');}
    }catch(e){setError(e.message);}
  }
  async function issue(e){
    e.preventDefault();setError('');setNotice('');
    try{
      const payload=makeInvoice(invoice);
      if(!window.confirm(`Issue ${invoice.type} invoice ${payload.invoiceNumber} for ${money(payload.totalMinor)}? It will affect the party balance. Issued invoices cannot be edited; cancel and replace if needed.`))return;
      if(await accounts.save('createInvoice',payload)){setInvoice(blankInvoice());setShowInvoiceForm(false);setInvoiceDetailId(payload.id);setNotice('Invoice issued. Record a party payment separately when money is received or paid.');}
    }catch(e){setError(e.message);}
  }
  async function retry(){
    const action=accounts.pending?.action,payload=accounts.pending?.payload;
    if(await accounts.retry()){
      if(action==='createInvoice'){setInvoice(blankInvoice());setShowInvoiceForm(false);setInvoiceDetailId(payload.id);}
      if(action==='createParty'||action==='updateParty'){setSelected(payload.id);setShowParty(false);setEditParty(null);setPartyForm(newParty());}
      setNotice('Saved request confirmed by Google Sheets.');
    }
  }
  async function cancel(inv){
    const reason=window.prompt(`Cancel invoice ${inv.invoiceNumber}? Payments stay unchanged. Enter the reason:`);
    if(!reason?.trim())return;
    if(await accounts.save('cancelInvoice',{id:inv.id,reason:reason.trim()}))setNotice('Invoice cancelled; party balance updated. Payments are unchanged.');
  }
  let statement=null,statementError='',currentBalance=null;
  if(party){try{currentBalance=partyStatement(party,accounts.invoices,accounts.transactions).closing;}catch(e){statementError=e.message;}}
  if(party){try{if(!range[0]||!range[1]||range[0]>range[1])throw new Error('Choose a valid statement date range.');statement=partyStatement(party,accounts.invoices,accounts.transactions,...range);}catch(e){statementError=e.message;}}
  const partyBalances=useMemo(()=>accounts.parties.map(account=>{
    try {return {party:account,balance:partyStatement(account,accounts.invoices,accounts.transactions).closing};}
    catch {return {party:account,balance:null};}
  }),[accounts.parties,accounts.invoices,accounts.transactions]);
  const visibleParties=partyBalances
    .filter(row=>row.balance!==null && (balanceTab==='receive'?row.balance>0:row.balance<0))
    .sort((a,b)=>Math.abs(b.balance)-Math.abs(a.balance)||a.party.name.localeCompare(b.party.name));
  const unavailableBalances=partyBalances.filter(row=>row.balance===null);
  const receiveTotal=partyBalances.reduce((sum,row)=>sum+(row.balance>0?row.balance:0),0);
  const payTotal=partyBalances.reduce((sum,row)=>sum+(row.balance<0?-row.balance:0),0);
  const totalLabel=amount=>!accounts.loaded?'—':unavailableBalances.length?'Unavailable':money(amount);
  let preview=null;try{preview=makeInvoice(invoice,'preview-invoice-0000000000');}catch{/* Validation is shown on submit. */}
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
  if(!enabled)return <section className="accounts-panel"><h2>Update the test Sheet backend</h2><p>Parties and invoices need Code.gs 1.7.0. Download it in Settings → Google Sheets setup, paste it into the copied TEST Sheet’s Apps Script, run setup, and deploy a new version. Then test the connection again.</p><p>Existing payments continue to work with the old backend.</p></section>;
  return <section className="accounts-panel">
    <div className="accounts-controls parties-page-heading"><h1>{isParties?party?'Party details':'Parties':'Invoices'}</h1>{(!isParties||accounts.error)&&<button className="outline" disabled={accounts.busy} onClick={accounts.reload}>{accounts.error?'Retry refresh':'Refresh from Sheets'}</button>}{isParties&&!party&&<button className="primary" disabled={blocked} onClick={()=>{setEditParty(null);setPartyForm(newParty());setShowParty(true);}}>＋ Add Party</button>}{!isParties&&<button type="button" className="primary" disabled={blocked} onClick={()=>{setShowInvoiceForm(true);setError('');setNotice('');}}>＋ Create Invoice</button>}</div>

    {(error||accounts.error)&&<p className="error" role="alert">{error||accounts.error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
    {!accounts.loaded && !accounts.error && <p role="status">Loading parties and invoices…</p>}
    {accounts.loaded&&(accounts.refreshing||accounts.cached||accounts.error)&&<p className="help" role="status">{accounts.refreshing?'Updating balances…':accounts.cached||accounts.error?'Showing saved balances.':''} {accounts.checkedAt&&`Last updated: ${new Date(accounts.checkedAt).toLocaleString()}`}</p>}
    {accounts.pending&&<div className="account-pending"><strong>{accounts.busy?'Saving to Google Sheets…':'A saved request needs confirmation.'}</strong><p>The original request is kept on this device. Retry it before adding another record or switching Sheets.</p><button className="outline" disabled={accounts.busy||accounts.pending.invalid} onClick={retry}>Retry saved request</button>{accounts.rejected&&<button className="outline" disabled={accounts.busy} onClick={()=>{if(window.confirm('Discard the request rejected by the server? Review the draft before trying again.'))accounts.discardRejected();}}>Discard rejected request</button>}</div>}
    {isParties&&showParty&&<form className="account-form" onSubmit={saveParty}><h3>{editParty?'Edit party contact details':'New party'}</h3><fieldset disabled={blocked}><div className="account-fields"><label>Name<input required maxLength="150" value={partyForm.name} onChange={e=>setPartyForm({...partyForm,name:e.target.value})}/></label><label>Phone<input maxLength="50" value={partyForm.phone} onChange={e=>setPartyForm({...partyForm,phone:e.target.value})}/></label><label>Address<textarea maxLength="500" value={partyForm.address} onChange={e=>setPartyForm({...partyForm,address:e.target.value})}/></label></div>{!editParty&&<><div className="account-fields"><label>Opening balance date<input type="date" required value={partyForm.openingDate} onChange={e=>setPartyForm({...partyForm,openingDate:e.target.value})}/></label><label>Opening amount (₹)<input type="number" min="0" step="0.01" required value={partyForm.openingBalance} onChange={e=>setPartyForm({...partyForm,openingBalance:e.target.value})}/></label><label>Who owes?<select value={partyForm.openingDirection} onChange={e=>setPartyForm({...partyForm,openingDirection:e.target.value})}><option value="receivable">Party owes us</option><option value="payable">We owe party</option></select></label></div><p className="help">Enter the balance immediately before this date’s entries. Opening balances cannot be edited in this first version. Choose a date before any invoices or payments you intend to add. Existing name-only payments are not linked automatically.</p></>}<button className="primary">Save party</button> <button type="button" className="outline" onClick={()=>setShowParty(false)}>Close</button></fieldset></form>}
    {isParties&&!party&&<section className="party-directory">
      <div className="party-balance-tabs" role="group" aria-label="Party balance filter">
        <button type="button" aria-pressed={balanceTab==='receive'} onClick={()=>setBalanceTab('receive')}><span>To Receive</span><strong>{totalLabel(receiveTotal)}</strong></button>
        <button type="button" aria-pressed={balanceTab==='pay'} onClick={()=>setBalanceTab('pay')}><span>To Pay</span><strong>{totalLabel(payTotal)}</strong></button>
      </div>
      {unavailableBalances.length>0&&<p className="error">Balances unavailable for {unavailableBalances.map(row=>row.party.name).join(', ')}. Correct their linked payments before using these totals.</p>}
      <div className="party-list-columns" aria-hidden="true"><span>Party name</span><span>Contact number</span><span>Amount</span></div>
      <ul className="party-balance-list">{visibleParties.map(({party:account,balance})=><li key={account.id}><button type="button" className="party-balance-row" onClick={()=>setSelected(account.id)}><strong>{account.name}</strong><span className="party-phone">{account.phone||'No contact number'}</span><span className={`party-amount ${balanceTab}`}>{money(Math.abs(balance))}<span aria-hidden="true"> ›</span></span></button></li>)}</ul>
      {accounts.loaded&&!visibleParties.length&&<div className="party-list-empty">{accounts.parties.length?balanceTab==='receive'?'No amounts to receive.':'No amounts to pay.':'No parties yet. Add a party to get started.'}</div>}
    </section>}
    {isParties&&party&&<button type="button" className="outline party-back" onClick={()=>{setSelected('');setShowParty(false);}}>← Back to parties</button>}
    {isParties&&party&&<>
      <div className="party-overview">
        <div className="party-detail-heading"><div><h2>{party.name}</h2><dl className="party-contact-details"><div><dt>Contact number</dt><dd>{party.phone||'—'}</dd></div><div><dt>Address</dt><dd>{party.address||'—'}</dd></div></dl></div><div className="party-total"><span>Total balance</span><strong>{currentBalance===null?'Unavailable':money(Math.abs(currentBalance))}</strong><small>{currentBalance===null?'':currentBalance>0?'To Receive':currentBalance<0?'To Pay':'Settled'}</small></div></div>
        <div className="accounts-controls"><button className="outline" disabled={blocked} onClick={()=>{setEditParty(party);setPartyForm({...newParty(),...party});setShowParty(true);}}>Edit contact details</button><button className="primary" disabled={blocked||paymentPending} onClick={()=>onPayment(party,'in')}>Receive payment</button><button className="outline" disabled={blocked||paymentPending} onClick={()=>onPayment(party,'out')}>Make payment</button><button type="button" className="outline" disabled={blocked} onClick={createPartyInvoice}>Create Invoice</button><button type="button" className="outline" aria-haspopup="dialog" onClick={()=>{setError('');setShowPrint(true);}} disabled={printing||preparingPrint}>Print Statement</button></div>
      </div>
      <section className="invoice-register party-invoices"><h3>Invoices</h3>{partyInvoices.map(inv=><article key={inv.id}><button type="button" className="invoice-open-row" aria-haspopup="dialog" onClick={()=>{setError('');setInvoiceDetailId(inv.id);}}><div><strong>{inv.invoiceNumber}</strong><small>{inv.invoiceDate} · {inv.type==='sale'?'Sales invoice':'Purchase invoice'}</small>{inv.cancelReason&&<small>Cancellation: {inv.cancelReason}</small>}</div><div className="party-invoice-amount"><strong>{money(inv.totalMinor)}</strong><small>{inv.status==='cancelled'?'Cancelled':'Issued'}</small></div></button></article>)}{!partyInvoices.length&&<p>No invoices for this party yet.</p>}</section>
    </>}
    {!isParties&&<>{showInvoiceForm&&<form className="account-form invoice-form" onSubmit={issue}><div className="accounts-controls invoice-form-heading"><h3>Create Invoice</h3><button type="button" className="outline" disabled={accounts.busy} onClick={()=>setShowInvoiceForm(false)}>Close — keep draft</button></div><fieldset disabled={blocked}><div className="account-fields"><label>Type<select value={invoice.type} onChange={e=>update('type',e.target.value)}><option value="sale">Sales invoice</option><option value="purchase">Purchase invoice</option></select></label><label>Party<select required value={invoice.partyId} onChange={e=>update('partyId',e.target.value)}><option value="">Choose a party</option>{accounts.parties.map(p=><option key={p.id} value={p.id}>{p.name} · {p.phone||p.id.slice(-6)}</option>)}</select></label><label>{invoice.type==='sale'?'Invoice number':'Supplier invoice number'}<input required maxLength="80" value={invoice.invoiceNumber} onChange={e=>update('invoiceNumber',e.target.value)}/></label><label>Invoice date<input type="date" required min={accounts.parties.find(p=>p.id===invoice.partyId)?.openingDate} value={invoice.invoiceDate} onChange={e=>update('invoiceDate',e.target.value)}/></label></div>
    <p className="help">Draft is saved on this browser. Issuing records the invoice without recording a payment. Discounts below apply to the whole line.</p>
    {invoice.items.map((item,index)=><div className="invoice-item-editor" key={index}><label>Item {index+1}<input aria-label={`Item ${index+1} description`} required maxLength="300" value={item.description} onChange={e=>updateItem(index,'description',e.target.value)}/></label><label>Quantity<input type="number" min="0.001" max="1000000" step="0.001" required value={item.quantity} onChange={e=>updateItem(index,'quantity',e.target.value)}/></label><label>Rate (₹)<input type="number" min="0" step="0.01" required value={item.rate} onChange={e=>updateItem(index,'rate',e.target.value)}/></label><label>Line discount (₹)<input type="number" min="0" step="0.01" value={item.discount} onChange={e=>updateItem(index,'discount',e.target.value)}/></label>{invoice.type==='sale'&&<label>Internal unit cost (₹)<input type="number" min="0" step="0.01" value={item.cost} onChange={e=>updateItem(index,'cost',e.target.value)} placeholder="Optional"/></label>}<button type="button" className="outline" disabled={invoice.items.length===1} onClick={()=>update('items',invoice.items.filter((_,i)=>i!==index))}>Remove</button></div>)}
    <button type="button" className="outline" disabled={invoice.items.length>=50} onClick={()=>update('items',[...invoice.items,blankItem()])}>＋ Add item</button><label>Invoice notes<textarea maxLength="1000" value={invoice.notes} onChange={e=>update('notes',e.target.value)}/></label>
    {preview&&<p className="invoice-preview"><strong>Total: {money(preview.totalMinor)}</strong>{invoice.type==='sale'&&<span> Gross profit: {preview.costTotalMinor===null?'Unavailable — enter all unit costs':money(preview.totalMinor-preview.costTotalMinor)}</span>}</p>}
    <p className="help">Internal cost and profit are never printed on party statements. Blank costs are unknown, not zero.</p><button className="primary">Issue invoice</button> <button type="button" className="outline" onClick={()=>{if(window.confirm('Clear this invoice draft?'))setInvoice(blankInvoice());}}>Clear draft</button></fieldset></form>}
    <section className="invoice-register"><h3>All invoices</h3>{[...accounts.invoices].sort((a,b)=>b.invoiceDate.localeCompare(a.invoiceDate)).map(inv=><article key={inv.id}><button type="button" className="invoice-open-row" aria-haspopup="dialog" onClick={()=>{setError('');setInvoiceDetailId(inv.id);}}><div><strong>{inv.invoiceNumber} · {inv.type==='sale'?'Sale':'Purchase'} · {money(inv.totalMinor)}</strong><small>{inv.invoiceDate} · {inv.partyName} · {inv.status}</small>{inv.cancelReason&&<small>Cancellation: {inv.cancelReason}</small>}</div></button>{inv.status==='issued'&&<button className="outline" disabled={blocked} onClick={()=>cancel(inv)}>Cancel invoice</button>}</article>)}{!accounts.invoices.length&&<p>No invoices yet.</p>}</section></>}
    {isParties&&party&&showPrint&&<AccountDialog title="Print Statement" busy={preparingPrint||Boolean(printing)} onClose={()=>setShowPrint(false)}>
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
      <div className="invoice-popup-actions">{invoiceDetail.status==='issued'&&<button type="button" className="primary" disabled={blocked||paymentPending||preparingPrint||Boolean(printing)} onClick={payFromInvoice}>{invoiceDetail.type==='sale'?'Receive Payment':'Make Payment'}</button>}<button type="button" className="primary" disabled={blocked||preparingPrint||Boolean(printing)} onClick={printInvoice}>{preparingPrint?'Preparing invoice…':'Print Invoice'}</button></div>
      <InvoiceDocument invoice={invoiceDetail} preferences={preferences}/>
    </AccountDialog>}
    {printing&&createPortal(<div className="account-print-output">{printing==='statement'&&printSnapshot?<PartyStatement {...printSnapshot} preferences={preferences}/>:printing==='invoice'&&invoicePrintSnapshot?<InvoiceDocument invoice={invoicePrintSnapshot} preferences={preferences}/>:null}</div>,document.body)}
  </section>;
}
