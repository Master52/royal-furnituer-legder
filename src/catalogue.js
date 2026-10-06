import {blankMeasurement} from './measurements.js';
export const catalogueKey=name=>String(name||'').normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase();
export function findCatalogue(items,query){const key=catalogueKey(query);return key?items.filter(item=>catalogueKey(item.name).includes(key)).sort((a,b)=>(catalogueKey(a.name)===key?-1:catalogueKey(b.name)===key?1:a.name.localeCompare(b.name))).slice(0,8):[];}
export function catalogueUnit(record,type){return record[type==='purchase'?'purchaseBillingUnit':'saleBillingUnit']||record.billingUnit||'nos';}
export function catalogueRate(record,type){
 const unitField=type==='purchase'?'purchaseBillingUnit':'saleBillingUnit',rateField=type==='purchase'?'purchaseRateMinor':'saleRateMinor',rate=Number(record[rateField]);
 return record[unitField]&&record[rateField]!==''&&record[rateField]!=null&&Number.isSafeInteger(rate)&&rate>=0?rate:NaN;
}
export function applyCatalogueItem(item,record,type){
 const unit=catalogueUnit(record,type),rate=catalogueRate(record,type),changed=unit!==(item.billingUnit||'nos'),cost=Number(record.costMinor);
 const hasCost=type==='sale'&&record.costMinor!==''&&record.costMinor!=null&&record.costBillingUnit===unit&&Number.isSafeInteger(cost)&&cost>=0;
 return {...item,description:record.name,billingUnit:unit,rate:Number.isSafeInteger(rate)?String(rate/100):'',cost:hasCost?String(cost/100):'',...(changed?{grouped:false,measurementMode:['sqft','rft'].includes(unit)?'dimensions':'quantity',measurements:['sqft','rft'].includes(unit)?[blankMeasurement()]:[]}: {})};
}
