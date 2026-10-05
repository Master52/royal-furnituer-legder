export const STOCK_UNITS=['NOS','PCS','SHEET','BOX','PACKET','BUNDLE','KG','GRAM','RFT','SQFT','METER','ROLL','SET'];
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
  if(new Set(result.map(r=>r.sourceId)).size!==result.length)throw new Error('CSV contains duplicate Item IDs.');return result;
}
export function stockInvoiceStatus(invoice,reviews,operations){
  const rows=reviews.filter(r=>r.invoiceId===invoice.id),affected=operations.filter(op=>op.invoiceId===invoice.id&&op.kind==='review'&&!op.reversed);
  if(affected.some(op=>Number(op.invoiceRevision)!==Number(invoice.revision||0))||affected.length&&invoice.status!=='issued')return 'Needs review';
  const current=rows.filter(r=>Number(r.invoiceRevision)===Number(invoice.revision||0));
  return current.length>=Number(invoice.itemCount)&&current.length?'Reviewed':current.length?'Partially updated':'Pending';
}
