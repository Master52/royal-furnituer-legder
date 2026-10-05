import React,{useId,useMemo,useState} from 'react';
import {findCatalogue,catalogueRate} from './catalogue.js';
import {money} from './ledger.js';
export default function CataloguePicker({catalogue=[],item,index,type,inputRef,onChange,onSelect,onCompositionEnd}){
 const id=useId(),[open,setOpen]=useState(false),[active,setActive]=useState(0);
 const matches=useMemo(()=>findCatalogue(catalogue,item.description),[catalogue,item.description]);
 const expanded=open&&Boolean(item.description.trim()),current=Math.min(active,Math.max(0,matches.length-1));
 function select(record){onSelect(record);setOpen(false);setActive(0);}
 return <label className="catalogue-picker" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}}>Item {index+1}<input ref={inputRef} data-invoice-field="description" aria-label={`Item ${index+1} description`} required maxLength="300" role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded?id:undefined} aria-activedescendant={expanded&&matches.length?`${id}-${current}`:undefined} autoComplete="off" value={item.description} onFocus={()=>setOpen(Boolean(item.description.trim()))} onChange={event=>{onChange(event);setOpen(true);setActive(0);}} onCompositionEnd={onCompositionEnd} onKeyDown={event=>{
 if(event.isComposing||event.ctrlKey||event.metaKey||event.altKey)return;
 if(['ArrowUp','ArrowDown'].includes(event.key)&&matches.length){event.preventDefault();setOpen(true);setActive(previous=>Math.max(0,Math.min(matches.length-1,previous+(event.key==='ArrowDown'?1:-1))));}
 else if(event.key==='Enter'&&expanded){event.preventDefault();if(matches.length)select(matches[current]);else setOpen(false);}
 else if(event.key==='Escape'&&expanded){event.preventDefault();event.stopPropagation();setOpen(false);}
 }}/>{expanded&&<div id={id} role="listbox" aria-label="Item catalogue" className="invoice-party-options catalogue-options">{matches.map((record,i)=><button type="button" role="option" id={`${id}-${i}`} key={record.id} tabIndex={-1} aria-selected={i===current} className={i===current?'active':''} onMouseDown={event=>event.preventDefault()} onClick={()=>select(record)}><strong>{record.name}</strong><small>{String(record.billingUnit||'nos').toUpperCase()} · {money(catalogueRate(record,type))}</small></button>)}{!matches.length&&<p>New item — added to the catalogue when this invoice is saved.</p>}</div>}</label>;
}
