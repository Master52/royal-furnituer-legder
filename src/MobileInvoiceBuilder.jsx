import {useActionDialog} from './ActionDialogProvider.jsx';
import PurchaseAmountFields from './PurchaseAmountFields.jsx';
import React,{useEffect,useRef,useState} from 'react';
import InvoiceItemEditor from './InvoiceItemEditor.jsx';
import {blankItem,validDate} from './accounts.js';
import {money} from './ledger.js';
import {mobileItemPreview,untouchedMobileItem} from './mobileInvoice.js';
import './mobileInvoice.css';
export default function MobileInvoiceBuilder({invoice,preview,partyName,header,options,summary,update,onSubmit,onChangeItem,onRemoveItem,onAddItem,catalogue,measurementEnabled,itemDescriptionsEnabled,editing,busy}){
 const {confirmAction}=useActionDialog();
 const [step,setStep]=useState(editing||invoice.partyId||invoice.walkIn?'items':'customer'),[editorIndex,setEditorIndex]=useState(null),[error,setError]=useState('');
 const bodyRef=useRef(null),sheetRef=useRef(null),addRef=useRef(null),previous=useRef(invoice);
 const editorItem=editorIndex===null?null:invoice.items[editorIndex];
 const hasItems=invoice.amountOnly?Boolean(invoice.purchaseAmount):invoice.items.some(item=>!untouchedMobileItem(item));
 useEffect(()=>{if(previous.current!==invoice&&step==='review'&&!hasItems){setStep('customer');setEditorIndex(null);setError('');}previous.current=invoice;},[invoice,hasItems,step]);
 useEffect(()=>{bodyRef.current?.scrollTo({top:0});},[step]);
 useEffect(()=>{if(editorIndex===null)return;const timer=setTimeout(()=>sheetRef.current?.querySelector('[data-invoice-field=description]')?.focus(),0);return()=>clearTimeout(timer);},[editorIndex]);
 function closeItem(){setEditorIndex(null);setError('');requestAnimationFrame(()=>addRef.current?.focus());}
 function openItem(index){setError('');setEditorIndex(index);}
 function addItem(){const blank=invoice.items.findIndex(untouchedMobileItem);if(blank!==-1){openItem(blank);return;}if(invoice.items.length>=50)return;onAddItem();openItem(invoice.items.length);}
 async function removeItem(index){if(!await confirmAction(`Remove ${invoice.items[index].description||'this unfinished item'} from the invoice?`))return;if(invoice.items.length===1)onChangeItem(0,{...blankItem(),billingUnit:measurementEnabled?'nos':''});else onRemoveItem(index);}
 function saveItem(next=false){
  try{mobileItemPreview(editorItem,invoice.type);setError('');if(next&&invoice.items.length<50){onAddItem();setEditorIndex(invoice.items.length);}else closeItem();}catch(cause){setError(cause.message);}
 }
 function goItems(){if(!invoice.walkIn&&!invoice.partyId){setError('Select a customer or choose Walk-in / CASH SALE.');return;}if(!validDate(invoice.invoiceDate)){setError('Choose a valid invoice date.');return;}setError('');setStep('items');}
 function review(){
  if(!invoice.walkIn&&!invoice.partyId){setStep('customer');setError('Select a customer.');return;}
  for(let index=0;!invoice.amountOnly&&index<invoice.items.length;index++){try{mobileItemPreview(invoice.items[index],invoice.type);}catch(cause){setError(cause.message);setEditorIndex(index);return;}}
  setError(preview?'':'Check the total and discount. The invoice must have a positive total.');setStep('review');
 }
 function submit(event){if(editorItem){event.preventDefault();saveItem();return;}if(step!=='review'){event.preventDefault();step==='customer'?goItems():review();return;}onSubmit(event);}
 function sheetKeys(event){
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeItem();return;}
  if(event.key==='Tab'){const controls=[...sheetRef.current.querySelectorAll('button,input,select,textarea,summary')].filter(el=>!el.disabled&&el.getClientRects().length);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
 }
 return <form className="account-form invoice-form mobile-invoice-builder" onSubmit={submit} noValidate onInvalidCapture={event=>{const details=event.target.closest('details');if(details)details.open=true;}}>
  <fieldset disabled={busy}>
   <div className="mobile-invoice-main" inert={Boolean(editorItem)}>
    <nav className="mobile-bill-steps" aria-label="Invoice entry steps"><button type="button" aria-current={step==='customer'?'step':undefined} onClick={()=>setStep('customer')}>1 Customer</button><button type="button" aria-current={step==='items'?'step':undefined} onClick={goItems}>2 Items</button><button type="button" aria-current={step==='review'?'step':undefined} onClick={review}>3 Review</button></nav>
    <div className="mobile-bill-body" ref={bodyRef}>
     {error&&!editorItem&&<p className="error" role="alert">{error}</p>}
     {step==='customer'?<section className="mobile-customer-entry"><h3>Who is this bill for?</h3>{header}</section>:<>
      <div className="mobile-bill-customer"><div><strong>{invoice.walkIn?'CASH SALE':partyName||'Choose customer'}</strong><small>{invoice.type==='purchase'?'Purchase':'Sale'} · {invoice.invoiceDate}</small></div><button type="button" className="outline" onClick={()=>setStep('customer')}>Change</button></div>
      <div className="mobile-bill-items-heading"><h3>{step==='review'?'Review your items':'Items in this bill'}</h3><span>{hasItems?invoice.items.length:0} items</span></div>
      <PurchaseAmountFields invoice={invoice} onChange={update}/>{!invoice.amountOnly&&(hasItems?<div className="mobile-bill-items">{invoice.items.map((item,index)=>{let value;try{value=mobileItemPreview(item,invoice.type);}catch{/* The card links back to the incomplete entry. */}return <article className="mobile-bill-item" key={index}><button type="button" className="mobile-bill-item-open" aria-label={`Edit item ${index+1} ${item.description||'unfinished'}`} onClick={()=>{setStep('items');openItem(index);}}><div><strong>{item.description||'Unfinished item'}</strong><small>{value?`${value.quantityText} × ${money(Math.round(Number(item.rate)*100))}`:'Complete this item'}</small>{item.measurements?.length>0&&<small>{item.measurements.length} size {item.measurements.length===1?'row':'rows'}</small>}</div><strong>{value?money(value.amountMinor):'—'}</strong></button><div className="mobile-bill-item-actions"><button type="button" onClick={()=>{setStep('items');openItem(index);}}>Edit</button><button type="button" aria-label={`Remove item ${index+1}`} onClick={()=>removeItem(index)}>Remove</button></div></article>;})}</div>:<div className="mobile-bill-empty"><span aria-hidden="true">＋</span><h3>Add your first item</h3><p>Search your catalogue or enter an item name.</p></div>)}
      {step==='items'?(invoice.amountOnly?null:<button ref={addRef} type="button" className="mobile-bill-add" disabled={invoice.items.length>=50&&!invoice.items.some(untouchedMobileItem)} onClick={addItem}>＋ Add item</button>):<section className="mobile-bill-review"><h3>Discount & payment</h3><label>Invoice notes<textarea data-invoice-field="notes" maxLength="1000" value={invoice.notes} onChange={event=>update('notes',event.target.value)}/></label>{options}{summary}</section>}
     </>}
    </div>
    <footer className="mobile-bill-footer"><div><small>{step==='customer'?'Customer details':`${hasItems?invoice.items.length:0} items · Total`}</small><strong>{step==='customer'?'Start your bill':preview?money(preview.totalMinor):'Complete items'}</strong></div>{step==='customer'?<button key="continue" type="button" className="primary" onClick={event=>{event.preventDefault();goItems();}}>Continue →</button>:step==='items'?<button key="review" type="button" className="primary" disabled={!hasItems} onClick={event=>{event.preventDefault();review();}}>Review bill →</button>:<button key="save" type="submit" className="primary" disabled={!preview}>{editing?'Save changes':invoice.walkIn||invoice.paymentWithInvoice?'Save invoice & payment':'Issue invoice'}</button>}</footer>
   </div>
   {editorItem&&<div className="mobile-item-overlay"><section ref={sheetRef} className="mobile-item-sheet" role="dialog" aria-modal="true" aria-label={`Edit invoice item ${editorIndex+1}`} onKeyDown={sheetKeys}><div className="mobile-item-sheet-heading"><div><span>ITEM {editorIndex+1}</span><h3>{editorItem.description||'Add an item'}</h3></div><button type="button" className="outline" onClick={closeItem}>Back to bill</button></div><div className="mobile-item-sheet-body"><InvoiceItemEditor compact catalogue={catalogue} item={editorItem} index={editorIndex} type={invoice.type} itemDescriptionsEnabled={itemDescriptionsEnabled} measurementEnabled={measurementEnabled} onChange={onChangeItem} onRemove={onRemoveItem} removeDisabled={invoice.items.length===1}/>{error&&<p className="error" role="alert">{error}</p>}</div><div className="mobile-item-sheet-actions"><button type="button" className="outline" onClick={()=>saveItem()}>Done</button><button type="button" className="primary" disabled={invoice.items.length>=50} onClick={()=>saveItem(true)}>Add & next</button></div></section></div>}
  </fieldset>
 </form>;
}
