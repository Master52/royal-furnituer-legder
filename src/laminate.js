import {parseCuttingSizes,cuttingLength,CUT_UNITS} from './cuttingInput.js';
export function laminateEstimate({panels,panelUnit='in',sheetWidth='4',sheetHeight='8',sheetUnit='ft',faces='1',waste='10',price=''}){
 const rows=parseCuttingSizes(panels,panelUnit);
 if(!['1','2'].includes(String(faces)))throw new Error('Choose one or both faces.');
 const text=String(waste).trim();
 if(!/^\d+(?:\.\d{1,2})?$/.test(text)||Number(text)>100)throw new Error('Waste allowance must be 0–100%, with up to 2 decimal places.');
 const [whole,fraction='']=text.split('.'),wasteBasisPoints=BigInt(Number(whole)*100+Number(fraction.padEnd(2,'0')));
 const width=cuttingLength(sheetWidth,sheetUnit),height=cuttingLength(sheetHeight,sheetUnit),sheetArea=BigInt(width)*BigInt(height);
 const measuredRows=rows.map(row=>({...row,area:BigInt(row.width)*BigInt(row.height)*BigInt(row.quantity)*BigInt(faces)}));
 const coverage=measuredRows.reduce((sum,row)=>sum+row.area,0n),requiredNumerator=coverage*(10000n+wasteBasisPoints);
 const sheets=Number((requiredNumerator+sheetArea*10000n-1n)/(sheetArea*10000n));
 if(!Number.isSafeInteger(sheets))throw new Error('The sheet quantity is too large. Check your sheet size or use a smaller batch.');
 let priceMinor=null;
 if(String(price).trim()!==''){
  const value=String(price).trim();if(!/^\d+(?:\.\d{1,2})?$/.test(value)||Number(value)>1000000000)throw new Error('Sheet price must be 0–1,000,000,000 rupees, with up to 2 decimal places.');
  const [rupees,paise='']=value.split('.');priceMinor=Number(rupees)*100+Number(paise.padEnd(2,'0'));
 }
 const costMinor=priceMinor===null?null:priceMinor*sheets;
 if(costMinor!==null&&!Number.isSafeInteger(costMinor))throw new Error('The total cost is too large. Use a smaller batch or price.');
 const sqft=value=>Number(value)/(CUT_UNITS.ft.factor**2);
 const tooLarge=rows.filter(row=>!((row.width<=width&&row.height<=height)||(row.height<=width&&row.width<=height)));
 return {rows:measuredRows.map(row=>({...row,areaSqft:sqft(row.area),area:undefined})),panels:rows.reduce((sum,row)=>sum+row.quantity,0),faces:Number(faces),wastePercent:Number(text),width,height,sheetUnit,panelUnit,sheetAreaSqft:sqft(sheetArea),coverageSqft:sqft(coverage),wasteSqft:sqft(coverage*wasteBasisPoints)/10000,requiredSqft:sqft(requiredNumerator)/10000,sheets,purchasedSqft:sqft(sheetArea)*sheets,priceMinor,costMinor,tooLarge};
}
