import {blankMeasurement} from './measurements.js';
export const catalogueKey=name=>String(name||'').normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase();
export function findCatalogue(items,query){const key=catalogueKey(query);return key?items.filter(item=>catalogueKey(item.name).includes(key)).sort((a,b)=>(catalogueKey(a.name)===key?-1:catalogueKey(b.name)===key?1:a.name.localeCompare(b.name))).slice(0,8):[];}
export function catalogueRate(item,type){const value=item[type==='purchase'?'purchaseRateMinor':'saleRateMinor'];return Number(value==null||value===''?item.rateMinor:value);}
export function applyCatalogueItem(item,record,type){
 const unit=record.billingUnit||'nos',changed=unit!==(item.billingUnit||'nos');
 return {...item,description:record.name,billingUnit:unit,rate:String(catalogueRate(record,type)/100),...(type==='sale'&&record.costMinor!==''&&record.costMinor!=null?{cost:String(Number(record.costMinor)/100)}:{}),...(changed?{grouped:false,measurementMode:['sqft','rft'].includes(unit)?'dimensions':'quantity',measurements:['sqft','rft'].includes(unit)?[blankMeasurement()]:[]}: {})};
}
