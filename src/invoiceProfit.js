import {invoiceNetValue,noteValueSign} from './accounts.js';

export function invoiceProfitFigures(invoice,notes=[]) {
  const active=notes.filter(note=>note.invoiceId===invoice.id&&note.status==='issued');
  const originalProfit=invoice.costTotalMinor==null||invoice.costTotalMinor===''?null:Number(invoice.totalMinor)-Number(invoice.costTotalMinor);
  const discounts=active.filter(note=>note.type==='credit'&&note.effect==='price').reduce((sum,note)=>sum+Number(note.amountMinor),0);
  const knownCosts=active.every(note=>note.costAdjustmentMinor!=null&&note.costAdjustmentMinor!=='');
  const correctionProfit=knownCosts?active.reduce((sum,note)=>sum+noteValueSign(note)*(Number(note.amountMinor)-Number(note.costAdjustmentMinor)),0):null;
  const otherCorrections=correctionProfit===null?null:correctionProfit+discounts;
  return {originalProfit,discounts,otherCorrections,finalProfit:originalProfit===null||correctionProfit===null?null:originalProfit+correctionProfit,netValue:invoiceNetValue(invoice,active)};
}
export function periodDiscounts(notes,range) {
  return notes.filter(note=>note.status==='issued'&&note.invoiceType==='sale'&&note.type==='credit'&&note.effect==='price'&&note.noteDate>=range[0]&&note.noteDate<=range[1]).reduce((sum,note)=>sum+Number(note.amountMinor),0);
}
