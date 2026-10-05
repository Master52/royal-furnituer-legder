import React,{useState} from 'react';
import {minor} from './invoiceAmounts.js';
export default function SplitPaymentFields({amountMinor,cash,onCash}){
 const [onlineDraft,setOnlineDraft]=useState(null);
 let online='';try{const value=amountMinor-minor(cash||'0','cash portion');if(value>=0)online=(value/100).toFixed(2);}catch{}
 return <div className="account-fields split-payment-fields"><label>Cash portion (₹)<input data-hotkey="alt+shift+c" aria-keyshortcuts="Alt+Shift+C" aria-label="Cash portion (₹)" required type="number" min="0.01" max={amountMinor>0?amountMinor/100:undefined} step="0.01" value={cash||''} onChange={event=>onCash(event.target.value)}/></label><label>Online portion (₹)<input data-hotkey="alt+shift+o" aria-keyshortcuts="Alt+Shift+O" aria-label="Online portion (₹)" required type="number" min="0.01" max={amountMinor>0?amountMinor/100:undefined} step="0.01" value={onlineDraft??online} onFocus={()=>setOnlineDraft(online)} onBlur={()=>setOnlineDraft(null)} onChange={event=>{setOnlineDraft(event.target.value);try{const rest=amountMinor-minor(event.target.value||'0','online portion');onCash(rest>=0?(rest/100).toFixed(2):'');}catch{onCash('');}}}/></label><p className="help">Both portions must be positive and together equal the payment amount. Use Cash or Online for a single method.</p></div>;
}
