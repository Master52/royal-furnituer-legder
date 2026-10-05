import {applyConfirmedStockUnits} from './stockImportProfile.js';
export const STOCK_UNITS=['UNIT','NOS','PCS','SHEET','BOX','PACKET','BORI','BUNDLE','KG','GRAM','RFT','SQFT','METER','ROLL','SET'];
export const stockUnitLabel=unit=>unit==='UNIT'?'CSV unit':unit;
export const STOCK_SCALE=100000000n;
export function stockDecimal(value,{signed=false}={}){
  const text=String(value??'').trim();
  if(!(signed?/^-?\d+(\.\d{1,8})?$/:/^\d+(\.\d{1,8})?$/).test(text))throw new Error('Enter a quantity with at most 8 decimal places.');
  const negative=text.startsWith('-'),[whole,fraction='']=text.replace(/^-/,'').split('.');
  const result=BigInt(whole)*STOCK_SCALE+BigInt(fraction.padEnd(8,'0'));
  if(result>100000000000000000n)throw new Error('Stock quantity is too large.');
  return negative?-result:result;
}
export function stockText(value){const n=BigInt(value),a=n<0n?-n:n;return `${n<0n?'-':''}${a/STOCK_SCALE}${a%STOCK_SCALE?'.'+String(a%STOCK_SCALE).padStart(8,'0').replace(/0+$/,''):''}`;}
export function convertStock(quantity,factor='1'){
  const product=stockDecimal(quantity,{signed:true})*stockDecimal(factor);
  if(product%STOCK_SCALE)throw new Error('Conversion needs more than 8 decimal places. Check the units.');
  return stockText(product/STOCK_SCALE);
}
export function validateStockBaseQuantity(quantity,unit){const value=stockDecimal(quantity,{signed:true});if(['PCS','NOS'].includes(unit)&&value%STOCK_SCALE)throw new Error(`${quantity} ${unit} is fractional. Confirm the whole-piece count or conversion; it will not be rounded.`);return quantity;}
export function stockBalance(item,movements){return stockText(movements.filter(m=>m.stockItemId===item.id).reduce((sum,m)=>sum+stockDecimal(m.baseQuantity,{signed:true}),0n));}
export function parseStockCsv(text){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}else cell+=c;}
  if(quoted)throw new Error('CSV contains an unfinished quoted field.');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
  const index=rows.findIndex(r=>r[0].replace(/^\uFEFF/,'').trim()==='Item ID');
  if(index<0)throw new Error('Choose the MyBillBook CSV with Item ID and Current stock columns.');
  const headers=rows[index].map(v=>v.split('\n')[0].trim()),get=(r,key)=>r[headers.indexOf(key)]??'';
  for(const key of ['Item ID','Item Name*','Current stock','Sales Price','Purchase Price'])if(!headers.includes(key))throw new Error(`Missing CSV column: ${key}.`);
  const result=rows.slice(index+1).filter(r=>get(r,'Item ID').trim()).map(r=>({id:crypto.randomUUID(),sourceId:get(r,'Item ID').trim(),name:get(r,'Item Name*').trim().toUpperCase(),code:get(r,'Item code').trim(),quantity:get(r,'Current stock').trim(),salePrice:get(r,'Sales Price').trim(),purchasePrice:get(r,'Purchase Price').trim(),lowStock:get(r,'Low stock alert quantity').trim(),baseUnit:'',importUnit:'',secondaryUnit:'',conversion:'',saleRateUnit:'',purchaseRateUnit:'',include:get(r,'Item Name*').trim().toUpperCase()!=='GENERIC SALE'}));
  if(!result.length||result.length>500)throw new Error('Import between 1 and 500 items at a time.');
  if(new Set(result.map(r=>r.sourceId)).size!==result.length)throw new Error('CSV contains duplicate Item IDs.');return result.map(row=>applyConfirmedStockUnits({...row,exportSnapshot:{name:row.name,code:row.code,quantity:row.quantity,lowStock:row.lowStock,salePrice:row.salePrice,purchasePrice:row.purchasePrice}}));
}
export function stockInvoiceStatus(invoice,reviews,operations){
  const rows=reviews.filter(r=>r.invoiceId===invoice.id),affected=operations.filter(op=>op.invoiceId===invoice.id&&op.kind==='review'&&!op.reversed);
  if(affected.some(op=>Number(op.invoiceRevision)!==Number(invoice.revision||0))||affected.length&&invoice.status!=='issued')return 'Needs review';
  const current=rows.filter(r=>Number(r.invoiceRevision)===Number(invoice.revision||0));
  return current.length>=Number(invoice.itemCount)&&current.length?'Reviewed':current.length?'Partially updated':'Pending';
}

export function stockPrice(value){const text=String(value||'0').trim();if(!/^\d+(\.\d{1,2})?$/.test(text))throw new Error('Prices must have at most two decimal places.');const [whole,fraction='']=text.split('.');const result=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));if(!Number.isSafeInteger(result)||result>100000000000)throw new Error('Invalid stock price.');return result;}
export function exportedStockRow(row){
  const raw=row.exportSnapshot||row;
  const known=applyConfirmedStockUnits({sourceId:row.sourceId,name:raw.name,baseUnit:'',importUnit:'',secondaryUnit:'',conversion:'',saleRateUnit:'',purchaseRateUnit:''});
  return {...row,...raw,baseUnit:known.baseUnit||'UNIT',importUnit:known.importUnit||'UNIT',secondaryUnit:known.secondaryUnit||'',conversion:known.conversion||'1',saleRateUnit:known.importUnit||'UNIT',purchaseRateUnit:known.importUnit||'UNIT'};
}
export function stockImportItems(rows,asExported=false){return rows.filter(row=>row.include).map(original=>{
  const row=asExported?exportedStockRow(original):original;
  if(!row.baseUnit||!row.importUnit||row.importUnit!==row.baseUnit&&row.importUnit!==row.secondaryUnit)throw new Error(`Confirm the exported unit for ${row.name}.`);
  const factor=row.importUnit===row.baseUnit?'1':row.conversion,quantity=stockText(stockDecimal(row.quantity));
  const baseQuantity=convertStock(quantity,factor);if(!asExported)validateStockBaseQuantity(baseQuantity,row.baseUnit);
  return {id:row.id,sourceId:row.sourceId,name:row.name,code:row.code,category:'',baseUnit:row.baseUnit,secondaryUnit:row.secondaryUnit,conversion:row.secondaryUnit?row.conversion:'1',importUnit:row.importUnit,quantity,lowStock:row.lowStock===''?'':convertStock(row.lowStock,factor),saleRateUnit:row.saleRateUnit,purchaseRateUnit:row.purchaseRateUnit,saleRateMinor:stockPrice(row.salePrice),purchaseRateMinor:stockPrice(row.purchasePrice)};
});}
