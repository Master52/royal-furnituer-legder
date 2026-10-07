import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
export default function FeedbackToast({message,onDismiss,action}){
 const [target,setTarget]=useState(document.body),[paused,setPaused]=useState(false);
 useEffect(()=>{if(!message)return;const locate=()=>setTarget([...document.querySelectorAll('dialog[open]')].at(-1)||document.body);locate();const observer=new MutationObserver(locate);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});return()=>observer.disconnect();},[message]);
 useEffect(()=>setPaused(false),[message]);
 useEffect(()=>{if(!message||paused)return;const timer=setTimeout(onDismiss,6000);return()=>clearTimeout(timer);},[message,onDismiss,paused]);
 if(!message)return null;
 return createPortal(<div className="feedback-toast" onMouseEnter={()=>setPaused(true)} onMouseLeave={()=>setPaused(false)} onFocusCapture={()=>setPaused(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))setPaused(false);}} role="status" aria-live="polite"><span className="toast-check" aria-hidden="true">✓</span><span>{message}</span>{action&&<button type="button" onClick={action.onClick}>{action.label}</button>}<button type="button" aria-label="Dismiss notification" onClick={onDismiss}>×</button></div>,target);
}
