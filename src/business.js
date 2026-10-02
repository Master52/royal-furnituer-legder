import {invoiceSummary} from './accounts.js';
import {transactionIntegrityIssue,duplicateTransactionIds,hasSettlement} from './ledger.js';
export function businessFigures(invoices, notes, transactions, range) {
  const invoice=invoiceSummary(invoices,...range,notes);
  const duplicates=duplicateTransactionIds(transactions);
  let collected=0,paid=0,expenses=0,settlementAdjustments=0;
  for(const payment of transactions){
    if(payment.deletedAt||payment.transactionDate<range[0]||payment.transactionDate>range[1]||duplicates.has(payment.id)||transactionIntegrityIssue(payment)||payment.recordType&&payment.recordType!=='payment')continue;
    if(hasSettlement(payment))settlementAdjustments+=Number(payment.settlementDiscountMinor);
    const amount=Number(payment.amountMinor);
    if(payment.direction==='in')collected+=amount;else paid+=amount;
    if(payment.category==='Expense')expenses+=amount*(payment.direction==='out'?1:-1);
  }
  return {...invoice,grossProfit:invoice.grossProfit-settlementAdjustments,collected,paid,expenses,settlementAdjustments,operatingResult:invoice.missingCosts?null:invoice.grossProfit-settlementAdjustments-expenses};
}
