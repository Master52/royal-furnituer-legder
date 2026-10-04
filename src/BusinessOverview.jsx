import React,{useMemo,useState} from 'react';
import {periodDiscounts} from './invoiceProfit.js';
import {dashboardInsights} from './dashboardInsights.js';
import DashboardInsights,{SalesComparison,rangeText} from './DashboardInsights.jsx';
import {money} from './ledger.js';
import {validDate} from './accounts.js';

function ProfitComparison({comparison}){
  if(!comparison)return null;
  if(comparison.profitChange===null)return <small className="insight-comparison">Record missing CP to compare profit.</small>;
  const difference=comparison.profitChange;
  return <small className="insight-comparison" data-direction={difference>0?'up':difference<0?'down':'flat'}>{difference===0?'No change in gross profit':`${money(Math.abs(difference))} ${difference>0?'higher':'lower'} gross profit`}<span>{rangeText(comparison.current)} vs {rangeText(comparison.previous)}</span></small>;
}

export default function BusinessOverview({accounts,transactions,range,period,onParty}){
  const [showProfit,setShowProfit]=useState(false);
  const validRange=range?.length===2&&range.every(validDate)&&range[0]<=range[1];
  const insights=useMemo(()=>validRange?dashboardInsights({invoices:accounts.invoices,notes:accounts.notes,parties:accounts.parties,partyBalances:accounts.partyBalances,transactions,range,period}):null,[accounts.invoices,accounts.notes,accounts.parties,accounts.partyBalances,transactions,range,period,validRange]);
  if(!accounts.loaded)return null;
  if(!insights)return <section className="business-overview"><p role="status">Choose a valid date range to show business insights.</p></section>;
  const {figures,comparison}=insights;
  const invalid=accounts.partyBalances.some(row=>row.balance===null);
  const receive=accounts.partyBalances.reduce((sum,row)=>sum+Math.max(0,row.balance||0),0);
  const pay=accounts.partyBalances.reduce((sum,row)=>sum-Math.min(0,row.balance||0),0);
  const metrics=[
    {label:'Net invoiced sales',value:figures.sales,help:'Sales invoices after credit/debit notes',tone:'sale',comparison:<SalesComparison comparison={comparison}/>},
    {label:'Net invoiced purchases',value:figures.purchases,help:'Purchase invoices after credit/debit notes',tone:'purchase'},
    {label:'To receive',value:invalid?null:receive,help:'Outstanding party balances · all dates',tone:'sale'},
    {label:'To pay',value:invalid?null:pay,help:'Outstanding party balances · all dates',tone:'purchase'},
    {label:'Gross profit',value:showProfit?figures.grossProfit:'hidden',help:figures.missingCosts?'Partial · only records with known costs':'Net sales minus recorded costs and settlement discounts',comparison:showProfit?<ProfitComparison comparison={comparison}/>:null},
    {label:'Profit after recorded expenses',value:showProfit?figures.operatingResult:'hidden',help:'Gross profit less recorded operating expenses'}
  ];
  return <section className="business-overview"><div className="section-title"><div><h2>Business overview</h2><span>Selected period · confirmed records</span></div><button data-hotkey="alt+g" aria-keyshortcuts="Alt+G" data-hotkey-label="Show / hide business profit" className="outline" aria-label={showProfit?'Hide business profit':'Show business profit'} aria-pressed={showProfit} onClick={()=>setShowProfit(previous=>!previous)}>{showProfit?'◉ Hide profit':'◎ Show profit'}</button></div>
    <div className="account-metrics business-metrics">{metrics.map(metric=><article data-tone={metric.tone} key={metric.label}><span>{metric.label}</span><strong>{metric.value==='hidden'?'••••':metric.value===null?'Unavailable':money(metric.value)}</strong><small>{metric.help}</small>{metric.comparison}</article>)}</div>
    {showProfit&&periodDiscounts(accounts.notes,range)+figures.settlementAdjustments>0&&<p className="help profit-adjustment-summary">Discounts / settlement adjustments this period: <strong>−{money(periodDiscounts(accounts.notes,range)+figures.settlementAdjustments)}</strong>. Already included in gross profit; dated to the credit note or full & final payment. Earlier months stay unchanged.</p>}
    {figures.missingCosts>0&&<p className="help">{figures.missingCosts} sales invoice/note record(s) have unknown costs. Gross profit is partial; profit after expenses is unavailable until those costs are recorded.</p>}
    <DashboardInsights insights={insights} showProfit={showProfit} onParty={onParty}/>
    <details className="business-help"><summary>How these totals work</summary><p>Sales and purchases are invoice values after correction notes. To Receive/To Pay are party balances across all dates. Profit after expenses subtracts {money(figures.expenses)} in Expense payments, less refunds. Bhara is excluded from this deduction. Full & final discounts reduce profit on the payment date without changing invoices. Pending uploads are excluded.</p><p>Monthly growth compares matching elapsed dates for the current month and complete months for earlier periods. Custom ranges use an equally long preceding period. Average bill uses issued sales invoices before correction notes; notes for earlier invoices do not distort the average. The six-month chart ends at the selected end date and is a separate monthly view.</p></details>
  </section>;
}
