export const TIMINGS_CHANGED_EVENT='rf:request-timings';
const samples=[];
const metrics=['elapsedMs','lockWaitMs','reads','readMs','validationMs','writes','writeMs'];
export function recordRequestTiming(endpoint,{action,durationMs,attempt,status,result}){
  const backend={};
  for(const key of metrics){const value=result?.performance?.[key];if(Number.isFinite(value)&&value>=0)backend[key]=Math.round(value);}
  samples.push({endpoint,time:new Date().toISOString(),action:/^[a-zA-Z]{1,40}$/.test(action)?action:'unknown',durationMs:Math.max(0,Math.round(durationMs)),attempt,status,backendVersion:/^\d+\.\d+\.\d+$/.test(result?.backendVersion||'')?result.backendVersion:'unknown',backend});
  if(samples.length>30)samples.shift();
  try{if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(TIMINGS_CHANGED_EVENT));}catch{/* Diagnostics must not interrupt ledger requests. */}
}
export function requestTimingReport(endpoint){
  return JSON.stringify({capturedAt:new Date().toISOString(),requests:samples.filter(row=>row.endpoint===endpoint).map(({endpoint,...row})=>row)},null,2);
}
