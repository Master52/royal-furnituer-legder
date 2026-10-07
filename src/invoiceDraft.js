import { blankInvoice, blankItem } from './accounts.js';
import {blankMeasurement} from './measurements.js';

export const invoiceDraftKey=endpoint=>`rf.invoiceDraft.${endpoint}`;
export function hasInvoiceDraft(draft){
  return Boolean(draft.partyId||draft.partyQuery?.trim()||draft.notes?.trim()||draft.challanNumber?.trim()||draft.type==='purchase'||draft.walkIn||draft.paymentWithInvoice||draft.autoRoundOff||Number(draft.discount||0)!==0||draft.items.some(item=>item.description.trim()||item.itemNote?.trim()||item.rate!==''||item.cost!==''||item.quantity!=='1'||item.discount!==''&&Number(item.discount)!==0||Boolean(item.billingUnit&&item.billingUnit!=='nos')||Boolean(item.measurements?.length)));
}
export function readInvoiceDraft(storage,endpoint){
  const key=invoiceDraftKey(endpoint);
  let raw;
  try{
    raw=storage.getItem(key);
    if(!raw)return {draft:blankInvoice(),error:''};
    const saved=JSON.parse(raw);
    if(!saved||typeof saved!=='object'||!Array.isArray(saved.items)||saved.items.length<1||saved.items.length>50)throw new Error('Invalid draft');
    const draft=blankInvoice();
    for(const field of ['partyId','partyQuery','type','invoiceDate','challanNumber','notes','discountMode','discount','paymentId']){
      if(saved[field]!=null&&typeof saved[field]!=='string')throw new Error('Invalid draft field');
      if(saved[field]!=null)draft[field]=saved[field];
    }
    if(saved.walkIn!=null&&typeof saved.walkIn!=='boolean')throw new Error('Invalid walk-in option');
    draft.walkIn=Boolean(saved.walkIn);
    if(saved.paymentWithInvoice!=null&&typeof saved.paymentWithInvoice!=='boolean')throw new Error('Invalid invoice payment option');
    draft.paymentWithInvoice=Boolean(saved.paymentWithInvoice);
    if(saved.autoRoundOff!=null&&typeof saved.autoRoundOff!=='boolean')throw new Error('Invalid round-off option');
    draft.autoRoundOff=Boolean(saved.autoRoundOff);
    if(!['amount','percent'].includes(draft.discountMode))throw new Error('Invalid discount mode');
    if(saved.checkout){for(const field of Object.keys(draft.checkout)){if(saved.checkout[field]!=null&&typeof saved.checkout[field]!=='string')throw new Error('Invalid checkout field');draft.checkout[field]=saved.checkout[field]||'';}}
    if(!['sale','purchase'].includes(draft.type))throw new Error('Invalid invoice type');
    draft.items=saved.items.map(savedItem=>{
      if(!savedItem||typeof savedItem!=='object')throw new Error('Invalid item');
      const item=blankItem();
      for(const field of Object.keys(item).filter(field=>field!=='measurements'&&field!=='grouped')){
        if(savedItem[field]!=null&&!['string','number'].includes(typeof savedItem[field]))throw new Error('Invalid item field');
        if(savedItem[field]!=null)item[field]=String(savedItem[field]);
      }
      if(!['','nos','sqft','rft','kg'].includes(item.billingUnit)||!['feet','inches',''].includes(item.measurementUnit)||!['quantity','dimensions','perimeter'].includes(item.measurementMode))throw new Error('Invalid measurement unit');
      if(savedItem.measurements!=null){if(!Array.isArray(savedItem.measurements)||savedItem.measurements.length>100)throw new Error('Invalid measurements');item.measurements=savedItem.measurements.map(row=>{if(!row||typeof row!=='object')throw new Error('Invalid size row');return Object.fromEntries(['description','length','width','quantity','pieces'].map(key=>{const value=row[key]??(key==='pieces'||key==='quantity'?'1':'');if(!['string','number'].includes(typeof value))throw new Error('Invalid size field');return [key,String(value)];}));});}
      if(savedItem.grouped!=null&&typeof savedItem.grouped!=='boolean')throw new Error('Invalid grouping option');
      item.grouped=Boolean(savedItem.grouped||item.measurements.length>1||(!['sqft','rft'].includes(item.billingUnit)&&item.measurements.length>0));
      if(item.grouped&&!item.billingUnit)item.billingUnit='nos';
      if((item.grouped||['sqft','rft'].includes(item.billingUnit))&&!item.measurements.length)item.measurements=[{...blankMeasurement(),quantity:item.quantity}];
      return item;
    });
    return {draft,error:''};
  }catch{
    // Preserve malformed data before the normal draft writer replaces it.
    try{if(raw)storage.setItem(`${key}.recovery`,raw);}catch{}
    return {draft:blankInvoice(),error:'The saved invoice draft could not be read. A recovery copy was kept where browser storage allowed it.'};
  }
}
