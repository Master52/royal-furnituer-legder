import React, {useMemo, useState} from 'react';
import {periodDiscounts} from './invoiceProfit.js';
import {businessFigures} from './business.js';
import {money} from './ledger.js';

export default function BusinessOverview({accounts, transactions, range}) {
  const [showProfit,setShowProfit]=useState(false);
  const figures=useMemo(()=>businessFigures(accounts.invoices,accounts.notes,transactions,range),[accounts.invoices,accounts.notes,transactions,range]);
  if(!accounts.loaded)return null;
  const invalid=accounts.partyBalances.some(row=>row.balance===null);
  const receive=accounts.partyBalances.reduce((sum,row)=>sum+Math.max(0,row.balance||0),0);
  const pay=accounts.partyBalances.reduce((sum,row)=>sum-Math.min(0,row.balance||0),0);
  return <section className="business-overview"><div className="section-title"><div><h2>Business overview</h2><span>Selected period · confirmed records</span></div><button className="outline" aria-label={showProfit?'Hide business profit':'Show business profit'} aria-pressed={showProfit} onClick={()=>setShowProfit(!showProfit)}>{showProfit?'◉ Hide profit':'◎ Show profit'}</button></div>
    <div className="account-metrics business-metrics">{[
      ['Net invoiced sales',figures.sales,'Sales invoices after credit/debit notes'],['Net invoiced purchases',figures.purchases,'Purchase invoices after credit/debit notes'],
            ['To receive',invalid?null:receive,'Outstanding party balances · all dates'],['To pay',invalid?null:pay,'Outstanding party balances · all dates'],
      ['Gross profit',showProfit?figures.grossProfit:'hidden',figures.missingCosts?'Partial · only records with known costs':'Net sales minus recorded costs and settlement discounts'],
      ['Profit after recorded expenses',showProfit?figures.operatingResult:'hidden','Gross profit less recorded operating expenses']
    ].map(([label,value,help])=><article data-tone={label==='Net invoiced sales'||label==='To receive'?'sale':label==='Net invoiced purchases'||label==='To pay'?'purchase':undefined} key={label}><span>{label}</span><strong>{value==='hidden'?'••••':value===null?'Unavailable':money(value)}</strong><small>{help}</small></article>)}</div>
    {showProfit&&periodDiscounts(accounts.notes,range)+figures.settlementAdjustments>0&&<p className="help profit-adjustment-summary">Discounts / settlement adjustments this period: <strong>−{money(periodDiscounts(accounts.notes,range)+figures.settlementAdjustments)}</strong>. Already included in gross profit; dated to the credit note or full & final payment. Earlier months stay unchanged.</p>}
    {figures.missingCosts>0&&<p className="help">{figures.missingCosts} sales invoice/note record(s) have unknown costs. Gross profit is partial; profit after expenses is unavailable until those costs are recorded.</p>}
    <details className="business-help"><summary>How these totals work</summary><p>Sales and purchases are invoice values after correction notes. To Receive/To Pay are party balances across all dates. Profit after expenses subtracts {money(figures.expenses)} in Expense payments, less refunds. Bhara is excluded from this deduction. Full & final discounts reduce profit on the payment date without changing invoices. Payments and invoice values are separate; pending uploads are excluded.</p></details>
  </section>;
}
