import { blankInvoice, blankItem } from './accounts.js';

export const invoiceDraftKey=endpoint=>`rf.invoiceDraft.${endpoint}`;
export function hasInvoiceDraft(draft){
  return Boolean(draft.partyId||draft.partyQuery?.trim()||draft.notes?.trim()||draft.type==='purchase'||draft.items.some(item=>item.description.trim()||item.rate!==''||item.cost!==''||item.quantity!=='1'||item.discount!==''&&Number(item.discount)!==0));
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
    for(const field of ['partyId','partyQuery','type','invoiceDate','notes']){
      if(saved[field]!=null&&typeof saved[field]!=='string')throw new Error('Invalid draft field');
      if(saved[field]!=null)draft[field]=saved[field];
    }
    if(!['sale','purchase'].includes(draft.type))throw new Error('Invalid invoice type');
    draft.items=saved.items.map(savedItem=>{
      if(!savedItem||typeof savedItem!=='object')throw new Error('Invalid item');
      const item=blankItem();
      for(const field of Object.keys(item)){
        if(savedItem[field]!=null&&!['string','number'].includes(typeof savedItem[field]))throw new Error('Invalid item field');
        if(savedItem[field]!=null)item[field]=String(savedItem[field]);
      }
      return item;
    });
    return {draft,error:''};
  }catch{
    // Preserve malformed data before the normal draft writer replaces it.
    try{if(raw)storage.setItem(`${key}.recovery`,raw);}catch{}
    return {draft:blankInvoice(),error:'The saved invoice draft could not be read. A recovery copy was kept where browser storage allowed it.'};
  }
}
