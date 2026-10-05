import {makeTransaction,localNow} from './ledger.js';
import {minor} from './invoiceAmounts.js';

export function invoicePayment(invoice,draft){
  if(!['Cash','Online','Split'].includes(draft.method))throw new Error('Choose Cash, Online or Cash + Online for this invoice payment.');
  const amountMinor=invoice.walkIn?invoice.totalMinor:minor(draft.amount||'0','payment amount');
  if(amountMinor<=0||amountMinor>invoice.totalMinor)throw new Error('Payment must be positive and cannot exceed this invoice total.');
  return {...makeTransaction({recordType:'payment',dateTime:`${invoice.invoiceDate}T${localNow().slice(11,16)}`,direction:invoice.type==='sale'?'in':'out',category:invoice.type==='sale'?'Sale':'Purchase',method:draft.method,cashPortion:draft.cashPortion||'',onlinePortion:draft.onlinePortion||'',amount:(amountMinor/100).toFixed(2),party:invoice.walkIn?'CASH SALE':invoice.partyName||'',partyId:invoice.walkIn?'':invoice.partyId,notes:invoice.walkIn?'Walk-in invoice payment':'Payment recorded with invoice',cashReceived:draft.cashReceived||'',cashChange:draft.cashChange||'',onlineChange:draft.onlineChange||''},`${invoice.id}-payment`),invoiceId:invoice.id};
}
export const walkInPayment=invoicePayment;
export const blankCheckout=()=>({method:'',cashPortion:'',onlinePortion:'',amount:'',cashReceived:'',cashChange:'',onlineChange:''});
