import {ledgerImageDocument} from './documentLayout.js';
import DocumentShare from './DocumentShare.jsx';
import {statementMessage} from './statementMessage.js';
import InvoicePaymentEntry from './InvoicePaymentEntry.jsx';
import InvoiceShare from './InvoiceShare.jsx';
import {invoicePayment,blankCheckout} from './invoiceCheckout.js';
import InvoiceItemEditor from './InvoiceItemEditor.jsx';
import InvoiceTotals from './InvoiceTotals.jsx';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { paymentMethodText, localNow, money, periodRange } from './ledger.js';
import { PARTY_TYPES, blankInvoice, blankItem, makeInvoice, makeParty, partyStatement, invoiceDraftFromRecord, historyInvoices, invoiceNetValue, invoiceNoteRevision, invoiceNeedsCost, blankNoteForm } from './accounts.js';
import PartyStatement from './PartyStatement.jsx';
import { createPortal } from 'react-dom';
import AccountDialog from './AccountDialog.jsx';
import InvoiceDocument from './InvoiceDocument.jsx';
import PartyPicker from './PartyPicker.jsx';
import InvoiceNotes, {NotesRegister,NoteEditor} from './InvoiceNotes.jsx';
import { hasInvoiceDraft, invoiceDraftKey, readInvoiceDraft } from './invoiceDraft.js';

import DocumentTypeSelector from './DocumentTypeSelector.jsx';
import RecordMenu from './RecordMenu.jsx';
import {focusAndCenter} from './entry.js';

