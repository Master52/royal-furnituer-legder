import React,{useEffect,useMemo,useRef,useState} from 'react';
import {CUT_UNITS,cuttingDimension} from './cuttingInput.js';
import {laminateEstimate} from './laminate.js';
import {laminateArea,laminateReportHtml} from './laminateReport.js';
import {money} from './ledger.js';
import {downloadText} from './preferences.js';
const initial={panels:'',panelUnit:'in',sheetWidth:'4',sheetHeight:'8',sheetUnit:'ft',faces:'1',waste:'10',price:''};
function UnitSelect({label,value,onChange}){return <select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>{Object.entries(CUT_UNITS).map(([key,unit])=><option key={key} value={key}>{unit.label}</option>)}</select>;}
export default function LaminatePanel({shopName}){
 const [input,setInput]=useState(initial),[exportError,setExportError]=useState(''),[mobileView,setMobileView]=useState('setup');
 const frameRef=useRef(null),timerRef=useRef(null);
 useEffect(()=>()=>{clearTimeout(timerRef.current);frameRef.current?.remove();},[]);
 const {result,error}=useMemo(()=>{if(!input.panels.trim())return {result:null,error:''};try{return {result:laminateEstimate(input),error:''};}catch(cause){return {result:null,error:cause.message};}},[input]);
 function update(key,value){setInput(previous=>({...previous,[key]:value}));setExportError('');}
 function report(){return laminateReportHtml(result,{shopName});}
 function download(){try{downloadText(report(),`laminate-estimate-${new Date().toISOString().slice(0,10)}.html`,'text/html;charset=utf-8');setExportError('');}catch{setExportError('Download could not start. Try Print / Save PDF.');}}
 function print(){
  try{
   clearTimeout(timerRef.current);frameRef.current?.remove();const frame=document.createElement('iframe');frameRef.current=frame;frame.title='Print laminate estimate';frame.setAttribute('aria-hidden','true');frame.style.cssText='position:fixed;left:-10000px;top:0;width:800px;height:1000px;border:0;';
   const cleanup=()=>{frame.remove();if(frameRef.current===frame)frameRef.current=null;clearTimeout(timerRef.current);};
   frame.onload=()=>{try{frame.contentWindow.addEventListener('afterprint',cleanup,{once:true});frame.contentWindow.focus();frame.contentWindow.print();timerRef.current=setTimeout(cleanup,120000);}catch{cleanup();setExportError('Printing is unavailable. Download the report to print it in your browser.');}};
   frame.srcdoc=report();document.body.append(frame);setExportError('');
  }catch{setExportError('Printing could not start. Download the report instead.');}
 }
 return <section className="tools-page laminate-page" aria-label="Laminate calculator" data-mobile-view={mobileView}>
  <div className="heading tools-heading"><div><h2>Laminate calculator</h2><p>Estimate surface coverage, sheet quantities and material cost.</p></div><span className="cutting-live">Live calculation</span></div>
  <div className="cutting-mobile-switch" role="group" aria-label="Laminate workspace"><button aria-pressed={mobileView==='setup'} onClick={()=>setMobileView('setup')}>Coverage & settings</button><button aria-pressed={mobileView==='plan'} disabled={!result} onClick={()=>setMobileView('plan')}>Material estimate</button></div>
  <div className="cutting-workspace">
   <aside className="cutting-inputs laminate-inputs" aria-label="Laminate sizes and settings">
    <div className="cutting-editor-heading"><div><span className="cutting-eyebrow">JOB SETUP</span><h2>Coverage & materials</h2></div></div>
    <div className="cutting-input-section"><div className="cutting-field-heading"><label htmlFor="laminate-panels">Panel sizes</label><UnitSelect label="Laminate panel unit" value={input.panelUnit} onChange={value=>update('panelUnit',value)}/></div><textarea id="laminate-panels" aria-label="Laminate panel sizes" placeholder={'24x32x2\n30x12'} spellCheck="false" value={input.panels} onChange={event=>update('panels',event.target.value)}/><p className="help">Width × height × quantity. Mixed units: 2ft 3in 2soot x 4ft x 2.</p><label htmlFor="laminate-faces" className="laminate-spaced">Surface coverage</label><select id="laminate-faces" value={input.faces} onChange={event=>update('faces',event.target.value)}><option value="1">One face</option><option value="2">Both faces</option></select><p className="help">Both faces uses the same laminate on each side.</p></div>
    <div className="cutting-input-section"><div className="cutting-field-heading"><label htmlFor="laminate-width">Laminate sheet size</label><UnitSelect label="Laminate sheet unit" value={input.sheetUnit} onChange={value=>update('sheetUnit',value)}/></div><div className="laminate-dimensions"><input id="laminate-width" aria-label="Laminate sheet width" type="text" value={input.sheetWidth} onChange={event=>update('sheetWidth',event.target.value)}/><span aria-hidden="true">×</span><input aria-label="Laminate sheet height" type="text" value={input.sheetHeight} onChange={event=>update('sheetHeight',event.target.value)}/></div></div>
    <div className="cutting-input-section laminate-options"><div><label htmlFor="laminate-waste">Waste allowance (%)</label><input id="laminate-waste" inputMode="decimal" type="text" value={input.waste} onChange={event=>update('waste',event.target.value)}/></div><div><label htmlFor="laminate-price">Price per sheet (₹)</label><input id="laminate-price" inputMode="decimal" type="text" placeholder="Optional" value={input.price} onChange={event=>update('price',event.target.value)}/></div></div>
    {error&&<p className="cutting-error" role="alert">{error}</p>}
    <button className="primary cutting-view-plan" disabled={!result} onClick={event=>{setMobileView('plan');event.currentTarget.closest('.tools-page')?.scrollIntoView({behavior:'smooth',block:'start'});}}>View material estimate <span>→</span></button>
   </aside>
   <div className="cutting-results" role="region" aria-label="Laminate estimate">
    <div className="cutting-toolbar"><div><span className="cutting-eyebrow">RESULTS</span><h2>Material estimate</h2><p>Sheet quantities based on total area.</p></div><div><button className="outline" disabled={!result} onClick={download}>Download report</button><button className="primary" disabled={!result} onClick={print}>Print / Save PDF</button></div></div>
    {exportError&&<p role="alert" className="cutting-error">{exportError}</p>}
    {!result?<div className="cutting-empty laminate-empty"><span aria-hidden="true">▱</span><h2>{error?'Check your measurements':'Start with your panel sizes'}</h2><p>{error?'Correct the highlighted input to see the estimate.':'Enter the sizes and quantities of the surfaces you want to cover. Your estimate updates as you type.'}</p></div>:<>
     <div className="cutting-metrics laminate-metrics" aria-live="polite">{[['Net coverage',`${laminateArea(result.coverageSqft)} sq ft`],['With waste',`${laminateArea(result.requiredSqft)} sq ft`],['Sheets by area',result.sheets],['Sheet cost',result.costMinor===null?'—':money(result.costMinor)]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
     <div className="cutting-summary"><span>{result.panels} panels · {result.faces===2?'Both faces':'One face'} · {result.wastePercent}% waste allowance</span><span>Each sheet: {cuttingDimension(result.width,result.sheetUnit)} × {cuttingDimension(result.height,result.sheetUnit)} {result.sheetUnit} · {laminateArea(result.sheetAreaSqft)} sq ft</span></div>
     {result.tooLarge.length>0&&<p className="cutting-warning" role="alert">Panel rows {result.tooLarge.map(row=>row.id).join(', ')} do not fit this sheet size, even when rotated. Choose a larger sheet or plan joints.</p>}
     <div className="laminate-breakdown"><h3>Panel breakdown</h3><div className="cutting-table-scroll"><table><thead><tr><th>Size ({result.panelUnit})</th><th>Qty</th><th>Faces</th><th>Area (sq ft)</th></tr></thead><tbody>{result.rows.map(row=><tr key={row.id}><td>{cuttingDimension(row.width,result.panelUnit)} × {cuttingDimension(row.height,result.panelUnit)}</td><td>{row.quantity}</td><td>{result.faces}</td><td>{laminateArea(row.areaSqft)}</td></tr>)}</tbody></table></div><dl><div><dt>Additional waste allowance</dt><dd>{laminateArea(result.wasteSqft)} sq ft</dd></div><div><dt>Area of whole sheets purchased</dt><dd>{laminateArea(result.purchasedSqft)} sq ft</dd></div>{result.priceMinor!==null&&<div><dt>Price per sheet</dt><dd>{money(result.priceMinor)}</dd></div>}</dl></div>
     <p className="laminate-note">This is an area estimate. Actual sheet quantities depend on how panels fit, grain direction and trimming. Check the arrangement with <strong>Sheet cutting</strong>. Cost includes laminate sheets only.</p>
    </>}
   </div>
  </div>
 </section>;
}
