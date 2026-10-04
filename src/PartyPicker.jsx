import React, { useId, useMemo, useState } from 'react';
import {money} from './ledger.js';
import { findParties } from './accounts.js';

function SuggestionBalance({balance,loaded,cached,refreshing}) {
  const available=loaded&&Number.isSafeInteger(balance);
  const tone=available?(balance>0?'positive':balance<0?'negative':'zero'):'unknown';
  return <span className="party-suggestion-balance" data-balance={tone}>
    {available?<><strong>{balance>0?'+':balance<0?'−':''}{money(Math.abs(balance))}</strong><small>{balance>0?'They owe you':balance<0?'You owe them':'Settled'}</small></>:<small>Balance unavailable</small>}
    {(cached||refreshing)&&<small>{refreshing?'Updating…':'Saved balance'}</small>}
  </span>;
}

export default function PartyPicker({ parties, value, selectedId, onChange, onSelect, onCreate, disabled = false, balances = [], balancesLoaded = false, balancesCached = false, balancesRefreshing = false, allowNameOnly = false, required = true, label = 'Party', inputName = 'invoice-party', shortcut }) {
  const id=useId(), listId=`${id}-options`;
  const [open,setOpen]=useState(false);
  const [active,setActive]=useState(0);
  const matches=useMemo(()=>value.trim()?findParties(parties,value):[],[parties,value]);
  const balanceById=useMemo(()=>new Map(balances.map(row=>[row.party.id,row.balance])),[balances]);
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
    <label htmlFor={id}>{label} <kbd>Alt + Q</kbd></label>
    <input id={id} disabled={disabled} name={inputName} data-shortcut={shortcut} maxLength="150" role="combobox" aria-autocomplete="list" aria-controls={expanded?listId:undefined} aria-expanded={expanded} aria-activedescendant={expanded?`${id}-${index}`:undefined}
      autoComplete="off" required={required} placeholder="Start typing a party name or phone" value={value}
      onFocus={()=>setOpen(Boolean(value.trim())&&!selectedId)} onChange={event=>{onChange(event.target.value);setOpen(Boolean(event.target.value.trim()));setActive(0);}} onKeyDown={keyDown}/>
    {expanded&&<div id={listId} role="listbox" aria-label="Matching parties" className="invoice-party-options">
      {matches.map((party,i)=><button id={`${id}-${i}`} key={party.id} type="button" role="option" tabIndex={-1} aria-selected={index===i} className={index===i?'active':''} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(i)}>
        <span className="party-suggestion-contact"><strong>{party.name}</strong><small>{party.phone||'No phone'}{party._pending?' · Saving…':''}</small></span><SuggestionBalance balance={balanceById.get(party.id)} loaded={balancesLoaded} cached={balancesCached} refreshing={balancesRefreshing}/>
      </button>)}
      {!matches.length&&<p>No matching party.</p>}
      <button id={`${id}-${matches.length}`} type="button" role="option" tabIndex={-1} aria-selected={index===matches.length} className={`invoice-new-party ${index===matches.length?'active':''}`} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(matches.length)}>{allowNameOnly?`Use “${value.trim()}” without linking a party`:`＋ Create new party “${value.trim()}”`}</button>
    </div>}
  </div>;
}
