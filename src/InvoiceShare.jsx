import {invoiceImageDocument} from './documentLayout.js';
import DocumentShare from './DocumentShare.jsx';
import React,{useMemo,useState} from 'react';
import {invoiceMessage,whatsappRecipient} from './invoiceMessage.js';

export default function InvoiceShare({invoice,preferences,accounts,paymentPending}){
  const [phone,setPhone]=useState(invoice.partyPhone||''),[feedback,setFeedback]=useState('');
  const balance=accounts.partyBalances.find(row=>row.party.id===invoice.partyId)?.balance??null;
  const message=useMemo(()=>Array.isArray(invoice.items)?invoiceMessage(invoice,preferences,{notes:accounts.notes,transactions:accounts.transactions,partyBalance:balance,checkedAt:accounts.checkedAt,cached:accounts.cached}):'Loading invoice details…',[invoice,preferences,accounts.notes,accounts.transactions,balance,accounts.checkedAt,accounts.cached]);
  const imageDocument=useMemo(()=>Array.isArray(invoice.items)?invoiceImageDocument(invoice,preferences,{notes:accounts.notes,partyBalance:balance,transactions:accounts.transactions,paymentsConfirmed:!accounts.cached&&!accounts.pending&&!paymentPending}):null,[invoice,preferences,accounts.notes,balance,accounts.transactions,accounts.cached,accounts.pending,paymentPending]);
  const disabled=!Array.isArray(invoice.items)||invoice._pending||invoice.status!=='issued'||paymentPending||Boolean(accounts.pending)||accounts.refreshing||accounts.cached||Boolean(accounts.error);
  async function copy(){try{await navigator.clipboard.writeText(message);setFeedback('Invoice message copied.');}catch{setFeedback('Copy unavailable. Select and copy the message from the preview.');}}
  function whatsapp(){try{const recipient=whatsappRecipient(phone);window.open(`https://wa.me/${recipient}?text=${encodeURIComponent(message)}`,'_blank','noopener,noreferrer');setFeedback('Review the message in WhatsApp and press Send.');}catch(error){setFeedback(error.message);}}
  return <section className="invoice-share"><p className="help">Invoice details and current balance. CP and profit are excluded. Review and send the message yourself.</p>
    <label>Recipient phone<input data-hotkey="alt+q" aria-keyshortcuts="Alt+Q" aria-label="Recipient phone" type="tel" value={phone} maxLength="30" placeholder="+91… or leave blank to choose in WhatsApp" onChange={e=>setPhone(e.target.value)}/><small>Used for sharing only; no party is created.</small></label>
    <label>Message preview<textarea data-hotkey="alt+v" aria-keyshortcuts="Alt+V" aria-label="Message preview" readOnly rows="8" value={message}/></label>
    {disabled&&<p className="help">Finish pending uploads and refresh to confirm the invoice and balance before sharing.</p>}
    <div className="accounts-controls"><button data-hotkey="alt+r" aria-keyshortcuts="Alt+R" data-hotkey-label="Refresh invoice balance" type="button" className="outline" disabled={accounts.refreshing||Boolean(accounts.pending)||paymentPending} onClick={()=>accounts.reload({fresh:true})}>Refresh balance</button><button data-hotkey="alt+c" aria-keyshortcuts="Alt+C" data-hotkey-label="Copy invoice message" type="button" className="outline" disabled={disabled} onClick={copy}>Copy message</button><button data-hotkey="alt+w" aria-keyshortcuts="Alt+W" data-hotkey-label="Open WhatsApp draft" type="button" className="primary" disabled={disabled} onClick={whatsapp}>Open WhatsApp</button></div>
    <DocumentShare title={`Invoice ${invoice.invoiceNumber}`} message={message} imageDocument={imageDocument} disabled={disabled}/>
    {feedback&&<p className="notice" role="status">{feedback}</p>}
  </section>;
}
