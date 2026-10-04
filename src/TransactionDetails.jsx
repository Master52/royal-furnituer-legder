import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import RecordMenu from './RecordMenu.jsx';
import AccountDialog from './AccountDialog.jsx';
import { money, SHOP_TIMEZONE, transactionIntegrityIssue } from './ledger.js';

function timestamp(value){
  if(!value)return '—';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?String(value):date.toLocaleString();
}

function TransactionContent({transaction,queued,duplicate=false}){
  const transfer=transaction.recordType==='transfer',adjustment=transaction.recordType==='adjustment';
  const type=adjustment?'Balance adjustment':transfer?'Cash/Online exchange':transaction.direction==='in'?'Payment received':'Payment made';
  const issue=duplicate?'This transaction ID is duplicated. Its figures are excluded from totals.':transactionIntegrityIssue(transaction);
  const fields=[['Party',transaction.party||'—'],['Category',transaction.category],['Date',transaction.transactionDate],['Time',`${transaction.transactionTime} · ${transaction.timezone||SHOP_TIMEZONE}`]];
  if(transfer)fields.push(['From',transaction.fromMethod],['To',transaction.toMethod]);
  else if(!adjustment){
    fields.push(['Payment method',transaction.method]);
    if(transaction.method==='Cheque')fields.push(['Cheque given date',transaction.chequeDate||'—']);
    if(transaction.cashReceivedMinor!==''&&transaction.cashReceivedMinor!=null)fields.push(['Cash received',money(transaction.cashReceivedMinor)],['Cash change returned',money(transaction.cashChangeMinor||0)],['Online change returned',money(transaction.onlineChangeMinor||0)]);
  }
  if(adjustment){
    for(const [label,prefix] of [['Cash','Cash'],['Online','Online']])fields.push([`${label} expected`,money(transaction[`expected${prefix}Minor`])],[`${label} counted`,money(transaction[`counted${prefix}Minor`])],[`${label} adjustment`,money(transaction[`${label.toLowerCase()}AdjustmentMinor`])]);
  }
  if(transaction.settlementDiscountMinor!==undefined&&transaction.settlementDiscountMinor!==null&&transaction.settlementDiscountMinor!=='')fields.push(['Full & final discount',money(transaction.settlementDiscountMinor)],['Total party balance settled',money(Number(transaction.amountMinor)+Number(transaction.settlementDiscountMinor))]);
  return <>
    {issue&&<p className="error" role="alert">{issue}</p>}
    <div className="transaction-detail-summary"><span>{type}</span><strong>{money(transaction.amountMinor)}</strong><small>{queued?queued._status==='failed'?'Upload failed · saved on this device':'Pending upload · saved on this device':'Recorded in the current ledger'}</small></div>
    {queued?._error&&<p className="error" role="alert">{queued._error}</p>}
    {transfer&&<p className="help">Moves money between cash and online balances. It does not count as income or expense.</p>}
    {adjustment&&<p className="help">Corrects the recorded cash or online balance. It does not count as income or expense.</p>}
    <dl className="transaction-detail-fields">{fields.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'—'}</dd></div>)}<div className="transaction-detail-notes"><dt>Notes</dt><dd>{transaction.notes||'No notes'}</dd></div></dl>
    <details className="transaction-record-info"><summary>Record information</summary><dl className="transaction-detail-fields"><div><dt>Transaction ID</dt><dd>{transaction.id}</dd></div><div><dt>Created</dt><dd>{timestamp(transaction.createdAt)}</dd></div>{transaction.updatedAt&&<div><dt>Last updated</dt><dd>{timestamp(transaction.updatedAt)}</dd></div>}</dl></details>
  </>;
}

export default function TransactionDetails({transaction,queued,duplicate=false,preferences,initialAction,onPreparePrint,onEdit,onDelete,onClose}){
  const [preparing,setPreparing]=useState(false),[printing,setPrinting]=useState(false),[snapshot,setSnapshot]=useState(null),[error,setError]=useState('');
  const requested=useRef(false);
  async function print(){
    if(preparing||printing||queued||duplicate)return;setPreparing(true);setError('');
    try{const record=await onPreparePrint();if(transactionIntegrityIssue(record))throw new Error('Correct this payment before printing.');setSnapshot(record);setPrinting(true);}catch(error){setError(error.message);}finally{setPreparing(false);}
  }
  useEffect(()=>{if(initialAction==='print'&&!requested.current){requested.current=true;print();}},[initialAction]);
  useEffect(()=>{if(!printing)return;document.body.dataset.accountPrint='payment';const timer=setTimeout(()=>window.print(),0);const done=()=>{delete document.body.dataset.accountPrint;setPrinting(false);};window.addEventListener('afterprint',done);return()=>{clearTimeout(timer);window.removeEventListener('afterprint',done);if(document.body.dataset.accountPrint==='payment')delete document.body.dataset.accountPrint;};},[printing]);
  return <><AccountDialog className="transaction-detail-dialog" title="Transaction details" busy={preparing||printing} onClose={onClose}>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="invoice-popup-actions"><button data-hotkey="alt+e" aria-keyshortcuts="Alt+E" data-hotkey-label="Edit payment" type="button" className="outline" disabled={!!queued||preparing||printing} onClick={onEdit}>Edit payment</button><RecordMenu label={transaction.party||transaction.category} actions={[{label:'Print payment',shortcut:'alt+p',disabled:!!queued||duplicate||preparing||printing,onClick:print},{label:'Delete payment',disabled:!!queued||preparing||printing,onClick:onDelete}]}/></div>
    <TransactionContent transaction={transaction} queued={queued} duplicate={duplicate}/>
  </AccountDialog>{printing&&snapshot&&createPortal(<div className="account-print-output"><section className="invoice-document"><header className="invoice-document-header"><div><h1>{preferences.shopName}</h1>{preferences.printContact&&<p>{preferences.address}<br/>{preferences.phone}</p>}</div><h2>Payment statement</h2></header><TransactionContent transaction={snapshot}/></section></div>,document.body)}</>;
}
