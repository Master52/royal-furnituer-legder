import React,{createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import AccountDialog from './AccountDialog.jsx';
import './actionDialog.css';

const Context=createContext(null);
export function useActionDialog(){
 const value=useContext(Context);
 if(!value)throw new Error('Action dialogs require ActionDialogProvider.');
 return value;
}
function actionLabel(message){
 const verb=message.match(/^(Delete|Discard|Clear|Restore|Disconnect|Import|Apply|Remove|Cancel|Receive|Issue|Save|Change|Use|Stop|Interpret)/i)?.[1];
 return verb||'Continue';
}
export default function ActionDialogProvider({children}){
 const [pending,setPending]=useState(null),[reason,setReason]=useState('');
 const active=useRef(null),sequence=useRef(0);
 const settle=useCallback(value=>{const request=active.current;active.current=null;setPending(null);setReason('');request?.resolve(value);},[]);
 const ask=useCallback((message,needsReason=false)=>{
  // Ignore duplicate clicks while the current decision is open.
  if(active.current)return Promise.resolve(needsReason?null:false);
  return new Promise(resolve=>{const request={id:++sequence.current,message,needsReason,resolve};active.current=request;setReason('');setPending(request);});
 },[]);
 const confirmAction=useCallback(message=>ask(message),[ask]);
 const requestReason=useCallback(message=>ask(message,true),[ask]);
 useEffect(()=>()=>{active.current?.resolve(active.current.needsReason?null:false);active.current=null;},[]);
 const label=pending?actionLabel(pending.message):'';
 const destructive=/^(Delete|Discard|Clear|Remove|Cancel)$/i.test(label);
 return <Context.Provider value={{confirmAction,requestReason}}>{children}
  {pending&&<AccountDialog key={pending.id} title={pending.needsReason?`${label==='Continue'?'Change':label} · reason required`:destructive?`${label}?`:'Confirm change'} className="action-dialog" initialFocus={pending.needsReason?'textarea':'.action-cancel'} onClose={()=>settle(pending.needsReason?null:false)} onKeyDown={event=>event.stopPropagation()}>
   <form onSubmit={event=>{event.preventDefault();if(pending.needsReason&&!reason.trim())return;settle(pending.needsReason?reason.trim():true);}}>
    <p className="action-message">{pending.message}</p>
    {pending.needsReason&&<label>Reason<textarea aria-label="Reason for this change" required maxLength="1000" rows="3" value={reason} onChange={event=>setReason(event.target.value)}/></label>}
    <div className="action-dialog-buttons"><button type="button" className="outline action-cancel" onClick={()=>settle(pending.needsReason?null:false)}>Go back</button><button type="submit" className={destructive?'primary action-destructive':'primary'} disabled={pending.needsReason&&!reason.trim()}>{label}</button></div>
   </form>
  </AccountDialog>}
 </Context.Provider>;
}
