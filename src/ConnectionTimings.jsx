import React,{useEffect,useState} from 'react';
import {requestTimingReport,TIMINGS_CHANGED_EVENT} from './requestTimings.js';
export default function ConnectionTimings({endpoint}){
 const [report,setReport]=useState(()=>requestTimingReport(endpoint)),[message,setMessage]=useState('');
 useEffect(()=>{const update=()=>setReport(requestTimingReport(endpoint));update();window.addEventListener(TIMINGS_CHANGED_EVENT,update);return()=>window.removeEventListener(TIMINGS_CHANGED_EVENT,update);},[endpoint]);
 async function copy(){try{await navigator.clipboard.writeText(report);setMessage('Timings copied. Paste them into the chat.');}catch{setMessage('Copy is unavailable. Select and copy the report below.');}}
 return <details className="setup-step"><summary>Sync timing details</summary><p>Refresh records, reproduce the slow action, then copy this report. It contains request timings and action names, without tokens, Sheet URLs, names or financial records.</p><button type="button" className="outline" onClick={copy}>Copy sync timings</button><p role="status" className="help">{message}</p><textarea aria-label="Sync timing report" readOnly rows="8" value={report} onFocus={event=>event.target.select()}/></details>;
}
