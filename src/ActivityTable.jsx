import React,{useEffect,useMemo,useState} from 'react';
import {activityRecords} from './activity.js';
import {invoiceNeedsCost} from './accounts.js';
import {paymentMethodText,money,transactionIntegrityIssue,duplicateTransactionIds} from './ledger.js';
import RecordMenu from './RecordMenu.jsx';

export default function ActivityTable({accounts,transactions,outbox,range,category='',method='',query='',history=false,printing=false,onOpen,onEdit,onDelete,onPrint,onHistory,editingEnabled,deletionEnabled,noteChangesEnabled,paymentBusy=false,bulkDeleteEnabled=false,onBulkDelete}){
  const [selected,setSelected]=useState(new Set()),[deleting,setDeleting]=useState(false);
  const [kind,setKind]=useState('all'),[page,setPage]=useState(0);
  const records=useMemo(()=>activityRecords({invoices:[...accounts.invoices,...accounts.pendingInvoices],notes:[...accounts.notes,...accounts.pendingNotes],transactions,outbox,range,category,method,query,kind}),[accounts.invoices,accounts.pendingInvoices,accounts.notes,accounts.pendingNotes,transactions,outbox,range,category,method,query,kind]);
  useEffect(()=>setPage(0),[range,category,method,query,kind,history]);
  const size=history?25:15,lastPage=Math.max(0,Math.ceil(records.length/size)-1),current=Math.min(page,lastPage);
  const visible=printing?records:records.slice(current*size,current*size+size);
  const duplicates=useMemo(()=>duplicateTransactionIds(transactions),[transactions]);
  const blocked=accounts.busy||!!accounts.pending;
  const selectionDisabled=!bulkDeleteEnabled||blocked||paymentBusy||deleting;
  const eligible=row=>!selectionDisabled&&!row.queued&&!row.record._pending&&!(row.kind==='payment'&&duplicates.has(row.record.id));
  const key=row=>`${row.kind}:${row.record.id}`;
  const selectedRows=records.filter(row=>selected.has(key(row)));
  const pageRows=visible.filter(eligible),checked=pageRows.length>0&&pageRows.every(row=>selected.has(key(row)));
  useEffect(()=>setSelected(new Set()),[range,category,method,query,kind,accounts.checkedAt]);
  function selectPage(){setSelected(old=>{const next=new Set(old);pageRows.forEach(row=>checked?next.delete(key(row)):next.add(key(row)));return next;});}
  async function removeSelected(){if(!selectedRows.length||selectionDisabled)return;setDeleting(true);try{if(await onBulkDelete(selectedRows))setSelected(new Set());}finally{setDeleting(false);}}

  return <section className="activity-section" aria-label={history?'History':'Recent activity'}>
    <div className="section-title"><div><h2>{history?'All activity':'Recent activity'}</h2><small>{history?'Invoices, payments and correction notes in date order':'Latest 15 records · selected period'}</small></div>{history?<label className="activity-kind">Record type<select data-hotkey="alt+t" aria-keyshortcuts="Alt+T" aria-label="Filter record type" value={kind} onChange={event=>setKind(event.target.value)}><option value="all">All records</option><option value="invoice">Invoices</option><option value="payment">Payments & exchanges</option><option value="credit">Credit notes</option><option value="debit">Debit notes</option></select></label>:<button className="outline" type="button" onClick={onHistory}>View all in History</button>}</div>
    {history&&<div className="bulk-selection-bar"><span>{selectedRows.length?`${selectedRows.length} selected`:'Select records to delete in bulk'}</span><div>{selectedRows.length>0&&<button type="button" className="outline" disabled={deleting} onClick={()=>setSelected(new Set())}>Clear selection</button>}<button type="button" className="outline bulk-delete-button" disabled={selectionDisabled||!selectedRows.length||selectedRows.length>100} onClick={removeSelected}>{deleting?'Preparing deletion…':`Delete selected (${selectedRows.length})`}</button></div>{!bulkDeleteEnabled&&<small>Bulk deletion requires backend 1.14.0 and no pending payment uploads.</small>}{selectedRows.length>100&&<small>Select at most 100 records per batch.</small>}</div>}
    <div className="activity-table-scroll"><table className="activity-table"><thead><tr>{history&&<th className="selection-column"><input type="checkbox" aria-label="Select all on this page" disabled={selectionDisabled||!pageRows.length} checked={checked} ref={node=>{if(node)node.indeterminate=!checked&&pageRows.some(row=>selected.has(key(row)));}} onChange={selectPage}/></th>}<th>Date</th><th>Party</th><th>Type</th><th>Reference</th><th>Amount</th><th>Status</th><th className="record-actions-column">Actions</th></tr></thead><tbody>{visible.map((row,index)=>{
      const invoice=row.kind==='invoice',note=row.kind==='note',payment=row.kind==='payment';
      const editDisabled=payment?paymentBusy||!!row.queued:blocked||row.record._pending||row.record.status!=='issued'||(invoice?(!editingEnabled||accounts.notedInvoiceIds?.has(row.record.id)):!noteChangesEnabled);
      const deleteDisabled=payment?paymentBusy||!!row.queued:blocked||row.record._pending||(invoice?!deletionEnabled:!noteChangesEnabled);
      const tone=row.status==='Cancelled'?'inactive':payment?(row.record.direction==='in'?'received':row.record.direction==='out'?'paid':'inactive'):row.category==='Sale'?'sale':'purchase';
      const issue=payment&&(duplicates.has(row.record.id)?'Duplicate record ID. Repair the Sheet before editing or using totals.':transactionIntegrityIssue(row.record));
      return <tr data-record-kind={row.kind} data-record-id={row.record.id} key={`${row.kind}:${row.record.id}:${index}`} className={`activity-row ${issue?'invalid-row':''}`} onKeyDown={event=>{
        if(event.defaultPrevented||event.repeat||event.isComposing||event.getModifierState?.('AltGraph')||!event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
        const key=event.key.toLowerCase();
        if(key==='e'&&!editDisabled){event.preventDefault();onEdit(row);}
        else if(key==='p'&&!issue&&!row.record._pending&&!row.queued&&!blocked&&!paymentBusy){event.preventDefault();onPrint(row);}
        else if(key==='m'){event.preventDefault();const menu=event.currentTarget.querySelector('details.record-menu');menu?.setAttribute('open','');menu?.querySelector('button:not(:disabled)')?.focus();}
      }} onClick={event=>{if(event.target.closest('button,summary,details,a,input'))return;onOpen(row);}}>
        {history&&<td className="selection-column"><input type="checkbox" aria-label={`Select ${row.type} ${row.reference}`} disabled={!eligible(row)} checked={selected.has(key(row))} onChange={()=>setSelected(old=>{const next=new Set(old);next.has(key(row))?next.delete(key(row)):next.add(key(row));return next;})}/></td>}<td className="activity-date">{row.date}<small>{row.time.slice(0,5)}</small></td><td className="activity-party"><strong>{row.party||'—'}</strong>{issue&&<small className="error">{issue}</small>}</td><td className="activity-type"><span data-tone={tone} className={`record-type record-type-${row.kind}`}>{row.type}</span><small>{row.category}{payment?` · ${paymentMethodText(row.record)}`:''}</small></td><td className="activity-reference"><button type="button" className="activity-open" aria-label={`View ${row.type} ${row.reference}`} onClick={()=>onOpen(row)}>{payment?'View payment':row.reference||'Awaiting number'}</button>{invoice&&row.record.challanNumber&&<small>Challan: {row.record.challanNumber}</small>}{note&&<small>{row.record.invoiceNumber}</small>}</td><td data-tone={tone} className="activity-amount">{money(row.amount)}</td><td className="activity-status"><span data-tone={row.status==='Synced'?'received':row.status==='Cancelled'?'inactive':row.status==='Upload failed'?'paid':'attention'} className={`record-status ${row.status==='Synced'?'synced':row.status==='Cancelled'?'inactive':row.status==='Upload failed'?'failed':'pending'}`}>{row.status}</span>{invoice&&invoiceNeedsCost(row.record)&&<small className="profit-pending">Profit pending · CP missing</small>}</td><td className="activity-actions"><div className="record-row-actions"><button type="button" className="outline" disabled={editDisabled} title={invoice&&accounts.notedInvoiceIds?.has(row.record.id)?'This invoice has correction notes. Edit its notes instead.':undefined} aria-label={`Edit ${row.type} ${row.reference}`} onClick={()=>onEdit(row)}>Edit</button><RecordMenu label={`${row.type} ${row.reference}`} actions={[{label:'Print',disabled:!!issue||!!row.record._pending||!!row.queued||blocked||paymentBusy,onClick:()=>onPrint(row)},{label:'Delete',disabled:deleteDisabled,onClick:()=>onDelete(row)}]}/></div></td>
      </tr>;
    })}</tbody></table></div>
    {!visible.length&&<div className="empty"><h3>No matching records</h3><p>Change the period or clear your filters.</p></div>}
    <div className="activity-footer"><span>{records.length?`${current*size+1}–${Math.min((current+1)*size,records.length)} of ${records.length} records`:'0 records'} · Amounts in INR</span>{history&&records.length>size&&<div><button data-hotkey="alt+arrowleft" aria-keyshortcuts="Alt+ArrowLeft" data-hotkey-label="Previous page" type="button" className="outline" disabled={current===0} onClick={()=>setPage(current-1)}>Previous</button><span>Page {current+1} of {lastPage+1}</span><button data-hotkey="alt+arrowright" aria-keyshortcuts="Alt+ArrowRight" data-hotkey-label="Next page" type="button" className="outline" disabled={current===lastPage} onClick={()=>setPage(current+1)}>Next</button></div>}</div>
  </section>;
}
