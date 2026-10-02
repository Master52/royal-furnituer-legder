import React from 'react';
import {money} from './ledger.js';
import {invoicePayment} from './invoiceCheckout.js';

export default function InvoicePaymentEntry({invoice,draft,onChange,editing=false,type='sale',walkIn=false}){
  const update=(field,value)=>onChange({...draft,[field]:value});
  const anonymous=invoice?.walkIn??walkIn;
  const amount=anonymous?(invoice?.totalMinor||0):Math.round(Number(draft.amount||0)*100);
  const cashReceipt=(invoice?.type||type)==='sale';
  const change=invoice&&cashReceipt&&draft.method==='Cash'&&draft.cashReceived!==''?Math.max(0,Math.round(Number(draft.cashReceived)*100)-amount):0;
  const online=draft.onlineChange!==''?Number(draft.onlineChange):draft.cashChange!==''?change/100-Number(draft.cashChange):0;
  const cash=change/100-online;
  let issue='';
  if(invoice&&draft.method){try{invoicePayment(invoice,draft);}catch(error){issue=error.message;}}
  return <section className="walk-in-payment" aria-label="Payment with invoice"><h3>Payment with invoice</h3>
    {editing?<p className="help">{anonymous?'The linked payment stays unchanged. To change the amount or date, delete and reissue the invoice and payment. You can edit CP and item details while keeping the total.':'The recorded payment stays unchanged when editing this invoice. Edit or delete the payment separately from History.'}</p>:<>
      <div className="account-fields">{!anonymous&&<label>{cashReceipt?'Amount received (₹)':'Amount paid (₹)'}<input aria-label="Invoice payment amount" type="number" required min="0.01" max={invoice?invoice.totalMinor/100:undefined} step="0.01" value={draft.amount||''} onChange={e=>update('amount',e.target.value)}/></label>}<label>Payment method<select aria-label="Payment method" required value={draft.method} onChange={e=>onChange({...draft,method:e.target.value,cashReceived:'',cashChange:'',onlineChange:''})}><option value="">Choose payment method…</option><option>Cash</option><option>Online</option></select></label>
        {cashReceipt&&draft.method==='Cash'&&<label>Cash received (₹)<input aria-label="Cash received (₹)" type="number" min="0.01" step="0.01" value={draft.cashReceived} placeholder={amount>0?(amount/100).toFixed(2):'Exact payment amount'} onChange={e=>update('cashReceived',e.target.value)}/><small>Blank means exact amount.</small></label>}
      </div>
      {change>0&&<div className="account-fields"><strong className="walk-in-change">Change due: {money(change)}</strong><label>Return in cash (₹)<input aria-label="Return in cash (₹)" type="number" min="0" max={change/100} step="0.01" value={draft.cashChange!==''?draft.cashChange:Number.isFinite(cash)?cash.toFixed(2):''} onChange={e=>onChange({...draft,cashChange:e.target.value,onlineChange:''})}/></label><label>Return online (₹)<input aria-label="Return online (₹)" type="number" min="0" max={change/100} step="0.01" value={draft.onlineChange!==''?draft.onlineChange:Number.isFinite(online)?online.toFixed(2):''} onChange={e=>onChange({...draft,onlineChange:e.target.value,cashChange:''})}/></label></div>}
      {issue&&<p className="error" role="status">{issue}</p>}<p className="help">{anonymous?'Fully paid sale without a customer record. For a pending balance, choose Party invoice.':cashReceipt?'Records a Sale payment in against this party’s overall balance. Profit comes from the invoice, not the advance.':'Records a Purchase payment out against this party’s overall balance.'}</p>
    </>}
  </section>;
}
