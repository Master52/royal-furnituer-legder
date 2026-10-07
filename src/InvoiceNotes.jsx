import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import DocumentShare from './DocumentShare.jsx';
import {noteMessage,receiptImageDocument} from './documentLayout.js';
import DocumentTypeSelector from './DocumentTypeSelector.jsx';
import RecordMenu from './RecordMenu.jsx';
import AccountDialog from './AccountDialog.jsx';
import {focusAndCenter} from './entry.js';
import {historyNotes,invoiceNetValue,makeInvoiceNote,blankNoteForm,noteDraftFromRecord} from './accounts.js';
import {money} from './ledger.js';
export function NotesRegister({notes,range,category='',query='',onOpenNote,onEditNote,onDeleteNote,changesEnabled=false,busy=false,title='Credit & debit notes'}){
  const visible=historyNotes(notes,...range,category,query);
  return <details className="invoice-history notes-register" open><summary>{title} ({visible.length})</summary><div className="invoice-dashboard-list"><div>{visible.map(note=><article className="history-record" data-tone={note.status==='cancelled'?'inactive':note.invoiceType} key={note.id}><button className="history-record-open" type="button" onClick={()=>onOpenNote(note.id)}><span><strong>{note.noteNumber}</strong><small>{note.partyName} · {note.noteDate} · {note.type==='credit'?'Credit':'Debit'} · {note.invoiceNumber} · {note._pending?'Uploading':note.status}</small></span><strong>{money(note.amountMinor)}</strong></button>{onEditNote&&<div className="history-record-actions"><button type="button" disabled={!changesEnabled||busy||note._pending||note.status!=='issued'} onClick={()=>onEditNote(note.id)}>Edit</button><button type="button" disabled={!changesEnabled||busy||note._pending} onClick={()=>onDeleteNote(note.id)}>Delete</button></div>}</article>)}{!visible.length&&<p>No correction notes match this period and filters.</p>}</div></div></details>;
}
export function NoteDocument({note,preferences}){
  return <section className="invoice-document note-document"><header className="invoice-document-header"><div><h1>{preferences.shopName}</h1>{preferences.printContact&&<p>{preferences.address}<br/>{preferences.phone}</p>}</div><div><h2>{note.type==='credit'?'Credit note':'Debit note'}</h2><strong>{note.noteNumber}</strong><p>Date: {note.noteDate}</p></div></header>{note.status==='cancelled'&&<div className="invoice-cancelled"><strong>CANCELLED</strong><p>{note.cancelReason}</p></div>}<section className="invoice-party"><h3>{note.partyName}</h3>{note.partyPhone&&<p>{note.partyPhone}</p>}{note.partyAddress&&<p>{note.partyAddress}</p>}</section><p>Original {note.invoiceType==='sale'?'sales':'purchase'} invoice: <strong>{note.invoiceNumber}</strong></p><p>{note.type==='credit'?'Reduces':'Increases'} the invoice value.</p><p className="note-reason">Reason: {note.reason}</p><dl className="invoice-document-totals"><div className="invoice-grand-total"><dt>Correction amount</dt><dd>{money(note.amountMinor)}</dd></div></dl><p className="help">Amounts in INR · This note adjusts the party ledger. Any refund or additional payment is recorded separately.</p></section>;
}
export function NoteEditor({accounts,invoice,initialForm,draft,editingNote,enabled,header,onSaved,onDraftChange}){
  const [localForm,setLocalForm]=useState(()=>initialForm||blankNoteForm());
  const form=draft||localForm;
  const [error,setError]=useState(''),[saving,setSaving]=useState(false);
  const formRef=useRef(null),lock=useRef(false);
  useEffect(()=>{if(!draft)onDraftChange?.(localForm);},[localForm]);
  const update=(key,value)=>{if(draft)onDraftChange({...draft,[key]:value});else setLocalForm(old=>({...old,[key]:value}));};
  const unavailable=!accounts.loaded?(accounts.error?'Invoice records could not be loaded. Check the connection and retry.':'Loading invoice records…'):!enabled?`Correction ${editingNote?'editing requires backend 1.12.0':'creation requires backend 1.10.0'} or newer. Update the Apps Script deployment, then check again.`:!accounts.canQueue&&!editingNote?'Close this popup and resolve the pending upload in Sync status before saving a correction.':!invoice?'Select an issued original invoice for this party to enable Save. Credit/debit notes correct an existing invoice.':'';
  useEffect(()=>{
    const handler=event=>{
      const root=formRef.current;if(event.defaultPrevented||!root||!root.closest('dialog')?.open||root.querySelector(':scope > fieldset:disabled')||event.repeat||event.isComposing||event.getModifierState?.('AltGraph'))return;
      const key=event.key.toLowerCase();
      if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&key==='enter'){event.preventDefault();root.requestSubmit();return;}
      if(!event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
      if(['3','4'].includes(key)){const button=root.querySelector(`[data-note-type=${key==='3'?'credit':'debit'}]`);if(button&&!button.matches(':disabled')){event.preventDefault();button.click();}return;}
      if(['e','c'].includes(key))root.querySelector('.note-cost-options')?.setAttribute('open','');
      const field={m:'amount',r:'reason',d:'date',e:'effect',c:'cost',i:'invoice',q:'party',t:'type'}[key];
      const element=field==='party'?root.querySelector('[name=invoice-party]'):root.querySelector(`[data-note-field="${field}"]`);
      if(element){event.preventDefault();focusAndCenter(element);}
    };window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  },[]);
  async function save(event){
    event.preventDefault();if(lock.current||!enabled||!invoice||!accounts.loaded||(editingNote?accounts.busy||!!accounts.pending:!accounts.canQueue))return;lock.current=true;setSaving(true);setError('');
    try{
      const payload=makeInvoiceNote(form,invoice,editingNote?.id);
      const other=accounts.notes.filter(note=>note.id!==editingNote?.id);
      if(invoiceNetValue(invoice,other)+(payload.type==='credit'?-1:1)*payload.amountMinor<0)throw new Error('Credit amount exceeds the invoice value remaining after previous notes.');
      if(!window.confirm(`${editingNote?'Update':'Save'} this ${payload.type} note for ${money(payload.amountMinor)}?`))return;
      if(editingNote){Object.assign(payload,{_expectedRevision:Number(editingNote.revision||0),_editId:crypto.randomUUID()});if(await accounts.save('updateInvoiceNote',payload))onSaved(payload.id);}
      else if(await accounts.queueNote(payload))onSaved(payload.id);else setError('');
    }catch(error){setError(error.message);}finally{lock.current=false;setSaving(false);}
  }
  return <><form ref={formRef} className="account-form invoice-form" onSubmit={save}><fieldset disabled={saving||(editingNote&&(accounts.busy||!!accounts.pending))}><div className="invoice-edit-content">
    {header||<><p><strong>{invoice?.invoiceNumber}</strong> · {invoice?.partyName}</p><DocumentTypeSelector invoiceType={invoice?.type} notesOnly disabled={Boolean(editingNote)} value={form.type} onChange={type=>update('type',type)}/></>}
    {invoice?<p className="help">Current invoice value: {money(invoiceNetValue(invoice,accounts.notes))} · {form.type==='credit'?'Reduces':'Increases'} invoice value.</p>:<p className="help">Select the original invoice to correct. Create an invoice first if this party has none.</p>}
    <div className="account-fields"><label>Note date<input data-note-field="date" type="date" required min={invoice?.invoiceDate} value={form.noteDate} onChange={e=>update('noteDate',e.target.value)}/></label><label>Amount (₹)<input data-note-field="amount" name="note-amount" type="number" min="0.01" step="0.01" required value={form.amount} onChange={e=>update('amount',e.target.value)}/></label><label>Reason<textarea data-note-field="reason" aria-label="Reason" required maxLength="1000" value={form.reason} onChange={e=>update('reason',e.target.value)}/></label></div>
    {invoice?.type==='sale'&&<details className="note-cost-options invoice-shortcuts"><summary>Cost correction (optional)</summary><label>Cost treatment<select data-note-field="effect" value={form.effect} onChange={e=>update('effect',e.target.value)}><option value="price">Price correction · costs unchanged</option><option value="return">Goods/cost correction</option></select></label>{form.effect==='return'&&<label>{form.type==='credit'?'Cost reversed (₹)':'Additional cost (₹)'}<input data-note-field="cost" type="number" min="0" step="0.01" value={form.cost} onChange={e=>update('cost',e.target.value)}/><small>Optional. Blank leaves profit incomplete.</small></label>}</details>}
    <small className="help">Saving a note adjusts the ledger; record money separately.</small><details className="invoice-shortcuts"><summary>Keyboard shortcuts</summary><p>Alt + M amount · R reason · D date · E cost treatment · C cost · I original invoice · Q party · Ctrl + Enter save. Each field shortcut scrolls the field to the center.</p></details>
    </div>{unavailable&&<p className="notice" role="status">{unavailable}</p>}<div className="invoice-submit-bar"><button className="primary" disabled={!invoice||!enabled||!accounts.loaded||(editingNote?accounts.busy||!!accounts.pending:!accounts.canQueue)}>{saving?(editingNote?'Saving changes…':'Saving on this device…'):editingNote?'Save note changes':'Save correction note'}</button></div></fieldset>{(!enabled||!accounts.loaded)&&<button type="button" className="outline" disabled={accounts.refreshing} onClick={()=>accounts.reload({fresh:true})}>{accounts.refreshing?'Checking backend…':'Check backend again'}</button>}</form>{(error||!header&&accounts.error)&&<p className="error" role="alert">{error||accounts.error}</p>}
    {editingNote&&accounts.pending?.action==='updateInvoiceNote'&&<div className="account-pending"><button type="button" disabled={accounts.busy} onClick={async()=>{if(await accounts.retry())onSaved(editingNote.id);}}>Retry note edit</button>{accounts.rejected&&<button type="button" disabled={accounts.busy} onClick={async()=>{if(window.confirm('Discard this rejected note edit?')&&await accounts.discardRejected())onSaved(editingNote.id);}}>Discard rejected edit</button>}</div>}
  </>;
}
export default function InvoiceNotes({accounts,invoice,initialDraft,noteId,initialAction,preferences,enabled,changesEnabled=false,paymentPending,onPayment,onClose,onSaved}){
  const [error,setError]=useState(''),[saving,setSaving]=useState(false),[printing,setPrinting]=useState(false),[printSnapshot,setPrintSnapshot]=useState(null),[editing,setEditing]=useState(initialAction==='edit');
  const requested=useRef(false),draft=useRef(initialDraft?noteDraftFromRecord(initialDraft):blankNoteForm());
  const note=accounts.notes.find(note=>note.id===noteId)||accounts.pendingNotes.find(note=>note.id===noteId);
  const [sharing,setSharing]=useState(false);
  const balance=accounts.partyBalances.find(row=>row.party.id===note?.partyId)?.balance??null;
  const shareMessage=useMemo(()=>note?noteMessage(note,preferences,balance):'',[note,preferences,balance]);
  const imageDocument=useMemo(()=>note?receiptImageDocument(note.type==='credit'?'Credit note':'Debit note',note,preferences,shareMessage):null,[note,preferences,shareMessage]);
  const original=invoice||accounts.invoices.find(invoice=>invoice.id===note?.invoiceId);
  const blocked=accounts.busy||!!accounts.pending||!accounts.loaded;
  useEffect(()=>{if(note&&!blocked&&!requested.current&&['delete','print'].includes(initialAction)){requested.current=true;if(initialAction==='delete')remove();else print();}},[initialAction,note,blocked]);
  useEffect(()=>{const done=()=>{if(document.body.dataset.accountPrint==='note')delete document.body.dataset.accountPrint;setPrinting(false);};window.addEventListener('afterprint',done);return()=>{window.removeEventListener('afterprint',done);if(document.body.dataset.accountPrint==='note')delete document.body.dataset.accountPrint;};},[]);
  useEffect(()=>{if(!printing)return;document.body.dataset.accountPrint='note';const timer=setTimeout(()=>window.print(),0);return()=>clearTimeout(timer);},[printing]);
  useEffect(()=>{if(!invoice&&!editing)return;const warn=event=>{if(!draft.current.amount&&!draft.current.reason)return;event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[invoice,editing]);
  function payment(){const party=accounts.parties.find(party=>party.id===note?.partyId);if(!party)return;if(onPayment(party))onClose();}
  async function remove(){
    if(blocked||!note||!changesEnabled||note._pending)return;
    const reason=window.prompt(`Delete ${note.noteNumber} from the active ledger? Its effect on the party balance will be reversed. Enter a reason:`);if(!reason?.trim())return;
    setSaving(true);setError('');try{if(await accounts.save('deleteInvoiceNote',{id:note.id,reason:reason.trim(),_expectedRevision:Number(note.revision||0)}))onClose();}catch(error){setError(error.message);}finally{setSaving(false);}
  }
  async function cancel(){if(blocked||!note)return;const reason=window.prompt(`Cancel ${note.noteNumber}? Its effect on the party balance will be reversed. Enter a reason:`);if(!reason?.trim())return;setSaving(true);setError('');try{await accounts.save('cancelInvoiceNote',{id:note.id,reason:reason.trim(),_expectedRevision:Number(note.revision||0)});}catch(error){setError(error.message);}finally{setSaving(false);}}
  async function print(){if(blocked||paymentPending||!note)return;setSaving(true);setError('');try{const fresh=await accounts.reload({fresh:true});const record=fresh?.notes?.find(row=>row.id===note.id);if(!record)throw new Error('Refresh and confirm the note before printing.');setPrintSnapshot(record);setPrinting(true);}catch(error){setError(error.message);}finally{setSaving(false);}}
  const close=()=>{if(saving||printing||accounts.busy)return;if((invoice||editing)&&!accounts.pending&&(draft.current.amount||draft.current.reason)&&!window.confirm('Discard this unsaved correction note?'))return;onClose();};
  return <>{(invoice||editing&&note)?<AccountDialog className="invoice-note-dialog account-invoice-dialog" title={editing?'Edit correction note':'Create correction note'} busy={saving||accounts.busy} initialFocus="input[name=note-amount]" onClose={close}>
    <NoteEditor accounts={accounts} invoice={original} initialForm={editing?noteDraftFromRecord(note):draft.current} editingNote={editing?note:null} enabled={editing?changesEnabled:enabled} onDraftChange={form=>{draft.current=form;}} onSaved={id=>{setEditing(false);onSaved(id);}}/>
  </AccountDialog>:note?<AccountDialog className="invoice-note-dialog" title={`${note.type==='credit'?'Credit':'Debit'} note ${note.noteNumber}`} busy={saving||printing} onClose={close}>
    {(error||accounts.error)&&<p className="error" role="alert">{error||accounts.error}</p>}
    <p className={note._pending?'notice':'help'} role="status">{note._pending?'Saved locally · syncing':accounts.cached?'Saved snapshot':'Up to date'}</p><div className="invoice-popup-actions">{note.status==='issued'&&<><button data-hotkey="alt+e" aria-keyshortcuts="Alt+E" data-hotkey-label="Edit note" type="button" className="outline" disabled={!changesEnabled||blocked||saving||note._pending} onClick={()=>{draft.current=noteDraftFromRecord(note);setEditing(true);}}>Edit note</button><button data-hotkey="alt+n" aria-keyshortcuts="Alt+N" data-hotkey-label="Record party payment" type="button" className="primary" disabled={blocked||paymentPending||saving} onClick={payment}>Record Payment</button></>}<button type="button" className="outline" data-hotkey="alt+s" disabled={blocked||paymentPending||accounts.cached||!!accounts.error||note._pending} onClick={()=>setSharing(value=>!value)}>Share note</button><RecordMenu label={note.noteNumber} actions={[{label:'Print note',shortcut:'alt+p',disabled:blocked||paymentPending||saving||note._pending,onClick:print},{label:'Cancel note',disabled:note.status!=='issued'||blocked||saving||!enabled,onClick:cancel},{label:'Delete note',disabled:!changesEnabled||blocked||saving||note._pending,onClick:remove}]}/></div>{!changesEnabled&&<p className="help">Note editing and deletion require Sheet backend 1.12.0 or newer. Update the script and refresh.</p>}{sharing&&<DocumentShare title={note.noteNumber} message={shareMessage} imageDocument={imageDocument} disabled={blocked||paymentPending||accounts.cached||!!accounts.error||note._pending}/>}<NoteDocument note={note} preferences={preferences}/>
  </AccountDialog>:null}{printing&&printSnapshot&&createPortal(<div className="account-print-output"><NoteDocument note={printSnapshot} preferences={preferences}/></div>,document.body)}</>;
}
