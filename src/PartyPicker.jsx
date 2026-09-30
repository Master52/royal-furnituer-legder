import React, { useId, useMemo, useState } from 'react';
import { findParties } from './accounts.js';

export default function PartyPicker({ parties, value, selectedId, onChange, onSelect, onCreate }) {
  const id=useId(), listId=`${id}-options`;
  const [open,setOpen]=useState(false);
  const [active,setActive]=useState(0);
  const matches=useMemo(()=>value.trim()?findParties(parties,value):[],[parties,value]);
  const expanded=open&&Boolean(value.trim());
  const index=Math.min(active,matches.length);
  function choose(option){setOpen(false);setActive(0);if(option<matches.length)onSelect(matches[option]);else onCreate();}
  function keyDown(event){
    if(event.isComposing||event.ctrlKey||event.metaKey||event.altKey)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();if(!value.trim())return;
      setOpen(true);setActive(previous=>!expanded?0:Math.max(0,Math.min(matches.length,previous+(event.key==='ArrowDown'?1:-1))));
    }else if(event.key==='Enter'&&expanded){event.preventDefault();choose(index);}
    else if(event.key==='Escape'&&expanded){event.preventDefault();event.stopPropagation();setOpen(false);}
  }
  return <div className="invoice-party-picker" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}}>
    <label htmlFor={id}>Party <kbd>Alt + Q</kbd></label>
    <input id={id} name="invoice-party" role="combobox" aria-autocomplete="list" aria-controls={expanded?listId:undefined} aria-expanded={expanded} aria-activedescendant={expanded?`${id}-${index}`:undefined}
      autoComplete="off" required placeholder="Start typing a party name or phone" value={value}
      onFocus={()=>setOpen(Boolean(value.trim())&&!selectedId)} onChange={event=>{onChange(event.target.value);setOpen(Boolean(event.target.value.trim()));setActive(0);}} onKeyDown={keyDown}/>
    {expanded&&<div id={listId} role="listbox" className="invoice-party-options">
      {matches.map((party,i)=><button id={`${id}-${i}`} key={party.id} type="button" role="option" tabIndex={-1} aria-selected={index===i} className={index===i?'active':''} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(i)}>
        <strong>{party.name}</strong><small>{party.phone||'No phone'}{party._pending?' · Saving…':''}</small>
      </button>)}
      {!matches.length&&<p>No matching party.</p>}
      <button id={`${id}-${matches.length}`} type="button" role="option" tabIndex={-1} aria-selected={index===matches.length} className={`invoice-new-party ${index===matches.length?'active':''}`} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(matches.length)}>＋ Create new party “{value.trim()}”</button>
    </div>}
  </div>;
}
