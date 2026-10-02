import React,{useId} from 'react';
import {money} from './ledger.js';

const dateFormatter=new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const monthFormatter=new Intl.DateTimeFormat('en-IN',{month:'short',year:'2-digit',timeZone:'UTC'});
const compactMoney=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',notation:'compact',maximumFractionDigits:1});
const dateText=value=>dateFormatter.format(new Date(`${value}T00:00:00Z`));
export const rangeText=range=>range[0]===range[1]?dateText(range[0]):`${dateText(range[0])} – ${dateText(range[1])}`;
export const percent=value=>`${value.toFixed(1)}%`;

export function SalesComparison({comparison}){
  if(!comparison)return <small className="insight-comparison">Comparison unavailable for this period.</small>;
  const growth=comparison.salesGrowth;
  const label=growth===null?comparison.previousFigures.sales===0?'No sales in comparison period':'Comparison period has negative net sales':`${growth>0?'+':''}${percent(growth)} vs comparison period`;
  return <small className="insight-comparison" data-direction={growth>0?'up':growth<0?'down':'flat'}>{label}<span>{rangeText(comparison.current)} vs {rangeText(comparison.previous)}</span></small>;
}

function MonthlyTrend({points,showProfit}){
  const titleId=useId(),descriptionId=useId();
  const width=720,height=252,left=82,right=20,top=20,bottom=48;
  const values=points.flatMap(point=>[point.sales,...(showProfit&&point.profit!==null?[point.profit]:[])]);
  const maximum=Math.max(100,...values),minimum=Math.min(0,...values),plotHeight=height-top-bottom;
  const y=value=>top+(maximum-value)/(maximum-minimum)*plotHeight;
  const baseline=y(0),step=(width-left-right)/Math.max(1,points.length),barWidth=showProfit?24:38;
  const ticks=[maximum,(maximum+minimum)/2,minimum];
  return <section className="insight-panel monthly-trend"><div className="insight-panel-heading"><div><h3>Monthly sales trend</h3><p>Six-month view ending {dateText(points.at(-1).range[1])}. Final month stops at the selected end date.</p></div><div className="chart-legend"><span><i className="sales-key"/>Net invoiced sales</span>{showProfit&&<span><i className="profit-key"/>Gross profit</span>}</div></div>
    <div className="insight-chart-scroll"><svg className="insight-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
      <title id={titleId}>Monthly invoiced sales{showProfit?' and gross profit':''}</title><desc id={descriptionId}>Six months of recorded activity. Credit and debit notes affect sales on their own dates. Settlement discounts affect gross profit on their payment dates. Exact amounts are available in the table below.</desc>
      {ticks.map((tick,index)=><g key={index}><line className="chart-grid" x1={left} x2={width-right} y1={y(tick)} y2={y(tick)}/><text className="chart-tick" x={left-10} y={y(tick)+4} textAnchor="end">{compactMoney.format(tick/100)}</text></g>)}
      <line className="chart-baseline" x1={left} x2={width-right} y1={baseline} y2={baseline}/>
      {points.map((point,index)=>{const center=left+step*(index+.5),salesX=center-(showProfit?barWidth+3:barWidth/2);return <g key={point.month}>
        <rect className="chart-sales" x={salesX} y={Math.min(y(point.sales),baseline)} width={barWidth} height={Math.abs(y(point.sales)-baseline)} rx="3"><title>{point.month}: sales {money(point.sales)}</title></rect>
        {showProfit&&point.profit!==null&&<rect className="chart-profit" x={center+3} y={Math.min(y(point.profit),baseline)} width={barWidth} height={Math.abs(y(point.profit)-baseline)} rx="3"><title>{point.month}: gross profit {money(point.profit)}</title></rect>}
        {showProfit&&point.profit===null&&<text className="chart-cost-pending" x={center+barWidth/2} y={baseline-6} textAnchor="middle">?</text>}
        <text className="chart-month" x={center} y={height-19} textAnchor="middle">{monthFormatter.format(new Date(`${point.month}-01T00:00:00Z`))}</text>
      </g>;})}
    </svg></div>
    {showProfit&&points.some(point=>point.profit===null)&&<p className="insight-footnote">? Profit unavailable where CP or correction costs are missing.</p>}
    <details className="trend-figures"><summary>View monthly figures</summary><div className="insight-table-scroll"><table><thead><tr><th scope="col">Month</th><th scope="col" className="amount">Net sales</th>{showProfit&&<th scope="col" className="amount">Gross profit</th>}</tr></thead><tbody>{points.map(point=><tr key={point.month}><th scope="row">{monthFormatter.format(new Date(`${point.month}-01T00:00:00Z`))}</th><td className="amount">{money(point.sales)}</td>{showProfit&&<td className="amount">{point.profit===null?'CP incomplete':money(point.profit)}</td>}</tr>)}</tbody></table></div></details>
  </section>;
}

