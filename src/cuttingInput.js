// Integer coordinates in 0.0001 mm keep cutting calculations deterministic.
export const CUT_UNITS={in:{label:'Inches',factor:254000},ft:{label:'Feet',factor:3048000},soot:{label:'Soot (⅛ inch)',factor:31750},mm:{label:'Millimetres',factor:10000},cm:{label:'Centimetres',factor:100000}};
const unitNames={ft:'ft',foot:'ft',feet:'ft',"'":'ft',in:'in',inch:'in',inches:'in','"':'in',soot:'soot',suta:'soot',mm:'mm',cm:'cm'};
export const MAX_PANELS=600;
export function cuttingLength(value,unit,{zero=false}={}){
 const text=String(value).trim().toLowerCase(),factor=CUT_UNITS[unit]?.factor;
 const decimal=/^\d+(?:\.\d{1,3})?$/;
 const scaled=value=>{const [whole,fraction='']=value.split('.');return Number(whole)*1000+Number(fraction.padEnd(3,'0'));};
 let raw;
 if(!factor)throw new Error('Select a supported measurement unit.');
 if(decimal.test(text))raw=scaled(text)*factor/1000;
 else{
  const parts=[...text.matchAll(/(\d+(?:\.\d{1,3})?)\s*(inches|inch|feet|foot|soot|suta|ft|in|mm|cm|'|")/g)];
  if(!parts.length||parts.map(part=>part[0]).join('').replace(/\s/g,'')!==text.replace(/\s/g,''))throw new Error('Use up to 3 decimal places, or a measurement like 2ft 3in 2soot.');
  raw=parts.reduce((sum,part)=>sum+scaled(part[1])*CUT_UNITS[unitNames[part[2]]].factor/1000,0);
 }
 // Sub-tick soot fractions are rounded once, to the nearest 0.0001 mm.
 const length=Math.round(raw);
 if(!Number.isSafeInteger(length)||length<(zero?0:1)||length>50000*10000)throw new Error('Dimensions must be positive and no larger than 50 metres.');
 return length;
}
export function parseCuttingSizes(text,unit,{sheets=false}={}){
 const entries=String(text).split(/[\n,;]+/).map(value=>value.trim()).filter(Boolean);
 if(!entries.length)throw new Error(sheets?'Enter at least one available sheet size.':'Enter at least one panel size.');
 if(sheets&&entries.length>12)throw new Error('Use at most 12 sheet sizes per calculation.');
 let total=0;
 return entries.map((entry,index)=>{
  const parts=entry.split(/[x×*]/i).map(value=>value.trim());
  if(parts.length<2||parts.length>3||!parts[0]||!parts[1]||parts.length===3&&!/^\d+$/.test(parts[2]))throw new Error(`${sheets?'Sheet':'Panel'} ${index+1}: use width × height × quantity, for example ${sheets?'48x96':'24x32x2'}.`);
  const quantity=parts[2]?Number(parts[2]):1;
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>MAX_PANELS)throw new Error(`Row ${index+1}: quantity must be 1–${MAX_PANELS}.`);
  total+=quantity;if(!sheets&&total>MAX_PANELS)throw new Error(`Use at most ${MAX_PANELS} panels per calculation.`);
  return {id:index+1,width:cuttingLength(parts[0],unit),height:cuttingLength(parts[1],unit),quantity,label:`${parts[0]} × ${parts[1]}`,unit};
 });
}
export function cuttingDimension(ticks,unit){return Number((ticks/CUT_UNITS[unit].factor).toFixed(4)).toLocaleString('en-IN',{maximumFractionDigits:4});}
