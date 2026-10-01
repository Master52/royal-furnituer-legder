import React,{useEffect,useRef} from 'react';

export default function RecordMenu({label,actions}){
  const ref=useRef(null);
  useEffect(()=>{
    const close=event=>{if(!ref.current?.contains(event.target))ref.current?.removeAttribute('open');};
    document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);
  },[]);
  return <details className="record-menu" ref={ref} onClick={event=>event.stopPropagation()} onKeyDown={event=>{if(event.key==='Escape'){ref.current.removeAttribute('open');ref.current.querySelector('summary').focus();event.stopPropagation();}}}>
    <summary aria-label={`More actions for ${label}`} title="More actions">⋮</summary>
    <div>{actions.map(action=><button type="button" key={action.label} disabled={action.disabled} title={action.reason||undefined} onClick={()=>{ref.current.removeAttribute('open');action.onClick();}}>{action.label}</button>)}</div>
  </details>;
}
