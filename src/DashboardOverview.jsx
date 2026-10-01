import React from 'react';
import {money,paymentMethodTotals,totals,filterTransactions} from './ledger.js';
import BusinessOverview from './BusinessOverview.jsx';

export default function DashboardOverview({accounts,transactions,range,cash,online}){
  const period=filterTransactions(transactions,{start:range[0],end:range[1]}),summary=totals(period),methods=paymentMethodTotals(transactions,{start:range[0],end:range[1]});
  return <div className="dashboard-overview"><section className="current-balances"><div className="section-title"><h2>Cash & Online</h2><small>Current balances · all dates</small></div><div className="current-balance-grid">{[['Cash in hand',cash],['Online balance',online],['Available balance',cash+online]].map(([label,value])=><article className="summary-card balance-card" key={label}><span>{label}</span><h2>{money(value)}</h2></article>)}</div></section><BusinessOverview accounts={accounts} transactions={transactions} range={range}/><details className="payment-breakdown dashboard-payment-details"><summary>Payment breakdown · selected period</summary><div className="payment-method-grid">{[['Total payment in',summary.in],['Total payment out',summary.out],['Cash received',methods.Cash.in],['Online received',methods.Online.in],['Cash paid',methods.Cash.out],['Online paid',methods.Online.out]].map(([label,value])=><article className="method-total" key={label}><span>{label}</span><strong>{money(value)}</strong></article>)}</div></details></div>;
}
