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
// Estimated value at the current purchase rate, rounded once to the nearest paisa.
export function stockValueMinor(item){
 const quantity=stockDecimal(item.balance,{signed:true});if(quantity===0n)return 0;
 const rate=Number(item.purchaseRateMinor);if(!Number.isSafeInteger(rate)||rate<=0)return null;
 const unit=item.purchaseRateUnit||item.baseUnit;
 if(unit!==item.baseUnit&&(!item.secondaryUnit||unit!==item.secondaryUnit))return null;
 const factor=unit===item.baseUnit?STOCK_SCALE:stockDecimal(item.conversion);if(factor<=0n)return null;
 const product=quantity*BigInt(rate),magnitude=product<0n?-product:product;
 const rounded=(magnitude+factor/2n)/factor,result=Number(product<0n?-rounded:rounded);
 return Number.isSafeInteger(result)?result:null;
}
// Value an entered quantity using its unit and any purchase-price edit in the draft.
export function stockEntryValueMinor(item,entry,purchasePrice){
 if(!item||![item.baseUnit,item.secondaryUnit].filter(Boolean).includes(entry.unit))throw new Error('Choose a valid stock unit.');
 const balance=convertStock(entry.quantity,entry.unit===item.baseUnit?'1':item.conversion);
 return stockValueMinor({...item,balance,...(purchasePrice!==undefined?{purchaseRateMinor:stockPrice(purchasePrice)}:{})});
}
export function stockMetrics(items){
 const totals=new Map();let low=0,out=0,unconfigured=0;
 for(const item of items){const balance=stockDecimal(item.balance,{signed:true});if(balance<=0n)out++;if(item.lowStock!==''&&item.lowStock!=null&&balance<=stockDecimal(item.lowStock))low++;
  if(item.baseUnit==='UNIT'){unconfigured++;continue;}
  totals.set(item.baseUnit,(totals.get(item.baseUnit)||0n)+balance);
 }
 return {count:items.length,low,out,unconfigured,totals:[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([unit,quantity])=>({unit,quantity:stockText(quantity)}))};
}
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
export function stockReviewMatches(op,invoice){return op.invoiceStockRevision!==''&&op.invoiceStockRevision!=null&&invoice.stockRevision!==''&&invoice.stockRevision!=null?Number(op.invoiceStockRevision)===Number(invoice.stockRevision):Number(op.invoiceRevision||0)===Number(invoice.revision||0);}
export function invoiceStockOperations(invoice,operations){return operations.filter(op=>op.invoiceId===invoice.id&&op.kind==='review'&&!op.reversed&&!op.superseded);}
export function invoiceStockEntries(invoice,stock){
 const totals=new Map();for(const op of invoiceStockOperations(invoice,stock.operations))for(const row of Array.isArray(op.stockEntries)?op.stockEntries:stock.movements.filter(row=>row.operationId===op.id))totals.set(row.stockItemId,(totals.get(row.stockItemId)||0n)+stockDecimal(row.baseQuantity,{signed:true}));
 return [...totals].filter(([,amount])=>amount!==0n).map(([stockItemId,amount])=>{const item=[...stock.items,...(stock.archivedItems||[])].find(item=>item.id===stockItemId);return {stockItemId,quantity:stockText(amount<0n?-amount:amount),unit:item?.baseUnit,baseQuantity:stockText(amount)};});
}
export function stockInvoiceStatus(invoice,reviews,operations){
 const affected=invoiceStockOperations(invoice,operations);
 if(affected.some(op=>!stockReviewMatches(op,invoice))||affected.length&&invoice.status!=='issued')return 'Needs review';
 const ids=new Set(affected.map(op=>op.id));const current=reviews.filter(row=>row.invoiceId===invoice.id&&(ids.has(row.operationId)||!affected.length&&Number(row.invoiceRevision)===Number(invoice.revision||0)));
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

export function stockActivity(items,movements,operations,invoices,today){
 const cutoff=new Date(`${today}T00:00:00Z`);cutoff.setUTCDate(cutoff.getUTCDate()-29);const since=cutoff.toISOString().slice(0,10);
 const sales=new Map(invoices.filter(invoice=>invoice.type==='sale'&&(!invoice.status||invoice.status==='issued')).map(invoice=>[invoice.id,invoice]));
 const activeOperations=operations.filter(op=>op.kind==='review'&&!op.reversed&&!op.superseded&&sales.has(op.invoiceId)&&stockReviewMatches(op,sales.get(op.invoiceId)));
 const active=new Set(activeOperations.map(op=>op.id));
 const effectiveMovements=activeOperations.flatMap(op=>Array.isArray(op.stockEntries)?op.stockEntries.map(row=>({...row,operationId:op.id,movementDate:row.movementDate||op.movementDate||String(op.createdAt||'').slice(0,10)})):movements.filter(row=>row.operationId===op.id));
 const counts=new Map();
 for(const row of effectiveMovements){if(!active.has(row.operationId)||row.movementDate<since||row.movementDate>today||stockDecimal(row.baseQuantity,{signed:true})>=0n)continue;const ids=counts.get(row.stockItemId)||new Set();ids.add(row.operationId);counts.set(row.stockItemId,ids);}
 const fast=new Set(),slow=new Set();for(const item of items){const count=counts.get(item.id)?.size||0;if(count>=3)fast.add(item.id);else if(stockDecimal(item.balance,{signed:true})>0n)slow.add(item.id);}
 return {fast,slow,counts,since};
}

export function applyPendingStock(data,queue){
 const items=data.items.map(row=>({...row})),byId=new Map(items.map(row=>[row.id,row])),operations=data.operations.map(op=>({...op})),movements=[...data.movements],reviews=[...data.reviews],committed=new Set(operations.map(row=>row.id));
 for(const operation of queue){if(operation.invalid||operation.rejected)break;const p=operation.payload;if(committed.has(p.id))continue;
  if(operation.action==='updateStockItem'){
   const item=byId.get(p.item?.id);
   if(!item||item.status==='deleted'||!Number.isSafeInteger(p._expectedRevision)||Number(item.revision||0)!==p._expectedRevision)continue;
   const createdAt=operation.queuedAt||new Date().toISOString();
   for(const key of ['name','code','category','baseUnit','secondaryUnit','conversion','lowStock','saleRateMinor','purchaseRateMinor','saleRateUnit','purchaseRateUnit']){
    if(Object.hasOwn(p.item,key)){if((key==='saleRateMinor'||key==='saleRateUnit')&&item[key]!==p.item[key])item.salePriceUpdatedAt=createdAt;if((key==='purchaseRateMinor'||key==='purchaseRateUnit')&&item[key]!==p.item[key])item.purchasePriceUpdatedAt=createdAt;item[key]=p.item[key];}
   }
   item.revision=p._expectedRevision+1;item.updatedAt=createdAt;item._pending=true;
   operations.push({id:p.id,kind:'item-edit',createdAt,_pending:true});continue;
  }
  if(operation.action==='adjustInvoiceStock'){
   const previous=invoiceStockEntries({id:p.invoiceId}, {...data,items,operations,movements,reviews}),before=new Map(previous.map(row=>[row.stockItemId,stockDecimal(row.baseQuantity,{signed:true})])),after=new Map(),createdAt=operation.queuedAt||new Date().toISOString();
   const desired=p.stockUnchanged?previous.map(row=>{after.set(row.stockItemId,stockDecimal(row.baseQuantity,{signed:true}));return row;}):p.movements.filter(row=>byId.has(row.stockItemId)).map(row=>{const item=byId.get(row.stockItemId);const value=stockDecimal(convertStock(row.quantity,row.unit===item.baseUnit?'1':item.conversion),{signed:true})*(p.invoiceType==='purchase'?1n:-1n);after.set(row.stockItemId,(after.get(row.stockItemId)||0n)+value);return {...row,baseQuantity:stockText(value)};});
   for(const id of new Set([...before.keys(),...after.keys()])){const delta=(after.get(id)||0n)-(before.get(id)||0n),item=byId.get(id);if(!delta||!item)continue;item.balance=stockText(stockDecimal(item.balance,{signed:true})+delta);movements.push({id:p.id+'-pending-'+movements.length,operationId:p.id,stockItemId:id,movementDate:p.movementDate,baseQuantity:stockText(delta),quantity:stockText(delta),unit:item.baseUnit,conversion:'1',invoiceId:p.invoiceId,reason:p.reason,createdAt,_pending:true});}
   for(const op of operations)if((p.supersedesIds||[]).includes(op.id))op.superseded=true;
   for(let index=reviews.length-1;index>=0;index--)if((p.supersedesIds||[]).includes(reviews[index].operationId))reviews.splice(index,1);
   operations.push({id:p.id,kind:'review',invoiceId:p.invoiceId,invoiceRevision:p.invoiceRevision,invoiceStockRevision:p.invoiceStockRevision,stockEntries:desired,supersedesIds:p.supersedesIds,createdAt,_pending:true});
   for(const id of p.reviewItemIds||[])reviews.push({id:p.id+'-pending-'+id,operationId:p.id,invoiceId:p.invoiceId,invoiceRevision:p.invoiceRevision,invoiceItemId:id,status:desired.length?'updated':'no-impact',reason:p.reason,_pending:true});
   for(const price of p.priceUpdates||[]){const item=byId.get(price.stockItemId);if(!item)continue;for(const key of ['saleRateMinor','purchaseRateMinor'])if(price[key]!==undefined)item[key]=price[key];item.revision=Number(item.revision||0)+1;}continue;
  }
  const manual=operation.action==='recordStock'&&Array.isArray(p.movements);if(!manual&&(operation.action!=='reviewInvoiceStock'||p.reviewMode!=='invoice')||committed.has(p.id))continue;
  const createdAt=operation.queuedAt||new Date().toISOString();operations.push({id:p.id,kind:manual?'manual':'review',invoiceId:p.invoiceId,invoiceRevision:p.invoiceRevision,invoiceStockRevision:p.invoiceStockRevision,stockEntries:p.movements.filter(row=>byId.has(row.stockItemId)).map(row=>{const item=byId.get(row.stockItemId);return {...row,baseQuantity:stockText(stockDecimal(convertStock(row.quantity,row.unit===item.baseUnit?'1':item.conversion),{signed:true})*(manual?1n:p.invoiceType==='purchase'?1n:-1n))};}),createdAt,_pending:true});
  for(const [index,row] of p.movements.entries()){const item=byId.get(row.stockItemId);if(!item)continue;const quantity=convertStock(row.quantity,row.unit===item.baseUnit?'1':item.conversion),signed=stockDecimal(quantity,{signed:true})*(manual?1n:p.invoiceType==='purchase'?1n:-1n);item.balance=stockText(stockDecimal(item.balance,{signed:true})+signed);movements.push({...row,id:p.id+'-pending-'+index,operationId:p.id,invoiceId:p.invoiceId,invoiceItemId:'',movementDate:p.movementDate,baseQuantity:stockText(signed),reason:p.reason,createdAt,_pending:true});}
  for(const id of p.reviewItemIds||[])reviews.push({id:p.id+'-pending-'+id,operationId:p.id,invoiceId:p.invoiceId,invoiceRevision:p.invoiceRevision,invoiceItemId:id,status:p.movements.length?'updated':'no-impact',reason:p.reason,_pending:true});
  for(const price of p.priceUpdates||[]){const item=byId.get(price.stockItemId);if(!item)continue;for(const key of ['saleRateMinor','purchaseRateMinor'])if(price[key]!==undefined){item[key]=price[key];item[key==='saleRateMinor'?'salePriceUpdatedAt':'purchasePriceUpdatedAt']=createdAt;}item.revision=Number(item.revision||0)+1;}
 }
 return {...data,items,movements,reviews,operations};
}
