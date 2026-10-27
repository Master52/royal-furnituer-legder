import React from 'react';
import AmountWords from './AmountWords.jsx';
export default function PurchaseAmountFields({invoice,onChange,enabled=true}){
 if(invoice.type!=='purchase')return null;
 return <section className="purchase-amount-fields"><label className="challan-retention"><input type="checkbox" aria-label="Purchase invoice amount only" disabled={!enabled} checked={Boolean(invoice.amountOnly)} onChange={event=>onChange('amountOnly',event.target.checked)}/>Enter amount only — no item details</label>{!enabled&&<small>Requires backend 1.30.0.</small>}{invoice.amountOnly&&<><label>Purchase amount (₹)<input aria-label="Purchase amount (₹)" type="number" inputMode="decimal" required min="0.01" max="1000000000" step="0.01" value={invoice.purchaseAmount||''} onChange={event=>onChange('purchaseAmount',event.target.value)}/><AmountWords value={invoice.purchaseAmount}/></label><p className="help">Updates the party balance. No stock quantities are added. Linked challan photos stay until you delete them.</p></>}</section>;
}
