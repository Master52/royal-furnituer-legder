import MeasurementBreakdown from './MeasurementBreakdown.jsx';
import {quantityText,BILLING_UNITS} from './measurements.js';
import React, {useState} from 'react';
import { paymentMethodText, money,transactionIntegrityIssue,duplicateTransactionIds } from './ledger.js';
import {invoiceProfitFigures} from './invoiceProfit.js';

// Print callers omit profitControls so internal figures never enter the printed document.
export default function InvoiceDocument({ invoice, preferences, profitControls=false, notes=[],transactions=[],paymentsConfirmed=false }) {
  const [showProfit,setShowProfit]=useState(false);
  const profit=invoiceProfitFigures(invoice,notes);
  const legacyDiscount = invoice.items.reduce((sum, item) => sum + Number(item.discountMinor || 0), 0);
  const discount=Number(invoice.invoiceDiscountMinor||0),duplicates=duplicateTransactionIds(transactions);
  const payment=paymentsConfirmed?transactions.find(row=>row.id===invoice.paymentId&&row.invoiceId===invoice.id&&!row.deletedAt&&!duplicates.has(row.id)&&!transactionIntegrityIssue(row)):null;
  const pending=payment?profit.netValue-Number(payment.amountMinor):null;
  return <section className="invoice-document">
    <header className="invoice-document-header"><div><h1>{preferences.shopName}</h1>{preferences.printContact && <p>{preferences.address}<br/>{preferences.phone}</p>}</div><div><h2>{invoice.type === 'sale' ? 'Sales invoice' : 'Purchase invoice'}</h2><strong>{invoice.invoiceNumber}</strong><p>Date: {invoice.invoiceDate}</p>{invoice.challanNumber&&<p>Challan No.: {invoice.challanNumber}</p>}</div></header>
    {invoice.status === 'cancelled' && <div className="invoice-cancelled"><strong>CANCELLED</strong><p>{invoice.cancelReason}</p></div>}
    <section className="invoice-party"><span>{invoice.type === 'sale' ? 'Bill to' : 'Supplier'}</span><h3>{invoice.partyName}</h3>{invoice.partyPhone && <p>{invoice.partyPhone}</p>}{invoice.partyAddress && <p>{invoice.partyAddress}</p>}</section>
    <div className="invoice-document-table"><table><thead><tr><th>Item</th><th>Quantity</th><th>Rate</th>{legacyDiscount>0&&<th>Existing discount</th>}<th>Total</th></tr></thead><tbody>{invoice.items.map(item => <tr key={item.id}><td>{item.description}{item.itemNote&&<small className="invoice-item-note">{item.itemNote}</small>}<MeasurementBreakdown item={item}/></td><td>{quantityText(item)}</td><td>{money(item.rateMinor)}{item.billingUnit&&<small>per {BILLING_UNITS[item.billingUnit]}</small>}</td>{legacyDiscount>0&&<td>{money(item.discountMinor)}</td>}<td>{money(item.lineTotalMinor)}</td></tr>)}</tbody></table></div>
    {invoice.items.some(item=>item.measurements?.length)&&<p className="measurement-print-help">Measured quantities are displayed to 4 decimals. Line amounts use the full measurement precision.</p>}
    <dl className="invoice-document-totals"><div><dt>Subtotal</dt><dd>{money(Number(invoice.totalMinor) + discount + legacyDiscount)}</dd></div>{legacyDiscount>0&&<div><dt>Existing item discounts</dt><dd>−{money(legacyDiscount)}</dd></div>}{discount>0&&<div><dt>Invoice discount{invoice.discountMode==='percent'?` · ${Number(invoice.discountValue)/100}%`:''}</dt><dd>−{money(discount)}</dd></div>}<div className="invoice-grand-total"><dt>Total</dt><dd>{money(invoice.totalMinor)}</dd></div></dl>
    {profitControls&&invoice.type==='sale'&&<div className="invoice-view-profit"><button data-hotkey="alt+g" aria-keyshortcuts="Alt+G" data-hotkey-label="Show / hide invoice profit" type="button" className="outline" aria-pressed={showProfit} onClick={()=>setShowProfit(value=>!value)}>{showProfit?'◉ Hide profit':'◎ Show profit'}</button>{showProfit&&<div className="invoice-profit-breakdown" role="status"><dl>
      <div><dt>Invoice gross profit · after invoice discount</dt><dd>{profit.originalProfit===null?'Pending · CP missing':money(profit.originalProfit)}</dd></div>
      <div><dt>Credit notes · discounts</dt><dd>−{money(profit.discounts)}</dd></div>
      {(profit.otherCorrections===null||profit.otherCorrections!==0)&&<div><dt>Other note adjustments</dt><dd>{profit.otherCorrections===null?'Pending · cost correction missing':money(profit.otherCorrections)}</dd></div>}
      <div className="invoice-final-profit"><dt>Profit after discounts & corrections</dt><dd>{profit.finalProfit===null?'Pending · costs incomplete':money(profit.finalProfit)}</dd></div>
      </dl><small>Confirmed invoice notes across all dates. Party settlement discounts appear in the party ledger and monthly profit; they are not allocated to this invoice.</small></div>}</div>}
    {preferences.printNotes && invoice.notes && <section className="invoice-document-notes"><h3>Notes</h3><p>{invoice.notes}</p></section>}
    {!invoice.walkIn&&invoice.paymentId&&<p className="help">{payment?`Payment recorded with invoice: ${money(payment.amountMinor)} · ${paymentMethodText(payment)}. Included in the party’s overall balance.`:'Payment recorded with invoice is unavailable — refresh to confirm.'}</p>}
    {invoice.walkIn&&<div className="invoice-walk-in-status">{payment?<><span>Paid: {money(payment.amountMinor)} · {payment.method}</span><strong>{pending===0?'Paid in full · Pending ₹0':pending>0?`Pending: ${money(pending)}`:`Refund / credit due: ${money(-pending)}`}</strong></>:<span>Payment status unavailable — refresh to confirm.</span>}</div>}
    <p className="help">Amounts in INR · {invoice.walkIn?'Walk-in sale; payment recorded separately without a customer account.':'Payments are tracked separately in the party ledger.'}</p>
  </section>;
}