function PartyRanking({title,caption,rows,onParty,kind,unavailable=0}){
  return <section className="insight-panel"><div className="insight-panel-heading"><div><h3>{title}</h3><p>{caption}</p></div></div>
    {rows.length?<ol className="insight-ranking">{rows.map((row,index)=>{const party=kind==='balance'?row.party:row;return <li key={party.id}><button type="button" className="insight-party" disabled={!onParty||party.canOpen===false} onClick={()=>onParty(party.id)} aria-label={`Open ${party.name} party details · ${money(kind==='balance'?row.balance:row.sales)} ${kind==='balance'?'to receive':'net invoiced sales'}`}><span className="insight-rank" aria-hidden="true">{index+1}</span><span className="insight-party-name"><strong>{party.name}</strong><small>{party.phone||'No contact number'}{kind==='sales'?` · ${row.invoices} sales invoice${row.invoices===1?'':'s'}`:''}</small></span><span className="insight-party-amount">{money(kind==='balance'?row.balance:row.sales)}<span aria-hidden="true"> ›</span></span></button></li>;})}</ol>:<p className="insight-empty">{kind==='balance'?'No outstanding amounts to receive.':'No positive invoiced sales in this period.'}</p>}
    {unavailable>0&&<p className="insight-footnote">{unavailable} party balance(s) unavailable and excluded.</p>}
  </section>;
}

export default function DashboardInsights({insights,showProfit,onParty}){
  const {discounts}=insights;
  return <div className="dashboard-insights">
    <div className="insight-key-metrics">{[
      ['Sales invoices',String(insights.invoiceCount),'Issued in the selected period'],
      ['Average bill',insights.averageBill===null?'—':money(insights.averageBill),'Invoice values before correction notes'],
      ['Net cash movement',money(insights.cashMovement),'Cash & Online in minus out · excludes cheques'],
      ['Gross profit margin',!showProfit?'••••':insights.margin===null?'Unavailable':percent(insights.margin),insights.figures.missingCosts?'Record missing CP to calculate margin':insights.figures.sales<=0?'Requires positive net invoiced sales':'Gross profit ÷ net invoiced sales']
    ].map(([label,value,help])=><article className="insight-metric" key={label}><span>{label}</span><strong>{value}</strong><small>{help}</small></article>)}</div>
    {insights.trend.length>0&&<MonthlyTrend points={insights.trend} showProfit={showProfit}/>}
    <div className="insight-rankings"><PartyRanking title="Top 5 customers" caption="Selected period · net invoiced sales after dated corrections" rows={insights.topCustomers} kind="sales" onParty={onParty}/><PartyRanking title="Largest outstanding balances" caption="To receive · all dates · click a party to open its ledger" rows={insights.outstanding} kind="balance" onParty={onParty} unavailable={insights.unavailableBalances}/></div>
    <details className="insight-panel business-insights-details"><summary>Business insights · customers, discounts & corrections</summary><div className="insight-detail-grid"><section><h3>Customer activity</h3><dl><div><dt>Customers buying this period</dt><dd>{insights.customerCount}</dd></div><div><dt>New customers</dt><dd>{insights.newCustomers}</dd></div><div><dt>Returning customers</dt><dd>{insights.returningCustomers}</dd></div></dl><p className="insight-footnote">New means their first recorded sales invoice falls in this period. Each customer is counted once.</p></section><section><h3>Sales discounts & corrections</h3><dl><div><dt>Existing item discounts</dt><dd>{discounts.missingItemDiscounts?'Incomplete':money(discounts.itemDiscounts)}</dd></div><div><dt>Invoice discounts</dt><dd>{money(discounts.invoiceDiscounts)}</dd></div><div><dt>Full & final discounts</dt><dd>{money(discounts.settlements)}</dd></div><div><dt>Credit notes · price reductions</dt><dd>{money(discounts.priceCredits)}</dd></div><div><dt>Credit notes · returns / cost corrections</dt><dd>{money(discounts.returnCredits)}</dd></div><div><dt>Debit notes · additional charges</dt><dd>{money(discounts.debits)}</dd></div></dl>{discounts.missingItemDiscounts>0&&<p className="insight-footnote">Item-discount totals unavailable for {discounts.missingItemDiscounts} invoice(s). Other figures remain available.</p>}<p className="insight-footnote">These amounts are already reflected in their relevant totals. Do not subtract them again. Correction notes follow their own dates; full & final discounts reduce profit without changing invoice values.</p></section></div></details>
    <p className="insight-footnote">Cash movement uses Cash & Online payments only; cheques, exchanges, balance adjustments and non-cash discounts are excluded. Sales and payments are separate. Anonymous walk-in sales are included in sales totals and excluded from customer counts and rankings. Party payments are not allocated to invoices.</p>
  </div>;
}
