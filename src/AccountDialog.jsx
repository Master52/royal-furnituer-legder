import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function AccountDialog({ title, onClose, busy = false, className = '', initialFocus = null, onKeyDown, children }) {
  const dialog = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    if(initialFocus)element.querySelector(initialFocus)?.focus();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [initialFocus]);
  return createPortal(
    <dialog ref={dialog} className={`account-dialog ${className}`} aria-labelledby={titleId} onKeyDown={onKeyDown}
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
      <div className="account-dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" className="outline" disabled={busy} onClick={onClose} aria-label="Close popup" title="Close popup (Escape)">Close</button></div>
      {children}
    </dialog>, document.body
  );
}
