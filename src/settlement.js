import {accountBalances,minor,MAX_MINOR} from './accounts.js';
import {makeTransaction} from './ledger.js';

// Payments are unallocated: settle the party's balance, never guess an invoice balance.
export function partySettlementQuote(snapshot,partyId,editing) {
  const party=snapshot.parties.find(row=>row.id===partyId&&!row.archivedAt);
  if(!party)throw new Error('Choose an active party before settling.');
  const payments=snapshot.transactions.filter(row=>row.id!==editing?.id);
  const balance=accountBalances([party],snapshot.invoices,payments,snapshot.notes||[])[0]?.balance;
  if(!Number.isSafeInteger(balance))throw new Error('The party balance is unavailable. Correct its records before settling.');
  if(balance<=0)throw new Error('Full & final is available only when this party owes you money.');
  return {party,balance};
}
export function settlementDiscount(quote,payment) {
  if(!Number.isSafeInteger(quote.balance)||quote.balance<=0)throw new Error('Full & final needs a positive party balance.');
  const amount=minor(payment,'final payment');
  if(!amount)throw new Error('Enter the final payment received.');
  if(amount>quote.balance)throw new Error('Final payment cannot exceed the party balance. Record an advance separately.');
  const discount=quote.balance-amount;
  if(discount>MAX_MINOR)throw new Error('The settlement discount is too large. Enter a larger final payment.');
  return discount;
}
export function makePartySettlement(snapshot,form,id,editing) {
  const quote=partySettlementQuote(snapshot,form.partyId,editing);
  if(form.recordType!=='payment'||form.direction!=='in'||form.category!=='Sale')throw new Error('Full & final must be a Sale payment received from this party.');
  const discount=settlementDiscount(quote,form.amount);
  const transaction=makeTransaction({...form,party:quote.party.name},id);
  if(transaction.transactionDate<quote.party.openingDate)throw new Error('Party payments cannot predate the opening balance date.');
  // One durable receipt contains both the cash amount and the non-cash waiver.
  return {...transaction,settlementDiscountMinor:discount,_expectedPartyBalanceMinor:quote.balance};
}