export function InvoiceCostBadge({invoice}){return invoiceNeedsCost(invoice)?<small className="profit-pending">Profit pending · CP missing</small>:null;}
const newParty = () => ({partyType:'',name:'',phone:'',address:'',openingDate:localNow().slice(0,10),openingBalance:'0',openingDirection:'receivable'});
export default function AccountsPanel({ onNotice, catalogueEnabled=false,splitEnabled=false, partyTypesEnabled=false, onTransaction, partyTransactions=[], invoiceRoundingEnabled=false, invoiceCheckoutEnabled=false, partyInvoicePaymentEnabled=false, itemDescriptionsEnabled=false, measurementEnabled=false, openingBalanceDeletionEnabled=false, challanEnabled=false, noteChangesEnabled=false, deletionEnabled=false, noteOpenRequest=null, notesEnabled=false, accounts, endpoint, enabled, preferences, onPayment, paymentPending, invoiceEditingEnabled = false, invoiceCreateRequest = 0, invoiceResumeRequest = 0, onDraftChange, invoiceOpenRequest = null, partyOpenRequest = null, onNavigateParties, onNavigateDashboard }) {
  const [selected,setSelected]=useState('');
  const [balanceTab,setBalanceTab]=useState('receive');
  const [partySearch,setPartySearch]=useState('');
  const [partyForm,setPartyForm]=useState(newParty);
  const [editParty,setEditParty]=useState(null);
  const [correctPartyId,setCorrectPartyId]=useState('');
  const [showParty,setShowParty]=useState(false);
  const [initialDraft]=useState(()=>readInvoiceDraft(localStorage,endpoint));
  const [invoice,setInvoice]=useState(initialDraft.draft);
  const [documentKind,setDocumentKind]=useState('invoice');
  const [createNoteForm,setCreateNoteForm]=useState(blankNoteForm);
  const [requestedInvoiceAction,setRequestedInvoiceAction]=useState('');
  const [noteAction,setNoteAction]=useState('');
  const [showInvoiceForm,setShowInvoiceForm]=useState(false);
  const [editingInvoice,setEditingInvoice]=useState(null);
  const [invoiceSaving,setInvoiceSaving]=useState(false);
  const createDraftBeforeEdit=useRef(null);
  const [partyQuery,setPartyQuery]=useState(initialDraft.draft.partyQuery||'');
  const issuing=useRef(false);
  const savingParty=useRef(false);
  const [partySaving,setPartySaving]=useState(false);
  const [returnToInvoice,setReturnToInvoice]=useState(false);
  const [showDraftProfit,setShowDraftProfit]=useState(false);
  const [range,setRange]=useState(()=>periodRange('month'));
  const [detailed,setDetailed]=useState(false);
  const [showPrint,setShowPrint]=useState(false);
  const [ledgerShare,setLedgerShare]=useState(null);
  const [preparingPrint,setPreparingPrint]=useState(false);
  const [invoiceDetailId,setInvoiceDetailId]=useState('');
  const ledgerImage=useMemo(()=>ledgerShare?ledgerImageDocument(ledgerShare,preferences):null,[ledgerShare,preferences]);
  const [showInvoiceShare,setShowInvoiceShare]=useState(false);
  useEffect(()=>setShowInvoiceShare(false),[invoiceDetailId]);
  const [detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState('');
  const [noteInvoiceId,setNoteInvoiceId]=useState('');
  const [noteDetailId,setNoteDetailId]=useState('');
  const [noteDraft,setNoteDraft]=useState(null);
  const noteRequestSeen=useRef(noteOpenRequest);
  useEffect(()=>{if(noteOpenRequest!==noteRequestSeen.current){noteRequestSeen.current=noteOpenRequest;if(noteOpenRequest?.id){setInvoiceDetailId('');setShowInvoiceForm(false);setNoteInvoiceId('');setNoteDetailId(noteOpenRequest.id);setNoteAction(noteOpenRequest.action||'');}}},[noteOpenRequest]);
  const [invoicePrintSnapshot,setInvoicePrintSnapshot]=useState(null);
  const activeParty=useRef('');
  activeParty.current=selected;
  useEffect(()=>{setLedgerShare(null);setShowPrint(false);setPrinting(false);setPrintSnapshot(null);setInvoiceDetailId('');setInvoicePrintSnapshot(null);delete document.body.dataset.accountPrint;},[selected]);
  const [error,setError]=useState(initialDraft.error);
  const setNotice=onNotice;
  // This panel remounts when the Sheet endpoint changes. Old navigation requests
  // must not open an invoice or replace the newly connected Sheet's saved draft.
  const createRequestSeen=useRef(invoiceCreateRequest),resumeRequestSeen=useRef(invoiceResumeRequest),openRequestSeen=useRef(invoiceOpenRequest);
  useEffect(()=>{if(invoiceCreateRequest!==createRequestSeen.current){createRequestSeen.current=invoiceCreateRequest;issuing.current=false;setDocumentKind('invoice');setCreateNoteForm(blankNoteForm());setInvoice(freshInvoice());setPartyQuery('');setInvoiceDetailId('');setShowParty(false);setReturnToInvoice(false);setCorrectPartyId('');setShowInvoiceForm(true);setShowDraftProfit(false);setError('');setNotice('');}},[invoiceCreateRequest]);
  useEffect(()=>{if(invoiceOpenRequest!==openRequestSeen.current){openRequestSeen.current=invoiceOpenRequest;if(invoiceOpenRequest?.id){setShowInvoiceForm(false);setInvoiceDetailId(invoiceOpenRequest.id);setRequestedInvoiceAction(invoiceOpenRequest.action||'');setError('');}}},[invoiceOpenRequest]);
  useEffect(()=>{if(invoiceResumeRequest!==resumeRequestSeen.current){resumeRequestSeen.current=invoiceResumeRequest;if(!hasInvoiceDraft({...invoice,partyQuery}))return;setDocumentKind('invoice');issuing.current=false;setInvoiceDetailId('');setShowParty(false);setReturnToInvoice(false);setShowInvoiceForm(true);setShowDraftProfit(false);setError('');setNotice('');}},[invoiceResumeRequest]);
  const partyRequestSeen=useRef(partyOpenRequest);
  useEffect(()=>{
    if(partyOpenRequest===partyRequestSeen.current||!partyOpenRequest?.id||!accounts.loaded)return;
    partyRequestSeen.current=partyOpenRequest;
    if(!accounts.parties.some(record=>record.id===partyOpenRequest.id)){setError('This party is no longer available. Refresh the party list.');return;}
    setSelected(partyOpenRequest.id);setShowParty(false);setShowPrint(false);setInvoiceDetailId('');setNoteDetailId('');setNoteInvoiceId('');setError('');setNotice('');
  },[partyOpenRequest,accounts.loaded,accounts.parties]);
  useEffect(()=>{onDraftChange?.(hasInvoiceDraft(editingInvoice?createDraftBeforeEdit.current?.invoice||blankInvoice():{...invoice,partyQuery}));},[invoice,partyQuery,editingInvoice,onDraftChange]);
  useEffect(()=>{if(!showInvoiceForm)return;const timer=setTimeout(()=>document.querySelector(editingInvoice?'.account-invoice-dialog input[aria-label="Item 1 description"]':'.account-invoice-dialog input[name=invoice-party]')?.focus(),0);return()=>clearTimeout(timer);},[showInvoiceForm,editingInvoice]);
  useEffect(()=>{if(invoice.partyId){const match=accounts.selectableParties.find(item=>item.id===invoice.partyId);if(match)setPartyQuery(match.name);}},[invoice.partyId,accounts.selectableParties]);
  const [printing,setPrinting]=useState(false);
  const [printSnapshot,setPrintSnapshot]=useState(null);
  const party=accounts.parties.find(p=>p.id===selected);
  const invoiceDetail=accounts.invoices.find(inv=>inv.id===invoiceDetailId)||accounts.pendingInvoices.find(inv=>inv.id===invoiceDetailId);
  const detailLoader=useRef(accounts.loadInvoiceDetails);
  useEffect(()=>{detailLoader.current=accounts.loadInvoiceDetails;},[accounts.loadInvoiceDetails]);
  useEffect(()=>{
    if(!invoiceDetail||Array.isArray(invoiceDetail.items)){setDetailLoading(false);setDetailError('');return;}
    let cancelled=false;setDetailLoading(true);setDetailError('');
    detailLoader.current([invoiceDetail.id]).catch(error=>{if(!cancelled)setDetailError(error.message);}).finally(()=>{if(!cancelled)setDetailLoading(false);});
    return()=>{cancelled=true;};
  },[invoiceDetail]);
  const invoiceEditProtected=accounts.notedInvoiceIds?.has(invoiceDetailId)||accounts.notes.some(note=>note.invoiceId===invoiceDetailId);
  const invoiceHasNotes=accounts.notes.some(note=>note.invoiceId===invoiceDetailId);
  const partyNotes=useMemo(()=>[...accounts.notes,...accounts.pendingNotes].filter(note=>note.partyId===selected),[accounts.notes,accounts.pendingNotes,selected]);
  const createNoteInvoice=accounts.invoices.find(record=>record.id===createNoteForm.invoiceId&&record.status==='issued'&&record.partyId===invoice.partyId);
  const correctionInvoices=useMemo(()=>accounts.invoices.filter(record=>record.status==='issued'&&(!invoice.partyId||record.partyId===invoice.partyId)),[accounts.invoices,invoice.partyId]);
  const noteInvoice=accounts.invoices.find(invoice=>invoice.id===noteInvoiceId);
  const relatedPayments=useMemo(()=>partyTransactions.filter(row=>row.partyId===selected&&!row.deletedAt).sort((a,b)=>`${b.transactionDate}T${b.transactionTime||''}`.localeCompare(`${a.transactionDate}T${a.transactionTime||''}`)||String(b.createdAt||'').localeCompare(String(a.createdAt||''))),[partyTransactions,selected]);
  const partyInvoices=useMemo(()=>[...accounts.invoices,...accounts.pendingInvoices].filter(inv=>inv.partyId===selected).sort((a,b)=>b.invoiceDate.localeCompare(a.invoiceDate)||String(b.createdAt).localeCompare(String(a.createdAt))),[accounts.invoices,accounts.pendingInvoices,selected]);
  const blocked=accounts.busy || Boolean(accounts.pending) || !enabled || !accounts.loaded;
  useEffect(()=>{if(accounts.loaded&&selected&&!party&&!accounts.busy)setSelected('');},[accounts.loaded,selected,party,accounts.busy]);
  useEffect(()=>{if(editingInvoice)return;try{localStorage.setItem(invoiceDraftKey(endpoint),JSON.stringify({...invoice,partyQuery}));}catch{setError('Invoice draft could not be saved on this browser. Keep this page open until it is issued.');}},[endpoint,invoice,partyQuery,editingInvoice]);
  useEffect(()=>{
    const handler=e=>{if(invoice.items.some(i=>i.description || i.rate) || showParty || accounts.pending){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);
  },[invoice,showParty,accounts.pending]);
  useEffect(()=>{const done=()=>{delete document.body.dataset.accountPrint;setPrinting(false);};window.addEventListener('afterprint',done);return()=>{window.removeEventListener('afterprint',done);delete document.body.dataset.accountPrint;};},[]);
  useEffect(()=>{if(!printing)return;document.body.dataset.accountPrint=printing;const timer=setTimeout(()=>window.print(),0);return()=>clearTimeout(timer);},[printing]);
  function freshInvoice(){const draft=blankInvoice();if(measurementEnabled)draft.items[0].billingUnit='nos';return draft;}
  const update=(key,value)=>setInvoice(old=>({...old,[key]:value}));
  const updateInvoiceItem=useCallback((index,value)=>setInvoice(old=>({...old,items:old.items.map((row,i)=>i===index?value:row)})),[]);
  const removeInvoiceItem=useCallback(index=>setInvoice(old=>({...old,items:old.items.filter((_,i)=>i!==index)})),[]);
  function addInvoiceItem(){setInvoice(old=>({...old,items:[...old.items,{...blankItem(),billingUnit:measurementEnabled?'nos':''}]}));setTimeout(()=>focusAndCenter(document.querySelector('.account-invoice-dialog .invoice-item-editor:last-of-type input')),0);}
  useEffect(()=>{
    if(!showInvoiceForm)return;
    const handler=event=>{
      if(event.defaultPrevented || !document.querySelector('dialog.account-invoice-dialog[open]') || document.querySelector('dialog.account-invoice-dialog .invoice-form > fieldset:disabled') || event.repeat || event.isComposing || event.getModifierState?.('AltGraph'))return;
      const key=event.key.toLowerCase();
      if(documentKind==='invoice'&&(event.ctrlKey||event.metaKey) && !event.altKey && !event.shiftKey && key==='enter'){event.preventDefault();document.querySelector('.account-invoice-dialog form')?.requestSubmit();return;}
      if(!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)return;
      if(['1','2','3','4'].includes(key)&&!editingInvoice){event.preventDefault();changeDocumentType({1:'sale',2:'purchase',3:'credit',4:'debit'}[key]);focusAndCenter(document.querySelector('.account-invoice-dialog [data-document-type]'));return;}
      if(documentKind!=='invoice')return;
      if(key==='a' && invoice.items.length<50 && accounts.canQueue){event.preventDefault();addInvoiceItem();return;}
      if(key==='g'&&invoice.type==='sale'){event.preventDefault();setShowDraftProfit(old=>!old);focusAndCenter(document.querySelector('.account-invoice-dialog .draft-profit button'));return;}
      const root=document.querySelector('.account-invoice-dialog'),item=document.activeElement?.closest('.invoice-item-editor')||root?.querySelector('.invoice-item-editor');
      const selector={q:'input[name=invoice-party]',d:'input[type=date]',v:'textarea[data-invoice-field=notes]',t:'[data-document-type]',h:'[data-invoice-field=challan]',x:'[data-invoice-field=invoice-discount]'}[key];
      const field={j:'description',u:'quantity',r:'rate',c:'cost',b:'unit'}[key];
      const target=selector?root?.querySelector(selector):field?(item?.querySelector(`[data-invoice-field="${field}"]`)||(field==='quantity'?item?.querySelector('[data-size-field="quantity"], [data-size-field="length"]'):null)):['l','w','f'].includes(key)?item?.querySelector(`[data-size-field="${{l:'length',w:'width',f:'pieces'}[key]}"]`):null;
      if(target&&!target.matches(':disabled')){event.preventDefault();focusAndCenter(target);}
    };
    window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  },[showInvoiceForm,invoice.items.length,accounts.canQueue,accounts.invoices,editingInvoice,documentKind,invoice.type,invoice.partyId]);
  function changeDocumentType(value){
    if(value==='sale'||value==='purchase'){setDocumentKind('invoice');setInvoice(old=>({...old,type:value,walkIn:value==='sale'&&old.walkIn}));}
    else {setInvoice(old=>({...old,walkIn:false}));setDocumentKind(value);setCreateNoteForm(old=>{const choices=accounts.invoices.filter(record=>record.status==='issued'&&record.partyId===invoice.partyId);return {...old,type:value,invoiceId:choices.some(record=>record.id===old.invoiceId)?old.invoiceId:choices.length===1?choices[0].id:''};});}
  }
  useEffect(()=>{if(!requestedInvoiceAction||!invoiceDetail||blocked||!Array.isArray(invoiceDetail.items))return;const action=requestedInvoiceAction;setRequestedInvoiceAction('');if(action==='edit')editInvoice();else if(action==='delete')deleteInvoice(invoiceDetail);else if(action==='print')printInvoice();},[requestedInvoiceAction,invoiceDetail,blocked]);
  function editInvoice(){
    if(blocked||!invoiceEditingEnabled||invoiceEditProtected||invoiceDetail?.status!=='issued'||!Array.isArray(invoiceDetail?.items))return;
    createDraftBeforeEdit.current={invoice:{...invoice,partyQuery},partyQuery};
    setDocumentKind('invoice');setEditingInvoice(invoiceDetail);setInvoice(invoiceDraftFromRecord(invoiceDetail));setPartyQuery(invoiceDetail.partyName);setInvoiceDetailId('');setShowInvoiceForm(true);setShowDraftProfit(false);issuing.current=false;setError('');
  }
  function finishInvoiceEdit(){
    const id=editingInvoice?.id,backup=createDraftBeforeEdit.current;
    setInvoice(backup?.invoice||blankInvoice());setPartyQuery(backup?.partyQuery||'');createDraftBeforeEdit.current=null;setEditingInvoice(null);setShowInvoiceForm(false);setInvoiceDetailId(id||'');issuing.current=false;
  }
  function closeInvoiceForm(){
    if(invoiceSaving)return;
    if(documentKind!=='invoice'&&(createNoteForm.amount||createNoteForm.reason)&&!window.confirm('Close this unsaved correction note?'))return;
    if(editingInvoice&&accounts.pending?.action==='updateInvoice'){finishInvoiceEdit();return;}
    if(editingInvoice){if(JSON.stringify(invoice)!==JSON.stringify(invoiceDraftFromRecord(editingInvoice))&&!window.confirm('Discard these unsaved invoice changes?'))return;finishInvoiceEdit();}else setShowInvoiceForm(false);
  }
  async function retryInvoiceEdit(){if(await accounts.retry())finishInvoiceEdit();}
  async function discardInvoiceEdit(){if(window.confirm('Discard this rejected invoice edit and review the latest invoice?')&&await accounts.discardRejected())finishInvoiceEdit();}
  function selectInvoiceParty(account){setCreateNoteForm(old=>{const choices=accounts.invoices.filter(record=>record.partyId===account.id&&record.status==='issued');return {...old,invoiceId:choices.some(record=>record.id===old.invoiceId)?old.invoiceId:choices.length===1?choices[0].id:''};});setInvoice(old=>({...old,partyId:account.id}));setPartyQuery(account.name);}
  function createPartyFromInvoice(){setCorrectPartyId('');setReturnToInvoice(true);setShowInvoiceForm(false);setShowParty(true);setEditParty(null);setSelected('');setPartyForm({...newParty(),name:partyQuery.trim(),openingDate:invoice.invoiceDate});onNavigateParties();}
  function cancelPartyForm(){setShowParty(false);setCorrectPartyId('');setError('');if(returnToInvoice){setReturnToInvoice(false);setShowInvoiceForm(true);onNavigateDashboard();}}
  function createPartyInvoice(){
    if(!party || blocked)return;
    issuing.current=false;setDocumentKind('invoice');setCreateNoteForm(blankNoteForm());setInvoice({...freshInvoice(),partyId:party.id});setPartyQuery(party.name);
    setShowInvoiceForm(true);setError('');setNotice('');
  }
  function payFromInvoice(){
    if(!invoiceDetail || invoiceDetail.status!=='issued' || blocked)return;
    const account=accounts.parties.find(item=>item.id===invoiceDetail.partyId);
    if(!account){setError('Refresh parties before recording this payment.');return;}
    if(onPayment(account))setInvoiceDetailId('');
  }
  async function printInvoice(){
    if(preparingPrint || blocked || !invoiceDetail)return;
    const id=invoiceDetail.id;
    setPreparingPrint(true);setError('');
    try{
      const result=await accounts.reload({fresh:true});
      if(!result)return;
      const [freshInvoice]=await accounts.loadInvoiceDetails([id],{fresh:true});
      if(!freshInvoice)throw new Error('Invoice no longer exists. Refresh the invoice list.');
      setInvoicePrintSnapshot({...freshInvoice,_printTransactions:result.transactions});setPrinting('invoice');
    }catch(e){setError(e.message);}
    finally{setPreparingPrint(false);}
  }
  async function saveParty(e){
    e.preventDefault();if(savingParty.current)return;savingParty.current=true;setPartySaving(true);setError('');setNotice('');
    try{
      const payload=editParty?{id:editParty.id,name:partyForm.name.trim(),phone:partyForm.phone.trim(),address:partyForm.address.trim(),...(partyTypesEnabled?{partyType:partyForm.partyType||''}:{}),_editId:crypto.randomUUID(),_expectedRevision:Number(editParty.revision||0)}:makeParty(partyForm,correctPartyId||undefined);
      if(!partyTypesEnabled){if(partyForm.partyType)throw new Error('Deploy Code.gs 1.21.0 and refresh before saving party types.');delete payload.partyType;}
      if(correctPartyId){if(await accounts.correctRejectedParty(payload)){setCorrectPartyId('');setShowParty(false);setPartyForm(newParty());}return;}
      if(returnToInvoice&&!editParty){
        if(await accounts.queueParty(payload)){setInvoice(old=>({...old,partyId:payload.id}));setPartyQuery(payload.name);setReturnToInvoice(false);setShowParty(false);setPartyForm(newParty());setShowInvoiceForm(true);onNavigateDashboard();}
        return;
      }
      if(await accounts.save(editParty?'updateParty':'createParty',payload)){setSelected(payload.id);setShowParty(false);setPartyForm(newParty());setEditParty(null);setNotice('Party saved.');}
    }catch(e){setError(e.message);}finally{savingParty.current=false;setPartySaving(false);}
  }
  async function issue(e){
    const saveNew=e.nativeEvent?.submitter?.dataset.saveNew==='true';
    e.preventDefault();if(issuing.current)return;issuing.current=true;setError('');setNotice('');
    try{
      const payload=makeInvoice(invoice,editingInvoice?.id);
      if(payload.items.some(item=>item.itemNote)&&!itemDescriptionsEnabled)throw new Error('Deploy Sheet backend 1.15.2 before saving item descriptions.');
      if(payload.items.some(item=>item.billingUnit)&&!measurementEnabled)throw new Error('Deploy Sheet backend 1.15.0 before saving billing units or grouped measurements.');
      if(payload.challanNumber&&!challanEnabled)throw new Error('Deploy Sheet backend 1.13.0 before saving a challan number.');
      const account=accounts.selectableParties.find(item=>item.id===payload.partyId);
      if(!payload.walkIn&&!account)throw new Error('Select an existing party or create a new party.');
      if(!payload.walkIn&&payload.invoiceDate<account.openingDate)throw new Error('Invoice date cannot predate the party opening balance date.');
      if((payload.walkIn||payload.invoiceDiscountMinor>0)&&!invoiceCheckoutEnabled)throw new Error('Deploy Code.gs 1.19.0 and refresh before using walk-in sales or invoice discounts.');
      if(payload.autoRoundOff&&!invoiceRoundingEnabled)throw new Error('Deploy Code.gs 1.25.0 and refresh before using auto round-off.');
      Object.assign(payload,{partyName:payload.walkIn?'CASH SALE':account.name,partyPhone:payload.walkIn?'':account.phone,partyAddress:payload.walkIn?'':account.address});
      if(!editingInvoice&&(payload.walkIn||invoice.paymentWithInvoice)){
        if(!payload.walkIn&&!partyInvoicePaymentEnabled)throw new Error('Deploy Code.gs 1.20.0 and refresh before recording payment with a party invoice.');
        if(invoice.checkout?.method==='Split'&&!splitEnabled)throw new Error('Deploy Code.gs 1.22.0 and refresh before using Cash + Online.');
        payload.payment=invoicePayment(payload,invoice.checkout||blankCheckout());
      }
      if(editingInvoice?.walkIn&&(payload.totalMinor!==Number(editingInvoice.totalMinor)||payload.invoiceDate!==editingInvoice.invoiceDate))throw new Error('Keep the walk-in total and date unchanged, or delete and reissue the invoice and payment.');
      if(editingInvoice){
        if(!window.confirm(`Save changes to ${editingInvoice.invoiceNumber} for ${money(payload.totalMinor)}? The party balance and invoice totals will update. Payments stay unchanged.`)){issuing.current=false;return;}
        Object.assign(payload,{invoiceNumber:editingInvoice.invoiceNumber,_editId:crypto.randomUUID(),_expectedRevision:Number(editingInvoice.revision||0)});setInvoiceSaving(true);
        if(await accounts.save('updateInvoice',payload)){finishInvoiceEdit();setNotice('Invoice updated.');}else issuing.current=false;
        return;
      }
      if(!window.confirm(`Issue ${invoice.type} invoice for ${money(payload.totalMinor)}? Its RF number will be assigned by Google Sheets. ${payload.payment?`A ${money(payload.payment.amountMinor)} ${payload.payment.method} payment will be saved with it.`:'It will affect the party balance.'}`)){issuing.current=false;return;}
      if(await accounts.queueInvoice(payload)){setInvoice(freshInvoice());setPartyQuery('');issuing.current=false;setShowInvoiceForm(saveNew);setInvoiceDetailId(saveNew?'':payload.id);if(saveNew)setTimeout(()=>focusAndCenter(document.querySelector('.account-invoice-dialog input[name=invoice-party]')),0);setNotice('Invoice saved on this device. Uploading to Google Sheets in the background.');}else issuing.current=false;
    }catch(e){issuing.current=false;setError(e.message);}finally{setInvoiceSaving(false);}
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
      if(operation?.action==='createInvoiceNote'){setNoteAction('');setNoteDraft(operation.payload);setNoteInvoiceId(operation.payload.invoiceId);setNoteDetailId('');setInvoiceDetailId('');}
      if(restored){issuing.current=false;setInvoiceDetailId('');setShowInvoiceForm(true);setShowDraftProfit(false);onNavigateDashboard();}
    }
  }
  async function deleteInvoice(inv){
    setError('');
    const attached=accounts.notes.filter(note=>note.invoiceId===inv.id);
    const reason=window.prompt(`Delete invoice ${inv.invoiceNumber}${attached.length?' and its '+attached.length+' correction note(s)':''} from the active ledger? Payments stay unchanged. Sheet rows are retained for recovery. Enter a reason:`);
    if(!reason?.trim())return;
    if(await accounts.save('deleteInvoice',{id:inv.id,reason:reason.trim(),_expectedRevision:Number(inv.revision||0),_expectedNotes:invoiceNoteRevision(accounts.notes,inv.id)})){setInvoiceDetailId(current=>current===inv.id?'':current);setNotice('Invoice deleted from the active ledger. Payments stay unchanged.');}
  }
  async function deleteParty(){
    if(!party||blocked||paymentPending)return;
    setError('');
    if(accounts.invoices.some(invoice=>invoice.partyId===party.id&&invoice.status==='issued')||accounts.transactions.some(payment=>payment.partyId===party.id&&!payment.deletedAt)){setError('This party has active invoices or payments. Delete those records first.');return;}
    const openingBalance=Number(party.openingBalanceMinor);
    if(openingBalance!==0&&!openingBalanceDeletionEnabled){setError('Deploy Code.gs 1.14.1 or newer and refresh before deleting a party with an opening balance.');return;}
    const impact=openingBalance===0?'':` Its ${money(Math.abs(openingBalance))} opening ${openingBalance>0?'receivable':'payable'} will be removed from active balances.`;
    if(!window.confirm(`Delete party ${party.name}?${impact} No transaction will be created. Its opening balance and saved Sheet record are retained for recovery.`))return;
    if(await accounts.save('deleteParty',{id:party.id,_expectedRevision:Number(party.revision||0),_expectedOpeningBalanceMinor:openingBalance})){setSelected(current=>current===party.id?'':current);setShowParty(false);setNotice('Party deleted. Its Sheet record is retained for recovery.');}
  }
  const partyBalances=accounts.partyBalances;
  const currentBalance=partyBalances.find(row=>row.party.id===selected)?.balance??null;
  const {statement,statementError}=useMemo(()=>{
    if(!party)return {statement:null,statementError:''};
    try{if(!range[0]||!range[1]||range[0]>range[1])throw new Error('Choose a valid statement date range.');return {statement:partyStatement(party,accounts.invoices,accounts.transactions,...range,accounts.notes),statementError:''};}
    catch(error){return {statement:null,statementError:error.message};}
  },[party,accounts.invoices,accounts.transactions,accounts.notes,range]);
  const searchTerm=partySearch.trim().normalize('NFKC').toLocaleLowerCase();
  const visibleParties=useMemo(()=>partyBalances
    .filter(row=>searchTerm?[row.party.name,row.party.phone].some(value=>String(value||'').normalize('NFKC').toLocaleLowerCase().includes(searchTerm)):balanceTab==='all'||row.balance!==null && (balanceTab==='receive'?row.balance>0:row.balance<0))
    .sort((a,b)=>Math.abs(b.balance||0)-Math.abs(a.balance||0)||a.party.name.localeCompare(b.party.name)),[partyBalances,searchTerm,balanceTab]);
  const {unavailableBalances,receiveTotal,payTotal}=useMemo(()=>({unavailableBalances:partyBalances.filter(row=>row.balance===null),receiveTotal:partyBalances.reduce((sum,row)=>sum+(row.balance>0?row.balance:0),0),payTotal:partyBalances.reduce((sum,row)=>sum+(row.balance<0?-row.balance:0),0)}),[partyBalances]);
  const totalLabel=amount=>!accounts.loaded?'—':unavailableBalances.length?'Unavailable':money(amount);
  const preview=useMemo(()=>{try{return makeInvoice({...invoice,partyId:invoice.partyId||'preview-party',invoiceDate:invoice.invoiceDate||localNow().slice(0,10)},'preview-invoice-0000000000');}catch{return null;}},[invoice]);
  async function printStatement(action='print'){
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
      let invoices=result.invoices;
      if(printDetailed){const ids=invoices.filter(invoice=>invoice.partyId===partyId&&invoice.status==='issued'&&invoice.invoiceDate>=printRange[0]&&invoice.invoiceDate<=printRange[1]).map(invoice=>invoice.id);const details=ids.length?await accounts.loadInvoiceDetails(ids,{fresh:true}):[];const expected=new Map(invoices.map(invoice=>[invoice.id,invoice]));if(details.some(invoice=>Number(invoice.revision||0)!==Number(expected.get(invoice.id)?.revision||0)||invoice.status!==expected.get(invoice.id)?.status))throw new Error('An invoice changed while preparing the statement. Prepare it again.');const map=new Map(details.map(invoice=>[invoice.id,invoice]));invoices=invoices.map(invoice=>map.get(invoice.id)||invoice);}
      const freshStatement=partyStatement(freshParty,invoices,result.transactions,...printRange,result.notes||[]);
      const snapshot={party:freshParty,statement:freshStatement,range:printRange,detailed:printDetailed,checkedAt:new Date().toISOString()};if(action==='share')setLedgerShare(snapshot);else{setPrintSnapshot(snapshot);setPrinting('statement');}
    }catch(e){setError(e.message);}
    finally{setPreparingPrint(false);}
  }
  if(!endpoint)return <section className="accounts-panel"><p>Connect the test Google Sheet in Settings to start.</p></section>;
  if(!enabled)return <section className="accounts-panel"><h2>Update the test Sheet backend</h2><p>Parties and invoices need Code.gs 1.8.0. Download it in Settings → Google Sheets setup, paste it into the copied TEST Sheet’s Apps Script, run setup, and deploy a new version. Then test the connection again.</p><p>Existing payments continue to work with the old backend.</p></section>;
  const documentHeader=<><DocumentTypeSelector invoiceType={createNoteInvoice?.type} value={documentKind==='invoice'?invoice.type:documentKind} disabled={Boolean(editingInvoice)} onChange={changeDocumentType}/>{documentKind==='invoice'?<><div className="invoice-customer-mode" role="group" aria-label="Invoice customer mode"><button data-hotkey="alt+shift+y" aria-keyshortcuts="Alt+Shift+Y" data-hotkey-label="Party invoice mode" type="button" className="outline" aria-pressed={!invoice.walkIn} disabled={Boolean(editingInvoice)} onClick={()=>update('walkIn',false)}>Party invoice</button><button data-hotkey="alt+shift+w" aria-keyshortcuts="Alt+Shift+W" data-hotkey-label="Walk-in invoice mode" type="button" className="outline" aria-pressed={Boolean(invoice.walkIn)} disabled={!invoiceCheckoutEnabled||invoice.type!=='sale'||Boolean(editingInvoice)} onClick={()=>setInvoice(old=>old.walkIn?old:{...old,walkIn:true,checkout:blankCheckout()})}>Walk-in / CASH SALE</button>{!invoiceCheckoutEnabled&&<small>Walk-in & invoice discounts require backend 1.19.0.</small>}</div><div className="account-fields invoice-header-fields">{invoice.walkIn?<div className="walk-in-customer"><strong>CASH SALE</strong><small>No customer record · Cash or Online payment</small></div>:<PartyPicker balances={accounts.partyBalances} balancesLoaded={accounts.loaded} balancesCached={accounts.cached} balancesRefreshing={accounts.refreshing} disabled={Boolean(editingInvoice)} parties={accounts.selectableParties} value={partyQuery} selectedId={invoice.partyId} onChange={value=>{setPartyQuery(value);update('partyId','');}} onSelect={selectInvoiceParty} onCreate={createPartyFromInvoice}/>}<label>Invoice date<input type="date" required min={invoice.walkIn?undefined:accounts.selectableParties.find(p=>p.id===invoice.partyId)?.openingDate} disabled={Boolean(editingInvoice?.walkIn)} value={invoice.invoiceDate} onChange={e=>update('invoiceDate',e.target.value)}/></label><label>Challan No.<input data-invoice-field="challan" maxLength="80" disabled={!challanEnabled} title={challanEnabled?undefined:'Update Sheet backend to 1.13.0 to save challan numbers'} placeholder={challanEnabled?'Optional':'Requires backend 1.13.0'} value={invoice.challanNumber||''} onChange={e=>update('challanNumber',e.target.value)}/></label></div></>:<div className="account-fields note-header-fields"><PartyPicker balances={accounts.partyBalances} balancesLoaded={accounts.loaded} balancesCached={accounts.cached} balancesRefreshing={accounts.refreshing} parties={accounts.selectableParties} value={partyQuery} selectedId={invoice.partyId} onChange={value=>{setPartyQuery(value);update('partyId','');setCreateNoteForm(old=>({...old,invoiceId:''}));}} onSelect={selectInvoiceParty} onCreate={createPartyFromInvoice}/><label>Original invoice<select data-note-field="invoice" required value={createNoteForm.invoiceId} onChange={e=>{const record=accounts.invoices.find(item=>item.id===e.target.value);setCreateNoteForm(old=>({...old,invoiceId:e.target.value}));if(record){update('partyId',record.partyId);setPartyQuery(accounts.parties.find(party=>party.id===record.partyId)?.name||record.partyName);}}}><option value="">{invoice.partyId&&!correctionInvoices.length?'No saved invoices for this party':'Select invoice to adjust…'}</option>{correctionInvoices.map(record=><option key={record.id} value={record.id}>{record.invoiceNumber} · {record.partyName} · {record.type==='sale'?'Sale':'Purchase'} · {money(record.totalMinor)}</option>)}</select><small className="help">Choose the invoice this note adjusts. A credit reduces its value; a debit increases it.</small></label></div>}</>;

  return <section className="accounts-panel">
    <div className="accounts-controls parties-page-heading"><h1>{party?'Party details':'Parties'}</h1>{!party&&<button data-hotkey="alt+n" aria-keyshortcuts="Alt+N" data-hotkey-label="Add party" className="primary" disabled={blocked} onClick={()=>{setError('');setEditParty(null);setPartyForm(newParty());setShowParty(true);}}>＋ Add Party</button>}</div>

    {error&&<p className="error" role="alert">{error}</p>}
    {!accounts.loaded && !accounts.error && <p role="status">Loading parties and invoices…</p>}
    {accounts.loaded&&(accounts.refreshing||accounts.cached||accounts.error)&&<p className="help" role="status">{accounts.refreshing?'Updating balances…':accounts.cached||accounts.error?'Showing saved balances.':''} {accounts.checkedAt&&`Last updated: ${new Date(accounts.checkedAt).toLocaleString()}`}</p>}
    {accounts.pending&&(accounts.pending.failure||accounts.pending.invalid||accounts.rejected)&&<div className="account-pending"><strong>{accounts.busy?'Saving to Google Sheets…':'A saved request needs confirmation.'}</strong>{accounts.error&&<p className="sync-error" role="alert">{accounts.error}</p>}<p>The original request is kept on this device. Uploads run in order. Resolve any failed request before switching Sheets.</p><button className="outline" disabled={accounts.busy||accounts.pending.invalid} onClick={retry}>Retry saved request</button>{accounts.rejected&&<button className="outline" disabled={accounts.busy} onClick={discardRejectedRequest}>Discard rejected request</button>}{accounts.rejected&&accounts.pending.action==='createParty'&&<button className="outline" disabled={accounts.busy} onClick={()=>{const saved=accounts.pending.payload;setCorrectPartyId(saved.id);setEditParty(null);setSelected('');setShowParty(true);setPartyForm({...newParty(),...saved,openingBalance:(Math.abs(saved.openingBalanceMinor)/100).toFixed(2),openingDirection:saved.openingBalanceMinor<0?'payable':'receivable'});}}>Correct rejected party</button>}</div>}
    {showParty&&<AccountDialog className="account-party-dialog" initialFocus="input[name=party-name]" title={editParty?'Edit party contact details':correctPartyId?'Correct rejected party':'New party'} busy={partySaving} onClose={cancelPartyForm}>{(error||accounts.error)&&<p className="error" role="alert">{error||accounts.error}</p>}<form className="account-form party-form" data-shortcut-form onSubmit={saveParty}><fieldset disabled={partySaving||(correctPartyId?accounts.busy:returnToInvoice?!accounts.canQueue:blocked)}><div className="account-fields"><label>Name<input data-hotkey="alt+q" aria-keyshortcuts="Alt+Q" name="party-name" required maxLength="150" value={partyForm.name} onChange={e=>setPartyForm({...partyForm,name:e.target.value})}/></label><label>Party type<select data-hotkey="alt+t" aria-keyshortcuts="Alt+T" aria-label="Party type" disabled={!partyTypesEnabled} value={partyForm.partyType||''} onChange={e=>setPartyForm({...partyForm,partyType:e.target.value})}><option value="">Unclassified</option>{Object.entries(PARTY_TYPES).filter(([value])=>value!=='karigar'||splitEnabled||partyForm.partyType==='karigar').map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>{!partyTypesEnabled&&<small>Requires Sheet backend 1.21.0.</small>}</label><label>Phone<input data-hotkey="alt+p" aria-keyshortcuts="Alt+P" data-hotkey-label="Party phone" maxLength="50" value={partyForm.phone} onChange={e=>setPartyForm({...partyForm,phone:e.target.value})}/></label><label>Address<textarea data-hotkey="alt+a" aria-keyshortcuts="Alt+A" data-hotkey-label="Party address" maxLength="500" value={partyForm.address} onChange={e=>setPartyForm({...partyForm,address:e.target.value})}/></label></div>{!editParty&&<><div className="account-fields"><label>Opening balance date<input data-hotkey="alt+d" aria-keyshortcuts="Alt+D" type="date" required value={partyForm.openingDate} onChange={e=>setPartyForm({...partyForm,openingDate:e.target.value})}/></label><label>Opening amount (₹)<input data-hotkey="alt+m" aria-keyshortcuts="Alt+M" type="number" min="0" step="0.01" required value={partyForm.openingBalance} onChange={e=>setPartyForm({...partyForm,openingBalance:e.target.value})}/></label><label>Who owes?<select data-hotkey="alt+w" aria-keyshortcuts="Alt+W" value={partyForm.openingDirection} onChange={e=>setPartyForm({...partyForm,openingDirection:e.target.value})}><option value="receivable">Party owes us</option><option value="payable">We owe party</option></select></label></div><p className="help">Enter the balance immediately before this date’s entries. Opening balances cannot be edited in this first version. Choose a date before any invoices or payments you intend to add. Existing name-only payments are not linked automatically.</p></>}<button className="primary">Save party <kbd aria-hidden="true">Ctrl + Enter</kbd></button></fieldset> <button type="button" className="outline" disabled={partySaving} onClick={cancelPartyForm}>{returnToInvoice?'Back to invoice':'Cancel'}</button></form></AccountDialog>}
    {!party&&<section className="party-directory">
      <div className="party-directory-search"><label htmlFor="party-directory-query">Search all parties</label><div><input id="party-directory-query" type="search" value={partySearch} placeholder="Name or phone, including settled parties" onChange={event=>setPartySearch(event.target.value)}/>{partySearch&&<button type="button" className="outline" onClick={()=>setPartySearch('')}>Clear search</button>}</div>{searchTerm&&<p className="help">Search includes parties who owe, parties we owe, and settled accounts.</p>}</div>
      <div className="party-balance-tabs" role="group" aria-label="Party balance filter">
        <button data-hotkey="alt+1" aria-keyshortcuts="Alt+1" data-hotkey-label="All parties" type="button" data-tone="inactive" aria-pressed={!searchTerm&&balanceTab==='all'} onClick={()=>{setBalanceTab('all');setPartySearch('');}}><span>All Parties</span><strong>{accounts.loaded?`${accounts.parties.length} ${accounts.parties.length===1?'party':'parties'}`:'—'}</strong></button>
        <button data-hotkey="alt+2" aria-keyshortcuts="Alt+2" data-hotkey-label="Parties: to receive" type="button" data-tone="sale" aria-pressed={!searchTerm&&balanceTab==='receive'} onClick={()=>{setBalanceTab('receive');setPartySearch('');}}><span>To Receive</span><strong>{totalLabel(receiveTotal)}</strong></button>
        <button data-hotkey="alt+3" aria-keyshortcuts="Alt+3" data-hotkey-label="Parties: to pay" type="button" data-tone="purchase" aria-pressed={!searchTerm&&balanceTab==='pay'} onClick={()=>{setBalanceTab('pay');setPartySearch('');}}><span>To Pay</span><strong>{totalLabel(payTotal)}</strong></button>
      </div>
      {unavailableBalances.length>0&&<p className="error">Balances unavailable for {unavailableBalances.map(row=>row.party.name).join(', ')}. Correct their linked payments before using these totals.</p>}
      <div className="party-list-columns" aria-hidden="true"><span>Party name</span><span>Contact number</span><span>Amount</span></div>
      <ul className="party-balance-list">{visibleParties.map(({party:account,balance})=><li key={account.id}><button type="button" className="party-balance-row" onClick={()=>setSelected(account.id)}><strong>{account.name}{account.partyType&&<small>{PARTY_TYPES[account.partyType]}</small>}</strong><span className="party-phone">{account.phone||'No contact number'}</span><span data-tone={balance===null?'attention':balance===0?'inactive':balance<0?'purchase':'sale'} className={`party-amount ${balance<0?'pay':'receive'}`}>{balance===null?'Unavailable':money(Math.abs(balance))}{(searchTerm||balanceTab==='all')&&<small>{balance===null?'Check payments':balance>0?'To Receive':balance<0?'To Pay':'Settled'}</small>}<span aria-hidden="true"> ›</span></span></button></li>)}</ul>
      {accounts.loaded&&!visibleParties.length&&<div className="party-list-empty">{searchTerm?'No parties match this search.':!accounts.parties.length||balanceTab==='all'?'No parties yet. Add a party to get started.':balanceTab==='receive'?'No amounts to receive.':'No amounts to pay.'}</div>}
    </section>}
    {party&&<button type="button" data-hotkey="alt+b" aria-keyshortcuts="Alt+B" data-hotkey-label="Back to parties" className="outline party-back" onClick={()=>{setSelected('');setShowParty(false);}}>← Back to parties</button>}
    {party&&<>
      <div className="party-overview">
        <div className="party-detail-heading"><div><h2>{party.name}</h2><dl className="party-contact-details"><div><dt>Party type</dt><dd>{PARTY_TYPES[party.partyType]||'Unclassified'}</dd></div><div><dt>Contact number</dt><dd>{party.phone||'—'}</dd></div><div><dt>Address</dt><dd>{party.address||'—'}</dd></div></dl></div><div className="party-total"><span>Total balance</span><strong>{currentBalance===null?'Unavailable':money(Math.abs(currentBalance))}</strong><small>{currentBalance===null?'':currentBalance>0?'To Receive':currentBalance<0?'To Pay':'Settled'}</small></div></div>
        <div className="accounts-controls"><button data-hotkey="alt+e" aria-keyshortcuts="Alt+E" data-hotkey-label="Edit party" className="outline" disabled={blocked} onClick={()=>{setError('');setEditParty(party);setPartyForm({...newParty(),...party});setShowParty(true);}}>Edit contact details</button><button data-hotkey="alt+n" aria-keyshortcuts="Alt+N" data-hotkey-label="Record party payment" className="primary" disabled={blocked||paymentPending} onClick={()=>onPayment(party)}>Record Payment</button><button data-hotkey="alt+i" aria-keyshortcuts="Alt+I" data-hotkey-label="New party invoice / note" type="button" className="outline" disabled={blocked} onClick={createPartyInvoice}>New Invoice / Note</button><button data-hotkey="alt+p" aria-keyshortcuts="Alt+P" data-hotkey-label="Party statement" type="button" className="outline" aria-haspopup="dialog" onClick={()=>{setError('');setShowPrint(true);}} disabled={printing||preparingPrint}>Print Statement</button><RecordMenu label={party.name} actions={[{label:'Delete Party',disabled:!deletionEnabled||blocked||paymentPending,onClick:deleteParty}]}/></div>{!deletionEnabled&&<p className="help">Invoice and party deletion require Sheet backend 1.11.0 or newer. Update the script and refresh.</p>}
      </div>
      <section className="invoice-register party-invoices"><h3>Invoices</h3><p className="help">Click an invoice to open its details and create a credit/debit note.</p>{partyInvoices.map(inv=><article key={inv.id}><button type="button" className="invoice-open-row" data-tone={inv.status==='cancelled'?'inactive':inv.type} aria-haspopup="dialog" onClick={()=>{setError('');setInvoiceDetailId(inv.id);}}><div><strong>{inv.invoiceNumber}</strong><small>{inv.invoiceDate} · {inv.type==='sale'?'Sales invoice':'Purchase invoice'}</small><InvoiceCostBadge invoice={inv}/>{inv.cancelReason&&<small>Cancellation: {inv.cancelReason}</small>}</div><div className="party-invoice-amount"><strong>{money(inv.totalMinor)}</strong><small>{inv.status==='cancelled'?'Cancelled':inv._pending?'Pending upload':'Issued'}</small></div></button></article>)}{!partyInvoices.length&&<p>No invoices for this party yet.</p>}</section>{partyNotes.length>0&&<NotesRegister notes={partyNotes} range={['0000-01-01','9999-12-31']} onOpenNote={id=>{setNoteAction('');setNoteDetailId(id);}}/>}
      <section className="invoice-register party-transactions"><h3>Transactions</h3><p className="help">Payments linked to this party, newest first. Click to view, edit or print.</p>{relatedPayments.map(payment=><article key={payment.id}><button type="button" className="invoice-open-row" aria-haspopup="dialog" data-tone={payment.direction==='in'?'sale':'purchase'} onClick={()=>onTransaction?.(payment)}><div><strong>{payment.direction==='in'?'Payment received':'Payment made'}</strong><small>{payment.transactionDate} · {payment.transactionTime} · {payment.category} · {paymentMethodText(payment)}</small>{payment.notes&&<small>{payment.notes}</small>}</div><div className="party-invoice-amount"><strong>{payment.direction==='in'?'+':'−'}{money(payment.amountMinor)}</strong><small>{payment._status?'Pending upload':'Recorded'}</small>{Number(payment.settlementDiscountMinor)>0&&<small>Settlement discount: {money(payment.settlementDiscountMinor)}</small>}</div></button><button type="button" className="outline" disabled={!!payment._status||accounts.cached||!!accounts.pending||paymentPending} onClick={()=>onTransaction?.(payment,'share')}>Share transaction</button></article>)}{!relatedPayments.length&&<p>No transactions linked to this party yet.</p>}</section>
    </>}
    {showInvoiceForm&&<AccountDialog className="account-invoice-dialog" title={editingInvoice?`Edit invoice ${editingInvoice.invoiceNumber}`:`New ${{sale:'sales invoice',purchase:'purchase invoice',credit:'credit note',debit:'debit note'}[documentKind==='invoice'?invoice.type:documentKind]}`} busy={invoiceSaving} onClose={closeInvoiceForm}>
      {(error||accounts.error)&&<p className="error" role="alert">{error||accounts.error}</p>}
      {accounts.pending&&<p className="account-pending">Requests are saved on this device until confirmed.</p>}{editingInvoice&&accounts.pending?.action==='updateInvoice'&&<div className="account-pending"><button type="button" className="outline" disabled={accounts.busy} onClick={retryInvoiceEdit}>Retry invoice edit</button>{accounts.rejected&&<button type="button" className="outline" disabled={accounts.busy} onClick={discardInvoiceEdit}>Discard rejected edit and reload</button>}</div>}
      {documentKind!=='invoice'?<NoteEditor accounts={accounts} invoice={createNoteInvoice} draft={createNoteForm} enabled={notesEnabled} header={documentHeader} onDraftChange={setCreateNoteForm} onSaved={id=>{setShowInvoiceForm(false);setNoteAction('');setNoteDetailId(id);setCreateNoteForm(blankNoteForm());}}/>:<form className="account-form invoice-form" onSubmit={issue}><fieldset disabled={invoiceSaving||!accounts.canQueue}><div className="invoice-edit-content">{documentHeader}
    <div className="invoice-pos-layout"><div className="invoice-pos-items"><h3>Items</h3>{invoice.items.map((item,index)=><InvoiceItemEditor catalogue={catalogueEnabled?accounts.catalogue||[]:[]} key={index} item={item} index={index} type={invoice.type} itemDescriptionsEnabled={itemDescriptionsEnabled} measurementEnabled={measurementEnabled} onChange={updateInvoiceItem} onRemove={removeInvoiceItem} removeDisabled={invoice.items.length===1}/>)}
    <button type="button" className="outline" disabled={invoice.items.length>=50} onClick={addInvoiceItem}>＋ Add item <kbd>Alt + A</kbd></button><label>Invoice notes<textarea data-invoice-field="notes" maxLength="1000" value={invoice.notes} onChange={e=>update('notes',e.target.value)}/></label>
    </div></div><div className="invoice-global-discount"><label>Invoice discount<select aria-label="Discount type" disabled={!invoiceCheckoutEnabled} value={invoice.discountMode||'amount'} onChange={e=>setInvoice(old=>({...old,discountMode:e.target.value,discount:'0'}))}><option value="amount">Amount (₹)</option><option value="percent">Percentage (%)</option></select></label><label>{invoice.discountMode==='percent'?'Discount (%)':'Discount (₹)'}<input data-invoice-field="invoice-discount" aria-label="Invoice discount" type="number" min="0" max={invoice.discountMode==='percent'?100:undefined} step="0.01" disabled={!invoiceCheckoutEnabled} value={invoice.discount??'0'} onChange={e=>update('discount',e.target.value)}/></label></div><label className="invoice-round-off"><input type="checkbox" aria-label="Auto round-off" data-hotkey="alt+shift+b" aria-keyshortcuts="Alt+Shift+B" checked={Boolean(invoice.autoRoundOff)} disabled={!invoiceRoundingEnabled} onChange={e=>update('autoRoundOff',e.target.checked)}/> Auto round-off · nearest ₹1 <kbd>Alt + Shift + B</kbd>{!invoiceRoundingEnabled&&<small>Requires backend 1.25.0</small>}</label>{invoice.items.some(item=>Number(item.discount)>0)&&<p className="help">Existing item discounts are preserved. The invoice discount applies to the remaining subtotal.</p>} {invoice.type==='sale'&&<p className="draft-profit"><span>Gross profit</span><button type="button" aria-label={showDraftProfit?'Hide gross profit':'Show gross profit'} aria-pressed={showDraftProfit} onClick={()=>setShowDraftProfit(!showDraftProfit)}>{showDraftProfit?'◉ Hide':'◎ Show'}</button><strong>{showDraftProfit?(preview?.costTotalMinor==null?'Pending · enter CP for every item':money(preview.totalMinor-preview.costTotalMinor)):'••••'}</strong>{preview?.costTotalMinor===null&&<span className="profit-pending">Profit pending · CP missing</span>}</p>}
    <details className="invoice-shortcuts"><summary>Keyboard shortcuts & help</summary><p>Alt + 1 sale · 2 purchase · 3 credit · 4 debit · Q party · D date · H challan · A add item · J item · U quantity · B billing unit · L length · W width · F pieces · Z add size · R rate · C cost price · X discount · V notes · G profit · Ctrl + Enter save. Field shortcuts center the active field. Cost price and profit are never printed.</p></details>{editingInvoice?<button type="button" className="outline" onClick={closeInvoiceForm}>Cancel edit</button>:<button type="button" className="outline" onClick={()=>{if(window.confirm('Clear this invoice draft?')){setInvoice(freshInvoice());setPartyQuery('');setShowDraftProfit(false);}}}>Clear draft</button>}</div><aside className="invoice-submit-bar invoice-summary-panel" aria-label="Invoice summary"><h3>Bill summary</h3><InvoiceTotals invoice={preview}/>{!invoice.walkIn&&!editingInvoice&&<label className="invoice-payment-toggle"><input data-hotkey="alt+shift+p" aria-keyshortcuts="Alt+Shift+P" type="checkbox" aria-label="Record payment with invoice" checked={Boolean(invoice.paymentWithInvoice)} disabled={!partyInvoicePaymentEnabled} onChange={e=>setInvoice(old=>({...old,paymentWithInvoice:e.target.checked,checkout:blankCheckout()}))}/> Record payment with invoice · optional{!partyInvoicePaymentEnabled&&<small>Requires backend 1.20.0</small>}</label>}{(invoice.walkIn||!editingInvoice&&invoice.paymentWithInvoice||editingInvoice?.paymentId)&&<InvoicePaymentEntry splitEnabled={splitEnabled} invoice={preview} type={invoice.type} walkIn={Boolean(invoice.walkIn)} draft={invoice.checkout||blankCheckout()} editing={Boolean(editingInvoice)} onChange={checkout=>update('checkout',checkout)}/>}<div className="invoice-save-actions">{!editingInvoice&&<button type="submit" className="outline" data-save-new="true" data-hotkey="mod+shift+enter" aria-keyshortcuts="Control+Shift+Enter Meta+Shift+Enter" data-hotkey-label="Save invoice and start new">Save & New</button>}<button className="primary">{editingInvoice?invoiceSaving?'Saving changes…':'Save changes':invoice.walkIn||invoice.paymentWithInvoice?'Save invoice & payment':'Issue invoice'} <kbd>Ctrl + Enter</kbd></button></div></aside></fieldset></form>}
    </AccountDialog>}
    {party&&showPrint&&!ledgerShare&&<AccountDialog title="Print Statement" busy={preparingPrint||Boolean(printing)} onClose={()=>setShowPrint(false)}>
      <section className="party-statement-workspace">
      {(error||accounts.error)&&<p className="error" role="alert">{error||accounts.error}</p>}
      <div className="statement-controls">
        <fieldset className="statement-options" disabled={preparingPrint||printing}>
          <div className="account-fields"><label>From<input data-hotkey="alt+f" aria-keyshortcuts="Alt+F" data-hotkey-label="Statement start date" type="date" required value={range[0]} onChange={e=>setRange([e.target.value,range[1]])}/></label><label>To<input data-hotkey="alt+t" aria-keyshortcuts="Alt+T" data-hotkey-label="Statement end date" type="date" required min={range[0]} value={range[1]} onChange={e=>setRange([range[0],e.target.value])}/></label></div>
          <div className="statement-format-options" role="group" aria-label="Statement format"><button data-hotkey="alt+1" aria-keyshortcuts="Alt+1" data-hotkey-label="Ledger statement" type="button" aria-pressed={!detailed} onClick={()=>setDetailed(false)}><strong>Ledger Statement</strong><span>Invoice totals and payments</span></button><button data-hotkey="alt+2" aria-keyshortcuts="Alt+2" data-hotkey-label="Detailed ledger statement" type="button" aria-pressed={detailed} onClick={()=>setDetailed(true)}><strong>Detailed Ledger Statement</strong><span>Includes each invoice’s items</span></button></div>
          <button data-hotkey="alt+p" aria-keyshortcuts="Alt+P" data-hotkey-label="Print statement" className="primary" disabled={blocked||!!statementError||paymentPending} onClick={()=>printStatement()}>{preparingPrint?'Preparing statement…':detailed?'Print Detailed Ledger Statement':'Print Ledger Statement'}</button>
          <button type="button" data-hotkey="alt+s" aria-keyshortcuts="Alt+S" data-hotkey-label="Share statement" className="outline" disabled={blocked||!!statementError||paymentPending} onClick={()=>printStatement('share')}>Share statement</button>
        </fieldset>
        {paymentPending&&<p className="help">Wait for pending payments to finish uploading before printing.</p>}
      </div>
      {statementError?<p className="error">{statementError}</p>:<PartyStatement party={party} statement={statement} range={range} detailed={detailed} preferences={preferences} checkedAt={accounts.checkedAt}/>}
      </section>
    </AccountDialog>}
    {ledgerShare&&<AccountDialog title="Share ledger statement" onClose={()=>setLedgerShare(null)}><label>Message preview<textarea className="ledger-message-preview" aria-label="Ledger message preview" readOnly rows="10" value={statementMessage(ledgerShare,preferences)}/></label><DocumentShare title={`${ledgerShare.detailed?'Detailed ledger':'Ledger'} ${ledgerShare.party.name}`} message={statementMessage(ledgerShare,preferences)} imageDocument={ledgerImage}/></AccountDialog>}
    {invoiceDetail&&showInvoiceShare&&<AccountDialog title={`Share invoice ${invoiceDetail.invoiceNumber}`} onClose={()=>setShowInvoiceShare(false)}><InvoiceShare key={invoiceDetail.id} invoice={invoiceDetail} preferences={preferences} accounts={accounts} paymentPending={paymentPending}/></AccountDialog>}
    {invoiceDetail&&!showInvoiceShare&&<AccountDialog title={`Invoice ${invoiceDetail.invoiceNumber}`} busy={preparingPrint||Boolean(printing)} onClose={()=>setInvoiceDetailId('')}>
      {(error||accounts.error)&&<p className="error" role="alert">{error||accounts.error}</p>}
      {!invoiceDetail._pending&&<p className="help" role="status">{accounts.cached?'Saved snapshot':'Up to date'}</p>}{invoiceDetail._pending&&<p className="notice" role="status">Saved locally · Invoice number and printing available after sync.</p>}
      <div className="invoice-popup-actions">{invoiceDetail.status==='issued'&&<button data-hotkey="alt+e" aria-keyshortcuts="Alt+E" data-hotkey-label="Edit invoice" type="button" className="outline" disabled={!Array.isArray(invoiceDetail.items)||!invoiceEditingEnabled||invoiceEditProtected||blocked||preparingPrint||Boolean(printing)} onClick={editInvoice}>Edit Invoice</button>}{invoiceDetail.status==='issued'&&!invoiceDetail.walkIn&&<button data-hotkey="alt+n" aria-keyshortcuts="Alt+N" data-hotkey-label="Record payment" type="button" className="primary" disabled={blocked||paymentPending||preparingPrint||Boolean(printing)} onClick={payFromInvoice}>Record Payment</button>}<button data-hotkey="alt+s" aria-keyshortcuts="Alt+S" data-hotkey-label="Share invoice" type="button" className="outline" disabled={invoiceDetail._pending||invoiceDetail.status!=='issued'||!Array.isArray(invoiceDetail.items)||preparingPrint||Boolean(printing)} onClick={()=>setShowInvoiceShare(true)}>Share invoice</button><RecordMenu label={invoiceDetail.invoiceNumber} actions={[{label:'Print Invoice',shortcut:'alt+p',disabled:invoiceDetail._pending||blocked||preparingPrint||Boolean(printing),onClick:printInvoice},{label:'Delete Invoice',disabled:!deletionEnabled||invoiceDetail._pending||blocked||paymentPending||preparingPrint||Boolean(printing),onClick:()=>deleteInvoice(invoiceDetail)}]}/></div>
      {!deletionEnabled&&<p className="help">Delete Invoice requires Sheet backend 1.11.0 or newer. Update the script and refresh.</p>}{invoiceDetail.status==='issued'&&!invoiceEditingEnabled&&<p className="help">Invoice editing requires Sheet backend 1.9.0 or newer. Deploy the updated script, then refresh. <button type="button" className="outline" disabled={accounts.refreshing} onClick={()=>accounts.reload()}>{accounts.refreshing?'Checking backend…':'Check backend again'}</button></p>}{invoiceDetail.status==='issued'&&accounts.pending&&<p className="help">Finish or resolve the pending upload before editing this invoice.</p>}{invoiceDetail.status==='issued'&&<div className="invoice-corrections"><button data-hotkey="alt+c" aria-keyshortcuts="Alt+C" data-hotkey-label="Create credit / debit note" type="button" className="outline" disabled={!notesEnabled||blocked} onClick={()=>{setNoteAction('');setNoteDraft(null);setNoteInvoiceId(invoiceDetail.id);setInvoiceDetailId('');setNoteDetailId('');}}>Create credit / debit note</button><details className="invoice-shortcuts"><summary>About correction notes</summary><p className="help">Use a credit note for a return, discount or overcharge to reduce this invoice. Use a debit note for extra charges to increase it. Any refund/payment is recorded separately.</p></details>{!notesEnabled&&<p className="help">Correction notes require Sheet backend 1.10.0 or newer. Deploy the updated script, then refresh.</p>}{invoiceEditProtected&&<p className="help">Original invoice preserved because it has correction notes. Current value after active notes: {money(invoiceNetValue(invoiceDetail,accounts.notes))}. Use another note for further corrections, or delete the invoice and its notes from the active ledger.</p>}</div>}<InvoiceCostBadge invoice={invoiceDetail}/>{Array.isArray(invoiceDetail.items)?<InvoiceDocument key={invoiceDetail.id} invoice={invoiceDetail} preferences={preferences} notes={accounts.notes} transactions={accounts.transactions} paymentsConfirmed={!accounts.cached&&!accounts.refreshing&&!accounts.error&&!accounts.pending&&!paymentPending} profitControls/>:<div className="detail-loading" role="status">{detailLoading?'Loading invoice details…':detailError||'Invoice details are not loaded.'}{!detailLoading&&<button type="button" className="outline" onClick={async()=>{setDetailLoading(true);setDetailError('');try{await accounts.loadInvoiceDetails([invoiceDetail.id],{fresh:true});}catch(error){setDetailError(error.message);}finally{setDetailLoading(false);}}}>Retry loading invoice</button>}</div>}{invoiceHasNotes&&<NotesRegister notes={accounts.notes.filter(note=>note.invoiceId===invoiceDetail.id)} range={['0000-01-01','9999-12-31']} onOpenNote={id=>{setInvoiceDetailId('');setNoteAction('');setNoteDetailId(id);}}/>}
    </AccountDialog>}
    {(noteInvoice||noteDetailId)&&<InvoiceNotes key={`${noteInvoiceId||noteDetailId}:${noteOpenRequest?.request||''}:${noteAction}`} initialAction={noteAction} changesEnabled={noteChangesEnabled} accounts={accounts} invoice={noteInvoice} initialDraft={noteDraft} noteId={noteDetailId} preferences={preferences} enabled={notesEnabled} paymentPending={paymentPending} onPayment={onPayment} onClose={()=>{const id=noteInvoiceId;setNoteAction('');setNoteInvoiceId('');setNoteDetailId('');if(id)setInvoiceDetailId(id);}} onSaved={id=>{setNoteInvoiceId('');setNoteAction('');setNoteDetailId(id);}}/>}
    {printing&&createPortal(<div className="account-print-output">{printing==='statement'&&printSnapshot?<PartyStatement {...printSnapshot} preferences={preferences}/>:printing==='invoice'&&invoicePrintSnapshot?<InvoiceDocument invoice={invoicePrintSnapshot} preferences={preferences} notes={accounts.notes} transactions={invoicePrintSnapshot._printTransactions||[]} paymentsConfirmed/>:null}</div>,document.body)}
  </section>;
}
