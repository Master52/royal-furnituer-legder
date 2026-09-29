import React from 'react';
import { money } from './ledger.js';
export const balanceText = balance => balance === 0 ? 'Settled · ₹0.00' : `${money(Math.abs(balance))} · ${balance > 0 ? 'Party owes you' : 'You owe party'}`;
export default function PartyStatement({ party, statement, range, detailed, preferences, checkedAt }) {
  return <section className="party-statement">
    <div className="statement-header"><h1>{preferences.shopName}</h1>{preferences.printContact && <p>{preferences.address}<br/>{preferences.phone}</p>}<h2>{detailed?'Detailed Ledger Statement':'Ledger Statement'}</h2><h3>{party.name}</h3><p>{party.address}<br/>{party.phone}</p><p>{range[0]} to {range[1]}</p><small>Confirmed Sheet snapshot: {checkedAt ? new Date(checkedAt).toLocaleString() : 'Not refreshed'}</small></div>
    <p><strong>Opening balance: {balanceText(statement.opening)}</strong></p>
    <p className="help">Debit increases what the party owes you. Credit reduces it. Payments are recorded against the party, not individual invoices.</p>
    <table className="statement-table"><thead><tr><th>Date</th><th>Particulars</th><th>Debit (₹)</th><th>Credit (₹)</th><th>Balance</th></tr></thead><tbody>{statement.entries.map(entry=><React.Fragment key={entry.id}><tr><td>{entry.date}</td><td>{entry.description}{preferences.printNotes && (entry.notes || entry.invoice?.notes) && <small>{entry.notes || entry.invoice.notes}</small>}</td><td>{entry.delta>0?money(entry.delta):'—'}</td><td>{entry.delta<0?money(-entry.delta):'—'}</td><td>{balanceText(entry.balance)}</td></tr>{detailed && entry.invoice && <tr className="invoice-detail-row"><td colSpan="5"><p>Invoice to/from: {entry.invoice.partyName} · {entry.invoice.partyPhone}<br/>{entry.invoice.partyAddress}</p><table className="invoice-lines"><thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Discount</th><th>Total</th></tr></thead><tbody>{entry.invoice.items.map(item=><tr key={item.id}><td>{item.description}</td><td>{Number(item.quantityMilli)/1000}</td><td>{money(item.rateMinor)}</td><td>{money(item.discountMinor)}</td><td>{money(item.lineTotalMinor)}</td></tr>)}</tbody></table></td></tr>}</React.Fragment>)}</tbody></table>
    {!statement.entries.length && <p>No entries in this period.</p>}
    <p className="statement-closing"><strong>Closing balance: {balanceText(statement.closing)}</strong></p>
    <p className="help">Cancelled invoices are excluded. Cheques count when recorded. This is an account statement, not a tax invoice.</p>
  </section>;
}
