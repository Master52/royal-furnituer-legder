import {paymentMethodText,money,transactionIntegrityIssue,duplicateTransactionIds} from './ledger.js';
import {invoiceNetValue} from './accounts.js';
import {quantityText} from './measurements.js';

// Customer messages never include CP, margins or internal notes.
const displayDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(`${value}T12:00:00Z`).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'}):text(value);
const text=value=>String(value||'').replace(/[\r\n*_~`]+/g,' ').trim();
export function invoiceMessage(invoice,preferences,{notes=[],transactions=[],partyBalance=null,checkedAt='',cached=false}={}){
  const lines=[`*${text(preferences.shopName)}*`,`*${invoice.type==='sale'?'Sales':'Purchase'} invoice ${text(invoice.invoiceNumber)}*`,`${displayDate(invoice.invoiceDate)} · ${text(invoice.partyName)}`];
  if(invoice.challanNumber)lines.push(`Challan: ${text(invoice.challanNumber)}`);
  lines.push('');for(const item of invoice.items)lines.push(`${text(item.description)} · ${quantityText(item)} · ${money(item.lineTotalMinor)}`);
  lines.push(`*Total: ${money(invoice.totalMinor)}*`);
  const adjusted=invoiceNetValue(invoice,notes);if(adjusted!==Number(invoice.totalMinor))lines.push(`After credit/debit notes: ${money(adjusted)}`);
  if(invoice.walkIn){const payment=transactions.find(row=>row.id===invoice.paymentId&&!row.deletedAt&&row.invoiceId===invoice.id);const valid=!cached&&payment&&!duplicateTransactionIds(transactions).has(payment.id)&&!transactionIntegrityIssue(payment);lines.push(valid?`Paid: ${money(payment.amountMinor)} · ${paymentMethodText(payment)}`:'Payment status unavailable — refresh');if(valid){const due=adjusted-Number(payment.amountMinor);lines.push(due===0?'Paid in full · Pending: ₹0.00':due>0?`Pending: ${money(due)}`:`Refund / credit due: ${money(-due)}`);}}
  else lines.push(Number.isSafeInteger(partyBalance)?`*Current party balance: ${money(Math.abs(partyBalance))}${partyBalance>0?' to receive':partyBalance<0?' to pay':' — settled'}*`:'Current party balance unavailable — refresh to confirm.');

  return lines.join('\n');
}

export function whatsappRecipient(value){
  const raw=String(value||'').trim();
  if(!raw)return '';
  if(!/^\+?[\d\s()-]+$/.test(raw))throw new Error('Enter a phone number including its country code.');
  let digits=raw.replace(/\D/g,'');
  if(!raw.startsWith('+')&&digits.length===10)digits=`91${digits}`;
  if(!/^[1-9]\d{7,14}$/.test(digits))throw new Error('Enter a valid phone number including its country code.');
  return digits;
}
