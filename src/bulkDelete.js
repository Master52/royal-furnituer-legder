import {invoiceNoteRevision,invoiceNetValue,MAX_MINOR} from './accounts.js';

// Plan against a fresh snapshot, keeping every intermediate note balance valid.
export function planBulkDelete(selection,snapshot,reason){
  if(!reason?.trim()||reason.trim().length>500)throw new Error('Enter a deletion reason of at most 500 characters.');
  if(!selection.length||selection.length>100)throw new Error('Select between 1 and 100 records.');
  const selected=new Set(),invoiceIds=new Set(selection.filter(row=>row.kind==='invoice').map(row=>row.record.id));
  const operations=[],notes=[];
  for(const row of selection){
    const key=`${row.kind}:${row.record.id}`;if(selected.has(key))throw new Error('A record was selected twice.');selected.add(key);
    const collection={invoice:snapshot.invoices,note:snapshot.notes,payment:snapshot.transactions}[row.kind];
    const record=collection?.find(record=>record.id===row.record.id);
    if(!record||record.status==='deleted'||record.deletedAt||Number(record.revision||0)!==Number(row.record.revision||0))throw new Error('A selected record changed. Refresh History and select it again.');
    if(row.kind==='invoice'&&row.expectedNotes!==undefined&&row.expectedNotes!==invoiceNoteRevision(snapshot.notes,record.id))throw new Error('Invoice correction notes changed. Refresh History and select it again.');
    if(row.kind==='invoice')operations.push({action:'deleteInvoice',payload:{id:record.id,reason,_expectedRevision:Number(record.revision||0),_expectedNotes:invoiceNoteRevision(snapshot.notes,record.id)}});
    else if(row.kind==='note'){if(!invoiceIds.has(record.invoiceId))notes.push(record);}
    else if(row.kind==='payment')operations.push({action:'deletePayment',payload:{id:record.id,reason,_expectedRevision:Number(record.revision||0)}});
    else throw new Error('Unsupported record type.');
  }
  // Invoices first, so attached selected notes are covered by the existing cascade.
  operations.sort((a,b)=>Number(b.action==='deleteInvoice')-Number(a.action==='deleteInvoice'));
  let remaining=[...snapshot.notes];
  while(notes.length){
    const index=notes.findIndex(note=>{
      const invoice=snapshot.invoices.find(invoice=>invoice.id===note.invoiceId);if(!invoice||invoice.status!=='issued')return false;
      const next=remaining.filter(other=>other.id!==note.id),value=invoiceNetValue(invoice,next);if(value<0||value>MAX_MINOR)return false;
      const active=next.filter(other=>other.invoiceId===invoice.id&&other.status==='issued');
      if(invoice.costTotalMinor!=null&&invoice.costTotalMinor!==''&&active.every(other=>other.costAdjustmentMinor!=null&&other.costAdjustmentMinor!=='')){
        const cost=Number(invoice.costTotalMinor)+active.reduce((sum,other)=>sum+(other.type==='credit'?-1:1)*Number(other.costAdjustmentMinor),0);if(cost<0||cost>MAX_MINOR)return false;
      }return true;
    });
    if(index<0)throw new Error('These notes cannot be deleted in a safe order. Adjust dependent notes or select their original invoice.');
    const [note]=notes.splice(index,1);remaining=remaining.filter(other=>other.id!==note.id);
    operations.push({action:'deleteInvoiceNote',payload:{id:note.id,reason,_expectedRevision:Number(note.revision||0)}});
  }
  return operations;
}
