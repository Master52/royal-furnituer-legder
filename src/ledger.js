export const categories = ['Sale', 'Purchase', 'Bhara', 'Expense'];
export const methods = ['Cash', 'Online', 'Cheque', 'Split'];
export const SHOP_TIMEZONE = 'Asia/Kolkata';
function integerValue(value) {
  if (typeof value==='number') return Number.isSafeInteger(value)?value:NaN;
  if (typeof value==='string' && /^-?\d+$/.test(value.trim())) { const parsed=Number(value);return Number.isSafeInteger(parsed)?parsed:NaN; }
  return NaN;
}
const currencyFormatter=new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
export const money = value => {const amount=integerValue(value);return Number.isSafeInteger(amount)?currencyFormatter.format(amount/100):'Invalid amount';};
export function validMinorAmount(value) {
  const amount=integerValue(value);
  return amount>0 && amount<=100000000000;
}
export const hasSettlement = t => t?.settlementDiscountMinor!==undefined && t.settlementDiscountMinor!==null && t.settlementDiscountMinor!=='';
export function transactionIntegrityIssue(t) {
  if (!t || typeof t!=='object') return 'invalid transaction row';
  if(hasSettlement(t)&&(!Number.isSafeInteger(integerValue(t.settlementDiscountMinor))||Number(t.settlementDiscountMinor)<0||Number(t.settlementDiscountMinor)>100000000000||!t.partyId||t.direction!=='in'||t.category!=='Sale'||t.recordType&&t.recordType!=='payment'))return 'invalid party settlement';
  if(t.recordType==='adjustment'){
    if(!validMinorAmount(t.amountMinor))return 'invalid cashflow adjustment amount';
    if(!validLocalDateTime(`${t.transactionDate}T${t.transactionTime}`))return 'invalid transaction date or time';
    if(t.category!=='Cashflow adjustment'||t.method!=='Adjustment'||!['adjustment','adjustment-cash','adjustment-online'].includes(t.direction))return 'invalid cashflow adjustment';
    const fields=['expectedCashMinor','countedCashMinor','cashAdjustmentMinor','expectedOnlineMinor','countedOnlineMinor','onlineAdjustmentMinor'];
    if(fields.some(key=>!Number.isSafeInteger(integerValue(t[key]))||Math.abs(integerValue(t[key]))>100000000000))return 'invalid cashflow adjustment amount';
    if((t.direction!=='adjustment-online'&&Number(t.countedCashMinor)<0)||(t.direction!=='adjustment-cash'&&Number(t.countedOnlineMinor)<0)||Number(t.cashAdjustmentMinor)!==Number(t.countedCashMinor)-Number(t.expectedCashMinor)||Number(t.onlineAdjustmentMinor)!==Number(t.countedOnlineMinor)-Number(t.expectedOnlineMinor)||Number(t.amountMinor)!==Math.abs(Number(t.cashAdjustmentMinor))+Math.abs(Number(t.onlineAdjustmentMinor))||Number(t.amountMinor)<=0)return 'unbalanced cashflow adjustment';
    return '';
  }
  if (!validMinorAmount(t.amountMinor)) return 'invalid amount';
  if (!validLocalDateTime(`${t.transactionDate}T${t.transactionTime}`)) return 'invalid transaction date or time';
  if (t.recordType === 'transfer') return t.direction === 'transfer' && t.category === 'Transfer' && ['Cash','Online'].includes(t.fromMethod) && ['Cash','Online'].includes(t.toMethod) && t.fromMethod !== t.toMethod ? '' : 'invalid cash/online exchange';
  if ((t.recordType && t.recordType !== 'payment') || !['in','out'].includes(t.direction) || !categories.includes(t.category) || !methods.includes(t.method)) return 'invalid payment details';
  if(t.method==='Split'){const cash=integerValue(t.cashPortionMinor),online=integerValue(t.onlinePortionMinor);if(![cash,online].every(Number.isSafeInteger)||cash<=0||online<=0||cash+online!==Number(t.amountMinor))return 'unbalanced split payment';}
  if (t.method==='Cheque' && !validDateOnly(t.chequeDate)) return 'invalid cheque date';
  if (t.category === 'Sale' && t.direction === 'in' && t.method === 'Cash' && t.cashReceivedMinor !== '' && t.cashReceivedMinor != null) {
    const received=integerValue(t.cashReceivedMinor),cashChange=integerValue(t.cashChangeMinor || 0),onlineChange=integerValue(t.onlineChangeMinor || 0),amount=integerValue(t.amountMinor);
    if (![received,cashChange,onlineChange].every(Number.isSafeInteger) || [received,cashChange,onlineChange].some(value=>value<0 || value>100000000000) || received!==amount+cashChange+onlineChange) return 'unbalanced cash change';
  }
  return '';
}
export function duplicateTransactionIds(rows) {
  const counts=new Map();
  for(const t of rows){if(typeof t?.id==='string' && t.id) counts.set(t.id,(counts.get(t.id)||0)+1);}
  return new Set([...counts].filter(([,count])=>count>1).map(([id])=>id));
}
export function sumAmounts(rows) {
  const duplicates=duplicateTransactionIds(rows);
  return rows.reduce((sum,t)=>sum+(!duplicates.has(t.id) && !transactionIntegrityIssue(t) && (!t.recordType||t.recordType==='payment')?Number(t.amountMinor):0),0);
}
export function localNow() {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_TIMEZONE, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(d);
  const part = type => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
export function periodRange(period, now = new Date(), timeZone = SHOP_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(now);
  const year = Number(parts.find(item => item.type === 'year').value);
  const month = Number(parts.find(item => item.type === 'month').value);
  const day = parts.find(item => item.type === 'day').value;
  const date = (y,m,d) => `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  if (period === 'today') return [date(year,month,day), date(year,month,day)];
  const offset = period === 'last' ? -1 : 0;
  const start = new Date(Date.UTC(year, month - 1 + offset, 1));
  const end = new Date(Date.UTC(year, month + offset, 0));
  return [date(start.getUTCFullYear(), start.getUTCMonth()+1, 1), date(end.getUTCFullYear(), end.getUTCMonth()+1, end.getUTCDate())];
}
export function filterTransactions(rows, { start, end, category = '', method = '', query = '' }) {
  return rows.filter(t => t.transactionDate >= start && t.transactionDate <= end && (!category || t.category === category) && (!method || t.method === method || t.method==='Split'&&['Cash','Online'].includes(method)) && `${t.party} ${t.notes} ${t.category} ${t.recordType==='transfer'?'cash online exchange transfer':''}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => `${b.transactionDate}T${b.transactionTime}`.localeCompare(`${a.transactionDate}T${a.transactionTime}`));
}
export function totals(rows) {
  const duplicates=duplicateTransactionIds(rows);
  return rows.reduce((sum, t) => {
    if (duplicates.has(t.id) || transactionIntegrityIssue(t) || (t.recordType && t.recordType!=='payment')) return sum;
    return { ...sum, [t.direction]: sum[t.direction] + Number(t.amountMinor) };
  }, { in: 0, out: 0 });
}
function parseMinor(value, label, allowZero=false) {
  const text=String(value ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error(`Enter a valid ${label} with up to two decimal places.`);
  const [whole, fraction='']=text.split('.');
  const minor=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if (!Number.isSafeInteger(minor) || minor < (allowZero?0:1) || minor > 100000000000) throw new Error(`Enter a ${allowZero?'non-negative':'positive'} ${label} no greater than ₹1,000,000,000.`);
  return minor;
}
function validLocalDateTime(value) {
  const match=/^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d$/.exec(String(value || ''));
  if(!match) return false;
  return validDateOnly(`${match[1]}-${match[2]}-${match[3]}`);
}
function validDateOnly(value) {
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if(!match) return false;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  const leap=year%4===0 && (year%100!==0 || year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return month>=1 && month<=12 && day>=1 && day<=days[month-1];
}
export function makeTransaction(form, id = crypto.randomUUID()) {
  if (!validLocalDateTime(form.dateTime)) throw new Error('Choose a valid transaction date and time.');
  if(form.recordType==='adjustment'){
    const parseBalance=(value,label)=>parseMinor(value,label,true);
    const expectedCash=integerValue(form.expectedCashMinor),expectedOnline=integerValue(form.expectedOnlineMinor);
    if(!Number.isSafeInteger(expectedCash)||!Number.isSafeInteger(expectedOnline))throw new Error('Refresh the ledger before saving a cashflow adjustment.');
    const adjustmentMethod=form.adjustmentMethod==='Online'?'Online':'Cash';
    const countedBalance=parseBalance(form.countedBalance,`${adjustmentMethod.toLowerCase()} balance`);
    const preservedCash=integerValue(form.preservedCashAdjustmentMinor??0),preservedOnline=integerValue(form.preservedOnlineAdjustmentMinor??0);
    if(!Number.isSafeInteger(preservedCash)||!Number.isSafeInteger(preservedOnline))throw new Error('Refresh the ledger before saving a cashflow adjustment.');
    const cashAdjustment=adjustmentMethod==='Cash'?countedBalance-expectedCash:preservedCash;
    const onlineAdjustment=adjustmentMethod==='Online'?countedBalance-expectedOnline:preservedOnline;
    const countedCash=expectedCash+cashAdjustment,countedOnline=expectedOnline+onlineAdjustment;
    const amountMinor=Math.abs(cashAdjustment)+Math.abs(onlineAdjustment);
    if(amountMinor===0)throw new Error('Your counted balances already match. There is no adjustment to record.');
    if(amountMinor>100000000000)throw new Error('Combined adjustment is too large.');
    return {id,schemaVersion:1,recordType:'adjustment',transactionDate:form.dateTime.slice(0,10),transactionTime:form.dateTime.slice(11,16),timezone:SHOP_TIMEZONE,direction:adjustmentMethod==='Cash'?'adjustment-cash':'adjustment-online',category:'Cashflow adjustment',method:'Adjustment',amountMinor,currency:'INR',party:'',notes:(form.notes||'').trim(),createdAt:new Date().toISOString(),metadata:'{}',chequeDate:'',cashReceivedMinor:'',cashChangeMinor:'',onlineChangeMinor:'',fromMethod:'',toMethod:'',expectedCashMinor:expectedCash,countedCashMinor:countedCash,cashAdjustmentMinor:cashAdjustment,expectedOnlineMinor:expectedOnline,countedOnlineMinor:countedOnline,onlineAdjustmentMinor:onlineAdjustment};
  }
  const amountMinor=parseMinor(form.amount,form.recordType==='transfer'?'exchange amount':'amount');
  const base={id,schemaVersion:1,recordType:form.recordType==='transfer'?'transfer':'payment',transactionDate:form.dateTime.slice(0,10),transactionTime:form.dateTime.slice(11,16),timezone:SHOP_TIMEZONE,amountMinor,currency:'INR',party:(form.party || '').trim(),notes:(form.notes || '').trim(),createdAt:new Date().toISOString(),metadata:'{}'};
  if (base.recordType==='transfer') {
    const directions={'receive-cash-send-online':['Online','Cash'],'receive-online-give-cash':['Cash','Online']};
    const [fromMethod,toMethod]=directions[form.exchangeDirection] || [];
    if (!fromMethod || !toMethod) throw new Error('Choose whether you are receiving cash or online payment.');
    return {...base,direction:'transfer',category:'Transfer',method:'Transfer',fromMethod,toMethod,chequeDate:'',cashReceivedMinor:'',cashChangeMinor:'',onlineChangeMinor:''};
  }
  if (!categories.includes(form.category) || !methods.includes(form.method) || !['in','out'].includes(form.direction)) throw new Error('Choose a valid category, payment method and direction.');
  if (form.method === 'Cheque' && !/^\d{4}-\d{2}-\d{2}$/.test(form.chequeDate || '')) throw new Error('Enter the date the cheque was given.');
  let cashReceivedMinor='',cashChangeMinor='',onlineChangeMinor='';
  if (form.category==='Sale' && form.direction==='in' && form.method==='Cash') {
    cashReceivedMinor=form.cashReceived ? parseMinor(form.cashReceived,'cash received') : amountMinor;
    const changeDue=cashReceivedMinor-amountMinor;
    if (changeDue<0) throw new Error('Cash received cannot be less than the sale amount.');
    cashChangeMinor=form.cashChange ? parseMinor(form.cashChange,'cash change returned',true) : form.onlineChange ? changeDue-parseMinor(form.onlineChange,'online change returned',true) : changeDue;
    onlineChangeMinor=form.onlineChange ? parseMinor(form.onlineChange,'online change returned',true) : form.cashChange ? changeDue-parseMinor(form.cashChange,'cash change returned',true) : 0;
    if (cashChangeMinor<0 || onlineChangeMinor<0 || cashChangeMinor+onlineChangeMinor!==changeDue) throw new Error('Cash and online change returned must add up to the change due.');
  }
  let split={};
  if(form.method==='Split'){const cash=parseMinor(form.cashPortion,'cash portion'),online=form.onlinePortion?parseMinor(form.onlinePortion,'online portion'):amountMinor-cash;if(online<=0||cash+online!==amountMinor)throw new Error('Cash and Online portions must add up to the payment amount.');split={cashPortionMinor:cash,onlinePortionMinor:online};}
  return {...base,...split,partyId:form.partyId || '',recordType:'payment',direction:form.direction,category:form.category,method:form.method,chequeDate:form.method==='Cheque'?form.chequeDate:'',cashReceivedMinor,cashChangeMinor,onlineChangeMinor,fromMethod:'',toMethod:''};
}

export function paymentMethodTotals(rows,{start,end,category='',query=''}={}) {
  const result={Cash:{in:0,out:0},Online:{in:0,out:0}};
  const selected=filterTransactions(rows,{start,end,category,query});
  const duplicates=duplicateTransactionIds(rows);
  const add=(method,direction,amount)=>{if(result[method] && ['in','out'].includes(direction) && Number.isFinite(Number(amount))) result[method][direction]+=Number(amount);};
  for(const t of selected){
    if(duplicates.has(t.id) || transactionIntegrityIssue(t)) continue;
    const amount=Number(t.amountMinor);
    if(t.recordType==='transfer'){
      if(t.direction!=='transfer' || !['Cash','Online'].includes(t.fromMethod) || !['Cash','Online'].includes(t.toMethod) || t.fromMethod===t.toMethod) continue;
      add(t.fromMethod,'out',amount); add(t.toMethod,'in',amount);
    }else if(t.method==='Split'){add('Cash',t.direction,Number(t.cashPortionMinor));add('Online',t.direction,Number(t.onlinePortionMinor));
    }else if(t.category==='Sale' && t.direction==='in' && t.method==='Cash' && t.cashReceivedMinor!=='' && t.cashReceivedMinor!=null){
      const received=integerValue(t.cashReceivedMinor),cashChange=integerValue(t.cashChangeMinor || 0),onlineChange=integerValue(t.onlineChangeMinor || 0);
      if (![received,cashChange,onlineChange].every(Number.isSafeInteger) || [received,cashChange,onlineChange].some(value=>value<0 || value>100000000000) || received<amount || received!==amount+cashChange+onlineChange) continue;
      add('Cash','in',received);
      add('Cash','out',cashChange);
      add('Online','out',onlineChange);
    }else if((!t.recordType || t.recordType==='payment') && categories.includes(t.category)) add(t.method,t.direction,amount);
  }
  return result;
}

export function paymentMethodBalance(rows) {
  const dates=rows.map(t=>t.transactionDate).filter(value=>typeof value==='string').sort();
  if(!dates.length)return {Cash:0,Online:0};
  const methods=paymentMethodTotals(rows,{start:dates[0],end:dates[dates.length-1]});
  const duplicates=duplicateTransactionIds(rows);
  let cashAdjustment=0,onlineAdjustment=0;
  for(const t of rows){if(duplicates.has(t.id)||transactionIntegrityIssue(t)||t.recordType!=='adjustment')continue;cashAdjustment+=Number(t.cashAdjustmentMinor);onlineAdjustment+=Number(t.onlineAdjustmentMinor);}
  return {Cash:methods.Cash.in-methods.Cash.out+cashAdjustment,Online:methods.Online.in-methods.Online.out+onlineAdjustment};
}

export function paymentMethodText(payment){return payment.method==='Split'?`Cash + Online (${money(payment.cashPortionMinor)} cash + ${money(payment.onlinePortionMinor)} online)`:payment.method;}
