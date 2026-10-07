export const MAX_MINOR = 100000000000;
// Round after discounts; 50 paise rounds up. Keep the signed adjustment explicit.
export function invoiceRounding(total, enabled = false) {
  if (typeof enabled !== 'boolean') throw new Error('Invalid auto round-off option.');
  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_MINOR) throw new Error('Invoice total must be positive and within the supported amount limit.');
  const rounded = enabled ? Math.floor((total + 50) / 100) * 100 : total;
  if (rounded <= 0) throw new Error('Rounded invoice total must be positive. Turn off auto round-off for amounts below ₹0.50.');
  return {autoRoundOff: enabled, roundOffMinor: rounded - total, totalMinor: rounded};
}
export function minor(value, label = 'amount') {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  const amount = match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : NaN;
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_MINOR) throw new Error(`Enter a valid ${label} with at most two decimal places.`);
  return amount;
}

// Stored percentages use hundredths of one percent; money always uses paise.
export function invoiceDiscount(subtotal,mode='amount',value='0'){
  if(!Number.isSafeInteger(subtotal)||subtotal<0||subtotal>MAX_MINOR)throw new Error('Invalid invoice subtotal.');
  if(!['amount','percent'].includes(mode))throw new Error('Choose amount or percentage discount.');
  const entered=minor(value||'0',mode==='percent'?'discount percentage':'invoice discount');
  if(mode==='percent'&&entered>10000)throw new Error('Discount percentage cannot exceed 100%.');
  const amount=mode==='percent'?Number((BigInt(subtotal)*BigInt(entered)+5000n)/10000n):entered;
  if(amount>subtotal)throw new Error('Invoice discount cannot exceed the subtotal after existing item discounts.');
  return {discountMode:mode,discountValue:entered,invoiceDiscountMinor:amount};
}
