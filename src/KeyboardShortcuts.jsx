import React,{useEffect,useState} from 'react';
import AccountDialog from './AccountDialog.jsx';
import {keyboardChord,shortcutLabel,shortcutScope,shortcutAvailable,activateShortcut} from './keyboard.js';

const navigation=[['alt+shift+1','Dashboard'],['alt+shift+2','Parties'],['alt+shift+3','History'],['alt+shift+4','Settings'],['mod+k','Search this page'],['alt+/','Shortcut guide']];
const entryGuides={
 payment:[['alt+enter','Amount'],['alt+i','Payment in'],['alt+o','Payment out'],['alt+1','Sale'],['alt+2','Purchase'],['alt+3','Bhara'],['alt+4','Expense'],['alt+c','Cash'],['alt+l','Online'],['alt+q','Party / Payee'],['alt+v','Notes'],['alt+r','Cash received'],['alt+h','Cash change'],['alt+j','Online change']],
 invoice:[['alt+1','Sales invoice'],['alt+2','Purchase invoice'],['alt+3','Credit note'],['alt+4','Debit note'],['alt+q','Party'],['alt+d','Date'],['alt+h','Challan'],['alt+a','Add item'],['alt+j','Item name'],['alt+u','Quantity'],['alt+b','Billing unit'],['alt+l','Length'],['alt+w','Width'],['alt+f','Pieces'],['alt+z','Add grouped size'],['alt+r','Rate'],['alt+c','Cost price'],['alt+x','Discount'],['alt+v','Invoice notes'],['alt+g','Show / hide profit']],
 note:[['alt+3','Credit note'],['alt+4','Debit note'],['alt+q','Party'],['alt+i','Original invoice'],['alt+m','Amount'],['alt+r','Reason'],['alt+d','Date'],['alt+e','Cost treatment'],['alt+c','Cost correction']]
};
function currentGuide(){
 const scope=shortcutScope(),map=new Map();
 const kind=scope?.querySelector('.invoice-form [data-note-field]')?'note':scope?.matches('.account-invoice-dialog')?'invoice':scope?.matches('.payment-dialog')?'payment':'';
 for(const item of entryGuides[kind]||[])map.set(...item);
 scope?.querySelectorAll('[data-hotkey]').forEach(element=>{if(shortcutAvailable(element,true))map.set(element.dataset.hotkey,element.dataset.hotkeyLabel||element.getAttribute('aria-label')||[...element.labels?.[0]?.childNodes||[]].find(node=>node.nodeType===3)?.textContent.trim()||element.textContent.trim());});
 if(scope?.querySelector('form'))map.set('mod+enter','Save / submit the current form');
 return {title:scope?.querySelector('h2')?.textContent||'Current page',items:[...map]};
}
export default function KeyboardShortcuts({onNavigate,onSettings,onSearch}){
 const [guide,setGuide]=useState(null);
 const openGuide=()=>setGuide(currentGuide());
 useEffect(()=>{
  const handler=event=>{
   const chord=keyboardChord(event);if(!chord)return;
   if(chord==='alt+/'){event.preventDefault();if(!guide)openGuide();return;}
   if(guide){event.preventDefault();return;}
   const scope=shortcutScope(),inDialog=scope?.matches('dialog');
   if(!inDialog&&/^alt\+shift\+[1-4]$/.test(chord)){event.preventDefault();const digit=chord.at(-1);if(digit==='4')onSettings();else onNavigate({1:'dashboard',2:'accounts',3:'history'}[digit]);return;}
   if(chord==='mod+k'){
    const search=[...scope?.querySelectorAll('input[type=search],.invoice-party-picker input[role=combobox]')||[]].find(element=>shortcutAvailable(element));
    if(search){event.preventDefault();activateShortcut(search);}else if(!inDialog){event.preventDefault();onSearch();}
    return;
   }
   const candidates=[...scope?.querySelectorAll('[data-hotkey]')||[]].filter(element=>element.dataset.hotkey===chord);
   const focusedRow=document.activeElement?.closest('.invoice-item-editor');
   const focusedRecord=document.activeElement?.closest('.activity-row');
   if(focusedRecord&&['alt+e','alt+p','alt+m'].includes(chord))return;
   const available=candidates.filter(element=>shortcutAvailable(element));
   const target=available.find(element=>focusedRow?.contains(element))||available.find(element=>element.getClientRects().length)||available[0];
   if(target){event.preventDefault();activateShortcut(target);return;}
   // Only annotated forms use generic submit; specialized editors retain their handlers.
   if(chord==='mod+enter'){
    const focused=document.activeElement?.closest('form[data-shortcut-form]');
    const form=focused||[...scope?.querySelectorAll('form[data-shortcut-form]')||[]].find(element=>shortcutAvailable(element));
    const submit=form?.querySelector('button:not([type]),button[type=submit],input[type=submit]');
    if(submit&&shortcutAvailable(submit)){event.preventDefault();form.requestSubmit(submit);}
   }
  };
  window.addEventListener('keydown',handler,true);return()=>window.removeEventListener('keydown',handler,true);
 },[guide,onNavigate,onSettings,onSearch]);
 return <><button type="button" className="outline shortcut-guide-button" title="Keyboard shortcuts (Alt + /)" aria-keyshortcuts="Alt+/" onClick={openGuide}>⌨ Shortcuts</button>{guide&&<AccountDialog className="shortcut-guide-dialog" title="Keyboard shortcuts" onClose={()=>setGuide(null)}><p className="help">Field shortcuts focus and center the field. Arrow keys and Enter choose party suggestions. Tab / Shift + Tab move through controls; Escape closes popups. Disabled actions stay unavailable.</p><h3>Navigation</h3><dl className="shortcut-guide-list">{navigation.map(([key,label])=><div key={key}><dt><kbd>{shortcutLabel(key)}</kbd></dt><dd>{label}</dd></div>)}</dl><h3>{guide.title}</h3><dl className="shortcut-guide-list">{guide.items.map(([key,label])=><div key={key}><dt><kbd>{shortcutLabel(key)}</kbd></dt><dd>{label}</dd></div>)}</dl><p className="help">Navigation shortcuts apply outside popups. In History, focus a record and use Alt + E to edit, Alt + P to print or Alt + M for its actions. Delete remains an explicit action.</p></AccountDialog>}</>;
}
