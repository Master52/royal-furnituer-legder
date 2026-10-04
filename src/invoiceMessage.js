import {money,localNow,transactionIntegrityIssue,duplicateTransactionIds} from './ledger.js';
import {invoiceNetValue} from './accounts.js';
import {measurementText,quantityText,BILLING_UNITS} from './measurements.js';

// Customer messages never include CP, margins or internal notes.
const displayDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(`${value}T12:00:00Z`).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'}):text(value);
const text=value=>String(value||'').replace(/[\r\n*_~`]+/g,' ').trim();
export function invoiceMessage(invoice,preferences,{notes=[],transactions=[],partyBalance=null,checkedAt='',cached=false}={}){
  const lines=[`*${text(preferences.shopName)}*`,'',`*${invoice.type==='sale'?'Sales':'Purchase'} Invoice: ${text(invoice.invoiceNumber)}*`,`Date: ${displayDate(invoice.invoiceDate)}`,`${invoice.type==='sale'?'Customer':'Supplier'}: ${text(invoice.partyName)}`];
  if(invoice.challanNumber)lines.push(`Challan: ${text(invoice.challanNumber)}`);
  lines.push('','────────────','*ITEMS*');
  invoice.items.forEach((item,index)=>{
    lines.push(`*${index+1}. ${text(item.description)}*`);
    if(item.itemNote)lines.push(`   ${text(item.itemNote)}`);
    if(item.measurements?.length)item.measurements.forEach(row=>lines.push(`   ${text(measurementText(item,row))}`));
    lines.push(`   Qty: ${quantityText(item)} · Rate: ${money(item.rateMinor)}${item.billingUnit?` / ${BILLING_UNITS[item.billingUnit].toUpperCase()}`:''}`,`   *Amount: ${money(item.lineTotalMinor)}*`);
    if(Number(item.discountMinor)>0)lines.push(`   Item discount: ${money(item.discountMinor)} (included)`);
  });
  const itemDiscount=invoice.items.reduce((sum,item)=>sum+Number(item.discountMinor||0),0),discount=Number(invoice.invoiceDiscountMinor||0);
  lines.push('','────────────','*BILL SUMMARY*',`Subtotal: ${money(Number(invoice.totalMinor)+discount+itemDiscount)}`);
  if(itemDiscount)lines.push(`Item discounts: −${money(itemDiscount)}`);
  if(discount)lines.push(`Discount${invoice.discountMode==='percent'?` · ${Number(invoice.discountValue)/100}%`:''}: −${money(discount)}`);
  lines.push(`*Invoice total: ${money(invoice.totalMinor)}*`);
  const adjusted=invoiceNetValue(invoice,notes);
  if(adjusted!==Number(invoice.totalMinor))lines.push(`Value after credit/debit notes: ${money(adjusted)}`);
  if(invoice.status!=='issued')lines.push(`*Status: ${text(invoice.status)}*`);
  if(invoice.walkIn){
    const duplicates=duplicateTransactionIds(transactions),payment=transactions.find(row=>row.id===invoice.paymentId&&!row.deletedAt&&row.invoiceId===invoice.id);
    if(!cached&&invoice.status==='issued'&&payment&&!duplicates.has(payment.id)&&!transactionIntegrityIssue(payment)){
      lines.push('',`Paid: ${money(payment.amountMinor)} · ${payment.method}`);
      const pending=adjusted-Number(payment.amountMinor);
      lines.push(pending===0?'*Pending: ₹0 — Paid in full*':pending>0?`*Pending: ${money(pending)}*`:`*Refund / credit due: ${money(-pending)}*`);
    }else lines.push('','Payment status unavailable — refresh to confirm.');
  }else {
    const linked=transactions.filter(row=>row.id===invoice.paymentId&&row.invoiceId===invoice.id&&row.partyId===invoice.partyId&&!row.deletedAt);
    if(!cached&&linked.length===1&&!transactionIntegrityIssue(linked[0]))lines.push('',`Payment recorded with invoice: ${money(linked[0].amountMinor)} · ${linked[0].method}`);
    lines.push('','*ACCOUNT SUMMARY*',Number.isSafeInteger(partyBalance)?`*Current party balance: ${money(Math.abs(partyBalance))}${partyBalance>0?' to receive':partyBalance<0?' to pay':' — settled'}*`:'Current party balance unavailable — refresh to confirm.');
    if(Number.isSafeInteger(partyBalance))lines.push('This is your overall account balance, including other invoices and payments.');
  }
  const asOf=checkedAt?new Date(checkedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):localNow().replace('T',' ');
  lines.push(`As of: ${asOf}${cached?' · saved snapshot':''}`,'','────────────','Thank you for your business.','Please contact us if you have any questions about this bill.');
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
