import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

let scrollLocks=0,originalOverflow='';
function lockBodyScroll(){
  if(scrollLocks++===0){originalOverflow=document.body.style.overflow;document.body.style.overflow='hidden';}
  let released=false;
  return ()=>{if(released)return;released=true;if(--scrollLocks===0)document.body.style.overflow=originalOverflow;};
}

export default function AccountDialog({ title, onClose, busy = false, className = '', initialFocus = null, onKeyDown, children }) {
  const dialog = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const release=lockBodyScroll();
    try{element.showModal();}catch(error){release();throw error;}
    return ()=>{element.close();release();};
  }, []);
  useEffect(()=>{if(initialFocus)dialog.current?.querySelector(initialFocus)?.focus();},[initialFocus]);
  return createPortal(
    <dialog ref={dialog} className={`account-dialog ${className}`} aria-labelledby={titleId} onKeyDown={onKeyDown}
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
      <div className="account-dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" className="outline" disabled={busy} onClick={onClose} aria-label="Close popup" title="Close popup (Escape)">Close</button></div>
      {children}
    </dialog>, document.body
  );
}
