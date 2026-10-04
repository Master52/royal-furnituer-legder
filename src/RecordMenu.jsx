import {shortcutAria} from './keyboard.js';
import React,{useEffect,useRef} from 'react';

export default function RecordMenu({label,actions}){
  const ref=useRef(null);
  useEffect(()=>{
    const close=event=>{if(!ref.current?.contains(event.target))ref.current?.removeAttribute('open');};
    document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);
  },[]);
  return <details className="record-menu" ref={ref} onClick={event=>event.stopPropagation()} onKeyDown={event=>{
      if(event.key==='Escape'){event.preventDefault();ref.current.removeAttribute('open');ref.current.querySelector('summary').focus();event.stopPropagation();return;}
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||event.altKey||event.ctrlKey||event.metaKey)return;
      const buttons=[...ref.current.querySelectorAll('button:not(:disabled)')];if(!buttons.length)return;
      event.preventDefault();event.stopPropagation();ref.current.setAttribute('open','');
      const index=buttons.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:index<0?(event.key==='ArrowUp'?buttons.length-1:0):(index+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length;
      buttons[next].focus();
    }}>
    <summary aria-label={`More actions for ${label}`} title="More actions">⋮</summary>
    <div>{actions.map(action=><button data-hotkey={action.shortcut} aria-keyshortcuts={shortcutAria(action.shortcut)} data-hotkey-label={action.label} type="button" className={/^Delete\b/.test(action.label)?'danger-action':undefined} key={action.label} disabled={action.disabled} title={action.reason||undefined} onClick={()=>{ref.current.removeAttribute('open');ref.current.querySelector('summary').focus();action.onClick();}}>{action.label}</button>)}</div>
  </details>;
}
