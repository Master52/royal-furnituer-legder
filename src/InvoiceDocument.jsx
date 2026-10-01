import React from 'react';
import { money } from './ledger.js';

// Customer-facing document: internal cost and profit are deliberately not rendered.
export default function InvoiceDocument({ invoice, preferences }) {
  const discount = invoice.items.reduce((sum, item) => sum + Number(item.discountMinor || 0), 0);
  return <section className="invoice-document">
    <header className="invoice-document-header"><div><h1>{preferences.shopName}</h1>{preferences.printContact && <p>{preferences.address}<br/>{preferences.phone}</p>}</div><div><h2>{invoice.type === 'sale' ? 'Sales invoice' : 'Purchase invoice'}</h2><strong>{invoice.invoiceNumber}</strong><p>Date: {invoice.invoiceDate}</p>{invoice.challanNumber&&<p>Challan No.: {invoice.challanNumber}</p>}</div></header>
    {invoice.status === 'cancelled' && <div className="invoice-cancelled"><strong>CANCELLED</strong><p>{invoice.cancelReason}</p></div>}
    <section className="invoice-party"><span>{invoice.type === 'sale' ? 'Bill to' : 'Supplier'}</span><h3>{invoice.partyName}</h3>{invoice.partyPhone && <p>{invoice.partyPhone}</p>}{invoice.partyAddress && <p>{invoice.partyAddress}</p>}</section>
    <div className="invoice-document-table"><table><thead><tr><th>Item</th><th>Quantity</th><th>Rate</th><th>Discount</th><th>Total</th></tr></thead><tbody>{invoice.items.map(item => <tr key={item.id}><td>{item.description}</td><td>{Number(item.quantityMilli) / 1000}</td><td>{money(item.rateMinor)}</td><td>{money(item.discountMinor)}</td><td>{money(item.lineTotalMinor)}</td></tr>)}</tbody></table></div>
    <dl className="invoice-document-totals"><div><dt>Subtotal</dt><dd>{money(Number(invoice.totalMinor) + discount)}</dd></div><div><dt>Discount</dt><dd>{money(discount)}</dd></div><div className="invoice-grand-total"><dt>Total</dt><dd>{money(invoice.totalMinor)}</dd></div></dl>
    {preferences.printNotes && invoice.notes && <section className="invoice-document-notes"><h3>Notes</h3><p>{invoice.notes}</p></section>}
    <p className="help">Amounts in INR · Payments are tracked separately in the party ledger.</p>
  </section>;
}
