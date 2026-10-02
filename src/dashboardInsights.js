import {validDate} from './accounts.js';
import {businessFigures} from './business.js';
import {localNow,transactionIntegrityIssue,duplicateTransactionIds} from './ledger.js';

const DAY=86400000;
const dateValue=value=>new Date(`${value}T00:00:00Z`);
const iso=value=>value.toISOString().slice(0,10);
const within=(date,range)=>date>=range[0]&&date<=range[1];
const knownProfit=figures=>figures.missingCosts===0&&Number.isSafeInteger(figures.grossProfit);
const monthStart=(year,month)=>new Date(Date.UTC(year,month,1));
const monthEnd=(year,month)=>new Date(Date.UTC(year,month+1,0));

export function comparisonPeriods(range,period,today=localNow().slice(0,10)) {
  if(!range?.every(validDate)||range.length!==2||range[0]>range[1]||range[0]>today)return null;
  const current=[range[0],range[1]>today?today:range[1]];
  const start=dateValue(current[0]),end=dateValue(current[1]);
  if(period==='month'||period==='last'){
    const year=start.getUTCFullYear(),month=start.getUTCMonth(),previousStart=monthStart(year,month-1),previousEnd=monthEnd(year,month-1);
    const fullMonth=current[1]===iso(monthEnd(year,month))&&current[0].slice(0,7)!==today.slice(0,7);
    previousEnd.setUTCDate(fullMonth?previousEnd.getUTCDate():Math.min(end.getUTCDate(),previousEnd.getUTCDate()));
    return {current,previous:[iso(previousStart),iso(previousEnd)]};
  }
  const days=Math.round((end-start)/DAY)+1;
  return {current,previous:[iso(new Date(start.getTime()-days*DAY)),iso(new Date(start.getTime()-DAY))]};
}

export function salesGrowth(current,previous) {
  if(!Number.isSafeInteger(current)||!Number.isSafeInteger(previous)||previous<=0)return null;
  return (current-previous)/previous*100;
}

export function dashboardInsights({invoices,notes,transactions,parties,partyBalances,range,period}) {
  const activeInvoices=invoices.filter(invoice=>invoice.status==='issued'&&!invoice._pending);
  const activeNotes=notes.filter(note=>note.status==='issued'&&!note._pending);
  const duplicates=duplicateTransactionIds(transactions);
  const payments=transactions.filter(payment=>!payment.deletedAt&&!payment._pending&&!duplicates.has(payment.id)&&!transactionIntegrityIssue(payment)&&(!payment.recordType||payment.recordType==='payment'));
  const figures=businessFigures(activeInvoices,activeNotes,payments,range);
  const comparison=comparisonPeriods(range,period);
  if(comparison){
    comparison.currentFigures=businessFigures(activeInvoices,activeNotes,payments,comparison.current);
    comparison.previousFigures=businessFigures(activeInvoices,activeNotes,payments,comparison.previous);
    comparison.salesGrowth=salesGrowth(comparison.currentFigures.sales,comparison.previousFigures.sales);
    comparison.profitChange=knownProfit(comparison.currentFigures)&&knownProfit(comparison.previousFigures)?comparison.currentFigures.grossProfit-comparison.previousFigures.grossProfit:null;
  }
  const salesInvoices=activeInvoices.filter(invoice=>invoice.type==='sale');
  const periodInvoices=salesInvoices.filter(invoice=>within(invoice.invoiceDate,range));
  const billed=periodInvoices.reduce((sum,invoice)=>sum+Number(invoice.totalMinor),0);
  const firstPurchase=new Map(),customers=new Map(),partyById=new Map(parties.map(party=>[party.id,party]));
  for(const invoice of salesInvoices.filter(invoice=>!invoice.walkIn)){
    if(!firstPurchase.has(invoice.partyId)||invoice.invoiceDate<firstPurchase.get(invoice.partyId))firstPurchase.set(invoice.partyId,invoice.invoiceDate);
  }
  function customer(id,name){
    if(!customers.has(id))customers.set(id,{id,name:partyById.get(id)?.name||name||'Unnamed party',phone:partyById.get(id)?.phone||'',canOpen:partyById.has(id),sales:0,invoices:0});
    return customers.get(id);
  }
  let itemDiscounts=0,invoiceDiscounts=0,missingItemDiscounts=0;
  for(const invoice of periodInvoices){
    if(!invoice.walkIn){const row=customer(invoice.partyId,invoice.partyName);row.sales+=Number(invoice.totalMinor);row.invoices++;}
    invoiceDiscounts+=Number(invoice.invoiceDiscountMinor||0);
    const discount=Array.isArray(invoice.items)?invoice.items.reduce((sum,item)=>sum+Number(item.discountMinor||0),0):invoice.itemDiscountMinor;
    if(discount!==undefined&&discount!==null&&discount!==''&&Number.isSafeInteger(Number(discount))&&Number(discount)>=0)itemDiscounts+=Number(discount);
    else missingItemDiscounts++;
  }
  let debits=0,priceCredits=0,returnCredits=0;
  for(const note of activeNotes){
    if(note.invoiceType!=='sale'||!within(note.noteDate,range))continue;
    const amount=Number(note.amountMinor),sign=note.type==='credit'?-1:1;
    if(note.partyId)customer(note.partyId,note.partyName).sales+=sign*amount;
    if(note.type==='credit'){if(note.effect==='price')priceCredits+=amount;else returnCredits+=amount;}
    else debits+=amount;
  }
  const buyingParties=new Set(periodInvoices.filter(invoice=>!invoice.walkIn).map(invoice=>invoice.partyId));
  const newCustomers=[...buyingParties].filter(id=>within(firstPurchase.get(id),range)).length;
  const trend=[];
  if(validDate(range[1])){
    const end=dateValue(range[1]),year=end.getUTCFullYear(),month=end.getUTCMonth();
    for(let offset=5;offset>=0;offset--){
      const start=monthStart(year,month-offset),endOfMonth=monthEnd(year,month-offset);
      const dates=[iso(start),offset===0?range[1]:iso(endOfMonth)];
      const monthly=businessFigures(activeInvoices,activeNotes,payments,dates);
      trend.push({month:dates[0].slice(0,7),range:dates,sales:monthly.sales,profit:knownProfit(monthly)?monthly.grossProfit:null,missingCosts:monthly.missingCosts});
    }
  }
  return {
    figures,comparison,trend,
    margin:knownProfit(figures)&&figures.sales>0?figures.grossProfit/figures.sales*100:null,
    invoiceCount:periodInvoices.length,averageBill:periodInvoices.length?Math.round(billed/periodInvoices.length):null,
    cashMovement:payments.filter(payment=>within(payment.transactionDate,range)&&['Cash','Online'].includes(payment.method)).reduce((sum,payment)=>sum+Number(payment.amountMinor)*(payment.direction==='in'?1:-1),0),
    topCustomers:[...customers.values()].filter(row=>row.sales>0).sort((a,b)=>b.sales-a.sales||a.name.localeCompare(b.name)).slice(0,5),
    outstanding:partyBalances.filter(row=>Number.isSafeInteger(row.balance)&&row.balance>0).sort((a,b)=>b.balance-a.balance||a.party.name.localeCompare(b.party.name)).slice(0,5),
    unavailableBalances:partyBalances.filter(row=>!Number.isSafeInteger(row.balance)).length,
    customerCount:buyingParties.size,newCustomers,returningCustomers:buyingParties.size-newCustomers,
    discounts:{itemDiscounts,invoiceDiscounts,missingItemDiscounts,settlements:figures.settlementAdjustments,debits,priceCredits,returnCredits}
  };
}
