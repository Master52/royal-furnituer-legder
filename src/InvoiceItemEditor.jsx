import React, {memo,useLayoutEffect,useRef} from 'react';
import {BILLING_UNITS,blankMeasurement,billingPreview,billingPrice_,billingQuantityText} from './measurements.js';
import {minor} from './accounts.js';
import {money} from './ledger.js';
import {focusAndCenter} from './entry.js';

export default memo(function InvoiceItemEditor({item,index,type,onChange,onRemove,removeDisabled,measurementEnabled,itemDescriptionsEnabled}){
  const unit=item.billingUnit||'',sizes=item.measurements||[],dimensions=['sqft','rft'].includes(unit),grouped=Boolean(item.grouped||sizes.length>1||(!dimensions&&sizes.length>0));
  const prefix='Item '+(index+1);
  const nameInput=useRef(null),nameSelection=useRef(null);
  useLayoutEffect(()=>{const input=nameInput.current,selection=nameSelection.current;nameSelection.current=null;if(input&&selection&&document.activeElement===input)input.setSelectionRange(...selection);},[item]);
  let quantity=null,amount=null,issue='';
  try{quantity=billingPreview(item);if(item.rate!=='')amount=billingPrice_(minor(item.rate,'rate'),quantity)-minor(item.discount||'0','discount');if(amount<0)throw new Error('Discount exceeds the item value.');}catch(error){issue=error.message;}
  const update=(field,value)=>onChange(index,{...item,[field]:value});
  function updateName(event){
    const input=event.currentTarget,value=input.value;
    if(event.nativeEvent?.isComposing){update('description',value);return;}
    const start=input.selectionStart,end=input.selectionEnd;
    nameSelection.current=start!==null&&end!==null?[value.slice(0,start).toUpperCase().length,value.slice(0,end).toUpperCase().length]:null;
    update('description',value.toUpperCase());
  }
  function selectUnit(value){
    if(sizes.some(row=>row.length||row.width||row.description||row.quantity!=='1'||row.pieces!=='1')&&!window.confirm('Change billing unit and clear this item’s measurement rows?'))return;
    const measured=['sqft','rft'].includes(value);
    onChange(index,{...item,billingUnit:value|| (grouped?'nos':''),grouped,measurementMode:measured?'dimensions':'quantity',measurements:measured||grouped?[{...blankMeasurement(),quantity:item.quantity}]:[]});
  }
  function toggleGrouping(enabled){
    if(enabled){onChange(index,{...item,grouped:true,billingUnit:unit||'nos',measurements:sizes.length?sizes:[{...blankMeasurement(),quantity:item.quantity}]});return;}
    if(dimensions){if(sizes.length>1&&!window.confirm('Stop grouping and keep only the first size? The other sizes will be removed from this draft.'))return;onChange(index,{...item,grouped:false,measurements:sizes.slice(0,1)});return;}
    try{const total=billingPreview(item).quantityMilli;onChange(index,{...item,grouped:false,quantity:String(total/1000),measurements:[]});}catch{window.alert('Complete the grouped quantities before combining them into a single quantity.');}
  }
  function updateSize(rowIndex,field,value){update('measurements',sizes.map((row,i)=>i===rowIndex?{...row,[field]:value}:row));}
  function addSize(root){
    if(!grouped||sizes.length>=100)return;
    const rows=sizes.length?sizes:[{...blankMeasurement(),quantity:item.quantity}];
    update('measurements',[...rows,blankMeasurement()]);
    setTimeout(()=>focusAndCenter(root?.querySelector('.measurement-row:last-child input')),0);
  }
  function keys(event){
    if(event.defaultPrevented||!event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.repeat||event.isComposing)return;
    const root=event.currentTarget,row=event.target.closest('.measurement-row')||root.querySelector('.measurement-row'),key=event.key.toLowerCase();
    const field={l:'length',w:'width',f:'pieces'}[key];
    const target=key==='b'?root.querySelector('[data-invoice-field=unit]'):field?row?.querySelector('[data-size-field='+field+']'):null;
    if(key==='z'&&grouped){event.preventDefault();event.stopPropagation();addSize(root);}else if(target){event.preventDefault();event.stopPropagation();focusAndCenter(target);}
  }
  const quantityLabel=quantity?(unit?billingQuantityText(quantity,unit):String(quantity.quantityMilli/1000)+' QTY'):'Enter measurements';
  return <div className="invoice-item-editor" onKeyDown={keys}>
    <div className="invoice-item-fields" data-grouped={grouped||dimensions} data-type={type}>
    <label>{prefix}<input ref={nameInput} data-invoice-field="description" aria-label={prefix+' description'} required maxLength="300" value={item.description} onChange={updateName} onCompositionEnd={updateName}/></label>
    <label>Billing unit<select data-invoice-field="unit" aria-label={prefix+' billing unit'} disabled={!measurementEnabled} value={unit||'nos'} onChange={e=>selectUnit(e.target.value)}>{Object.entries(BILLING_UNITS).map(([value,label])=><option key={value} value={value}>{label.toUpperCase()}</option>)}</select></label>
    {!grouped&&!dimensions&&<label>{unit==='kg'?'Weight (kg)':'Quantity'}<input data-invoice-field="quantity" type="number" min="0.001" max="1000000" step="0.001" required value={item.quantity} onChange={e=>update('quantity',e.target.value)}/></label>}
    <label>Rate (₹)<input aria-label="Rate (₹)" data-invoice-field="rate" type="number" min="0" step="0.01" required value={item.rate} onChange={e=>update('rate',e.target.value)}/></label>
    {type==='sale'&&<label>CP (₹)<input aria-label="Cost price (₹)" data-invoice-field="cost" type="number" min="0" step="0.01" value={item.cost} onChange={e=>update('cost',e.target.value)} placeholder="Optional"/></label>}
    <label>Description<input data-hotkey="alt+shift+v" aria-keyshortcuts="Alt+Shift+V" aria-label={prefix+' additional description'} disabled={!itemDescriptionsEnabled} title={itemDescriptionsEnabled?undefined:'Deploy backend 1.15.2 to save item descriptions'} maxLength="500" value={item.itemNote||''} placeholder="Optional" onChange={e=>update('itemNote',e.target.value)}/></label>
    <button type="button" className="outline" disabled={removeDisabled} onClick={()=>onRemove(index)}>Remove</button>
    </div>
    {Number(item.discount)>0&&<small className="legacy-item-discount">Existing item discount: {money(Math.round(Number(item.discount)*100))} (preserved)</small>}
    <div className="item-grouping-control"><label><input data-hotkey="alt+shift+g" aria-keyshortcuts="Alt+Shift+G" type="checkbox" aria-label={prefix+' group items'} checked={grouped} disabled={!measurementEnabled} onChange={e=>toggleGrouping(e.target.checked)}/> GROUP ITEMS</label></div>
    {(dimensions||grouped)&&<section className="item-measurements" aria-label={prefix+' measurements'}>
      <div className="measurement-entry">
      {dimensions&&<div className="measurement-options"><label>Dimensions in<select aria-label={prefix+' measurement unit'} value={item.measurementUnit||'feet'} onChange={e=>{if(sizes.some(row=>row.length||row.width)&&!window.confirm('Interpret the entered dimensions as '+e.target.value+'?'))return;update('measurementUnit',e.target.value);}}><option value="feet">Feet</option><option value="inches">Inches</option></select></label>{unit==='rft'&&<label>Calculate<select aria-label={prefix+' calculation'} value={item.measurementMode} onChange={e=>update('measurementMode',e.target.value)}><option value="dimensions">Length × pieces</option><option value="perimeter">Frame perimeter × pieces</option></select></label>}</div>}
      {sizes.length>0&&<div className="measurement-rows">{sizes.map((row,rowIndex)=><div className="measurement-row" key={rowIndex}>
        {(dimensions?['length',...(unit==='sqft'||item.measurementMode==='perimeter'?['width']:[])]:['quantity']).map(field=><label key={field}>{field==='quantity'?(unit==='kg'?'Weight (kg)':'Quantity'):field==='length'?'Length':'Width'}<input data-size-field={field} aria-label={prefix+' size '+(rowIndex+1)+' '+field} type="number" min="0.001" max="1000000" step="0.001" required value={row[field]} onChange={e=>updateSize(rowIndex,field,e.target.value)}/></label>)}
        <label>Pieces<input data-size-field="pieces" aria-label={prefix+' size '+(rowIndex+1)+' pieces'} type="number" min="1" max="1000000" step="1" required value={row.pieces} onChange={e=>updateSize(rowIndex,'pieces',e.target.value)}/></label>
        {grouped&&<label className="measurement-description">Description<input aria-label={prefix+' size '+(rowIndex+1)+' description'} maxLength="150" value={row.description} placeholder="Optional" onChange={e=>updateSize(rowIndex,'description',e.target.value)}/></label>}
        {grouped&&<button type="button" className="outline" aria-label={'Remove item '+(index+1)+' size '+(rowIndex+1)} disabled={sizes.length===1} onClick={()=>update('measurements',sizes.filter((_,i)=>i!==rowIndex))}>Remove size</button>}
      </div>)}</div>}
      {grouped&&<button type="button" className="outline" disabled={!measurementEnabled||sizes.length>=100} onClick={e=>addSize(e.currentTarget.closest('.invoice-item-editor'))}>{dimensions?'＋ Add size':'＋ Add quantity row'} <kbd>Alt + Z</kbd></button>}
      {issue&&<small className="help">{issue}</small>}
      </div>
      <aside className="measurement-total" role="status"><span>{grouped?'Group total':'Item total'}</span><strong>{quantityLabel}</strong><strong className="measurement-amount">{amount!==null&&amount>=0?money(amount):'—'}</strong><small>{sizes.reduce((sum,row)=>sum+(Number(row.pieces)||0),0)} pieces · shared rate{type==='sale'?' / CP':''}</small></aside>
    </section>}
    {!measurementEnabled&&<small className="help measurement-upgrade">Deploy backend 1.15.0 to enable billing units and grouped sizes.</small>}
  </div>;
});
