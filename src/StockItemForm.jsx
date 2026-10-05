import React from 'react';
import {STOCK_UNITS} from './stock.js';
import {UnitSelect} from './StockImport.jsx';
export const blankStockItem=()=>({name:'',code:'',category:'',baseUnit:'',secondaryUnit:'',conversion:'',lowStock:'',salePrice:'0',purchasePrice:'0',saleRateUnit:'',purchaseRateUnit:''});
export function stockItemDraft(item){return {name:item.name,code:item.code,category:item.category,baseUnit:item.baseUnit,secondaryUnit:item.secondaryUnit||'',conversion:item.secondaryUnit?item.conversion:'',lowStock:item.lowStock,salePrice:String(item.saleRateMinor/100),purchasePrice:String(item.purchaseRateMinor/100),saleRateUnit:item.saleRateUnit||item.baseUnit,purchaseRateUnit:item.purchaseRateUnit||item.baseUnit};}
export default function StockItemForm({value,onChange,editing=false,blocked,error,onSubmit}){
 const units=[value.baseUnit,value.secondaryUnit].filter(Boolean);
 const update=(key,next)=>onChange({...value,[key]:next});
 function secondary(next){onChange({...value,secondaryUnit:next,conversion:'',saleRateUnit:value.saleRateUnit===value.secondaryUnit?'':value.saleRateUnit,purchaseRateUnit:value.purchaseRateUnit===value.secondaryUnit?'':value.purchaseRateUnit});}
 return <form className="stock-item-form" data-shortcut-form onSubmit={onSubmit}><fieldset disabled={blocked}><div className="stock-form-grid">
 {[['name','Item name'],['code','Model / item code'],['category','Category'],['salePrice','Sale price (₹)'],['purchasePrice','Purchase price (₹)'],['lowStock','Low-stock threshold (base unit)']].map(([key,title])=><label key={key}>{title}<input aria-label={title} required={key==='name'} maxLength={key==='name'?300:100} inputMode={['salePrice','purchasePrice','lowStock'].includes(key)?'decimal':undefined} value={value[key]} onChange={e=>update(key,e.target.value)}/></label>)}
 <UnitSelect label="Base stock unit" required disabled={editing} value={value.baseUnit} onChange={baseUnit=>onChange({...value,baseUnit,secondaryUnit:'',conversion:'',saleRateUnit:baseUnit,purchaseRateUnit:baseUnit})}/>
 <UnitSelect label="Secondary stock unit" optional units={STOCK_UNITS.filter(unit=>unit!==value.baseUnit)} value={value.secondaryUnit} onChange={secondary}/>
 {value.secondaryUnit&&<label>1 {value.secondaryUnit} contains ({value.baseUnit})<input aria-label="Secondary unit conversion" required inputMode="decimal" value={value.conversion} onChange={e=>update('conversion',e.target.value)}/></label>}
 <UnitSelect label="Sale price unit" required units={units} value={value.saleRateUnit} onChange={unit=>update('saleRateUnit',unit)}/><UnitSelect label="Purchase price unit" required units={units} value={value.purchaseRateUnit} onChange={unit=>update('purchaseRateUnit',unit)}/>
 </div></fieldset><p className="help">{editing?'Base unit and current stock stay unchanged. Secondary-unit changes apply to future movements; old conversions remain recorded. Review rate amounts when changing their price units.':'Stock starts at zero. You can add a secondary unit now or later through Edit.'}</p>{error&&<p className="error" role="alert">{error}</p>}<button type="submit" className="primary" disabled={blocked}>{editing?'Save item settings':'Add item with zero stock'}</button></form>;
}
