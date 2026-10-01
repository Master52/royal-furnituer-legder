import React from 'react';
const types=[['sale','Sales invoice'],['purchase','Purchase invoice'],['credit','Credit note'],['debit','Debit note']];
export default function DocumentTypeSelector({value,onChange,disabled=false,notesOnly=false,invoiceType}){
  return <fieldset className="document-types" disabled={disabled}><legend>Document type</legend><div role="group" aria-label="Document type">{types.filter(([type])=>!notesOnly||['credit','debit'].includes(type)).map(([type,label],index)=><button type="button" key={type} data-tone={type==='sale'||type==='purchase'?type:invoiceType||'inactive'} data-document-type={value===type?'active':undefined} aria-pressed={value===type} onClick={()=>onChange(type)}><strong>{label}</strong>{!notesOnly&&<kbd>Alt + {index+1}</kbd>}</button>)}</div></fieldset>;
}
