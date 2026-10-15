import {blankInvoice,blankItem,makeInvoice,minor} from './accounts.js';
import {billingPreview,billingPrice_,billingQuantityText} from './measurements.js';
export function mobileItemPreview(item,type='sale'){
 if(!item.description.trim())throw new Error('Enter an item name.');
 const quantity=billingPreview(item),line=billingPrice_(minor(item.rate,'rate'),quantity)-minor(item.discount||'0','line discount');
 // A zero-price item is valid when another item makes the complete bill positive.
 const items=line===0?[item,{...blankItem(),description:'VALIDATION',rate:'0.01'}]:[item];
 const checked=makeInvoice({...blankInvoice(),partyId:'preview-party',type,items},'preview-mobile-item').items[0];
 return {amountMinor:checked.lineTotalMinor,quantityText:billingQuantityText(quantity,item.billingUnit||'nos')};
}
export const untouchedMobileItem=item=>!item.description&&!item.rate&&!item.cost&&!item.itemNote&&!item.measurements?.length&&item.quantity==='1'&&Number(item.discount||0)===0;
