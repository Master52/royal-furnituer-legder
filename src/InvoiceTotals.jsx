import React from 'react';
import {money} from './ledger.js';

export default function InvoiceTotals({invoice}) {
  const discount=invoice?Number(invoice.invoiceDiscountMinor||0)+invoice.items.reduce((sum,item)=>sum+Number(item.discountMinor||0),0):0;
  const roundOff=Number(invoice?.roundOffMinor||0);
  const subtotal=invoice?invoice.totalMinor-roundOff+discount:null;
  return <dl className="invoice-total-breakdown" aria-label="Invoice total breakdown">
    <div><dt>Subtotal</dt><dd>{invoice?money(subtotal):'—'}</dd></div>
    <div><dt>Discount</dt><dd>{invoice?`${discount?'−':''}${money(discount)}`:'—'}</dd></div>
    <div><dt>Round-off</dt><dd>{invoice?`${roundOff>0?'+':roundOff<0?'−':''}${money(Math.abs(roundOff))}`:'—'}</dd></div>
    <div className="invoice-submit-total"><dt>Invoice total</dt><dd><strong>{invoice?money(invoice.totalMinor):'—'}</strong></dd></div>
  </dl>;
}
