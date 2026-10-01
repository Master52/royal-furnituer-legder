// Keep these pure calculation functions identical to the billing helpers in Code.gs.
export const BILLING_UNITS={nos:'NOS.',sqft:'SQ. FT.',rft:'RUNNING FT.',kg:'KG'};
export const blankMeasurement=()=>({description:'',length:'',width:'',quantity:'1',pieces:'1'});
export function scaledInput(value,label){
  const text=String(value??'').trim();
  if(!/^\d+(\.\d{1,3})?$/.test(text))throw new Error(`${label} must be positive with at most three decimal places.`);
  const [whole,fraction='']=text.split('.'),number=Number(whole)*1000+Number(fraction.padEnd(3,'0'));
  if(!Number.isSafeInteger(number)||number<=0||number>1000000000)throw new Error(`${label} must be between 0.001 and 1,000,000.`);
  return number;
}
export function draftMeasurements(item){
  return (item.measurements||[]).map(row=>{
    const dimensions=['sqft','rft'].includes(item.billingUnit),perimeter=item.measurementMode==='perimeter';
    return {description:String(row.description||'').trim(),lengthMilli:dimensions?scaledInput(row.length,'Length'):0,widthMilli:item.billingUnit==='sqft'||perimeter?scaledInput(row.width,'Width'):0,quantityMilli:dimensions?0:scaledInput(row.quantity,item.billingUnit==='kg'?'Weight':'Quantity'),pieces:Number(row.pieces)};
  });
}
export function billingQuantity_(item){
  const unit=item.billingUnit||'',mode=item.measurementMode||'quantity';
  if(!['','nos','sqft','rft','kg'].includes(unit))throw new Error('Choose a supported billing unit.');
  const rows=item.measurements||[];
  if(!Array.isArray(rows)||rows.length>100)throw new Error('Each item group supports at most 100 measurement rows.');
  if(!unit&&rows.length)throw new Error('Choose a billing unit for grouped measurements.');
  if(unit==='sqft'&&mode!=='dimensions'||unit==='rft'&&!['dimensions','perimeter'].includes(mode))throw new Error('Choose the measurement calculation.');
  if(['sqft','rft'].includes(unit)&&!['feet','inches'].includes(item.measurementUnit))throw new Error('Choose Feet or Inches.');
  if(!['sqft','rft'].includes(unit)&&unit&&mode!=='quantity')throw new Error('This unit uses quantity or weight.');
  if(['sqft','rft'].includes(unit)&&!rows.length)throw new Error('Add at least one size to this item group.');
  let numerator=BigInt(0),denominator=BigInt(1000);
  if(rows.length){
    if(unit==='sqft')denominator=item.measurementUnit==='inches'?BigInt(144000000):BigInt(1000000);
    else if(unit==='rft')denominator=item.measurementUnit==='inches'?BigInt(12000):BigInt(1000);
    for(const row of rows){
      if(typeof row.description!=='string'||row.description.length>150)throw new Error('Measurement descriptions must be at most 150 characters.');
      if(!Number.isSafeInteger(row.pieces)||row.pieces<=0||row.pieces>1000000)throw new Error('Pieces must be a whole number between 1 and 1,000,000.');
      const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=1000000000;
      let value;
      if(unit==='sqft'){if(!positive(row.lengthMilli)||!positive(row.widthMilli))throw new Error('Enter valid length and width.');value=BigInt(row.lengthMilli)*BigInt(row.widthMilli);}
      else if(unit==='rft'){if(!positive(row.lengthMilli)||mode==='perimeter'&&!positive(row.widthMilli))throw new Error('Enter valid frame dimensions or length.');value=mode==='perimeter'?BigInt(2)*(BigInt(row.lengthMilli)+BigInt(row.widthMilli)):BigInt(row.lengthMilli);}
      else {if(!positive(row.quantityMilli))throw new Error('Enter a valid weight or quantity.');value=BigInt(row.quantityMilli);}
      numerator+=value*BigInt(row.pieces);
    }
  }else{if(!Number.isSafeInteger(item.quantityMilli)||item.quantityMilli<=0||item.quantityMilli>1000000000)throw new Error('Enter a valid item quantity.');numerator=BigInt(item.quantityMilli);}
  if(numerator<=BigInt(0)||numerator>BigInt(1000000)*denominator)throw new Error('Total item quantity must be positive and no greater than 1,000,000.');
  return {numerator,denominator,quantityMilli:Number((numerator*BigInt(1000)+denominator/BigInt(2))/denominator)};
}
export function billingPrice_(rate,quantity){
  if(!Number.isSafeInteger(rate)||rate<0||rate>100000000000)throw new Error('Invalid unit price.');
  const amount=(BigInt(rate)*quantity.numerator+quantity.denominator/BigInt(2))/quantity.denominator;
  if(amount>BigInt(100000000000))throw new Error('Item amount exceeds the supported limit.');
  return Number(amount);
}
export function billingPreview(item){
  const unit=item.billingUnit||'',rows=draftMeasurements(item);
  return billingQuantity_({...item,quantityMilli:rows.length?0:scaledInput(item.quantity,'Quantity'),measurements:rows});
}
export function billingQuantityText(value,unit){
  const scaled=(value.numerator*BigInt(10000)+value.denominator/BigInt(2))/value.denominator;
  if(scaled===BigInt(0))return '<0.0001 '+BILLING_UNITS[unit];
  const text=(scaled/BigInt(10000)).toString()+'.'+(scaled%BigInt(10000)).toString().padStart(4,'0');
  return text.replace(/\.?0+$/,'')+' '+BILLING_UNITS[unit];
}
export function quantityText(item){
  if(!item.billingUnit)return String(Number(item.quantityMilli)/1000);
  return billingQuantityText(billingQuantity_(item),item.billingUnit);
}
export function measurementText(item,row){
  const pieces=row.pieces,description=row.description?`${row.description}: `:'',unit=item.measurementUnit==='inches'?'in':'ft';
  const length=Number(row.lengthMilli)/1000,width=Number(row.widthMilli)/1000;
  if(item.billingUnit==='sqft'||item.measurementMode==='perimeter')return `${description}${length} × ${width} ${unit} · ${pieces} piece${pieces===1?'':'s'}${item.measurementMode==='perimeter'?' · perimeter':''}`;
  if(item.billingUnit==='rft')return `${description}${length} ${unit} · ${pieces} piece${pieces===1?'':'s'}`;
  return `${description}${Number(row.quantityMilli)/1000} ${BILLING_UNITS[item.billingUnit]} × ${pieces}`;
}
export function measurementDraftFromItem(item){
  return {grouped:(item.measurements||[]).length>1||(!['sqft','rft'].includes(item.billingUnit)&&(item.measurements||[]).length>0),billingUnit:item.billingUnit||'',measurementUnit:item.measurementUnit||'feet',measurementMode:item.measurementMode||'quantity',measurements:(item.measurements||[]).map(row=>({description:row.description||'',length:row.lengthMilli?String(row.lengthMilli/1000):'',width:row.widthMilli?String(row.widthMilli/1000):'',quantity:row.quantityMilli?String(row.quantityMilli/1000):'1',pieces:String(row.pieces)}))};
}
