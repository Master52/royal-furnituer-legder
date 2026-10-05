// Render public document text directly to canvas: no DOM capture, CP or hidden UI.
export function wrapImageText(context,text,width){
 const result=[];let line='';
 for(const word of text.split(/\s+/)){
  if(context.measureText(line?`${line} ${word}`:word).width<=width){line=line?`${line} ${word}`:word;continue;}
  if(line){result.push(line);line='';}
  for(const character of Array.from(word)){if(context.measureText(line+character).width>width&&line){result.push(line);line='';}line+=character;}
 }
 result.push(line);return result;
}
export async function documentImages(title,text){
 const width=1130,height=1600,margin=70,bottom=1480,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const context=canvas.getContext('2d');if(!context)throw new Error('Image export is unavailable in this browser.');
 const pages=[[]];let y=140;
 for(const source of String(text).split('\n')){
  const bold=source.trim().startsWith('*'),clean=source.replace(/\*/g,'').trim();context.font=`${bold?'600':'400'} 26px sans-serif`;
  const rows=clean?wrapImageText(context,clean,width-margin*2):[''];
  for(const row of rows){const step=row?38:20;if(y+step>bottom){pages.push([]);y=140;}pages.at(-1).push({row,bold,y});y+=step;}
 }
 if(pages.length>80){canvas.width=1;throw new Error('This statement is too long for images. Choose a shorter period or print it as a PDF.');}
 const files=[],safe=String(title).replace(/[^\p{L}\p{N}_-]+/gu,'-').slice(0,90)||'ledger';
 for(let index=0;index<pages.length;index++){
  context.fillStyle='#fff';context.fillRect(0,0,width,height);context.fillStyle='#214c3f';context.fillRect(0,0,width,8);context.font='600 25px sans-serif';
  const heading=wrapImageText(context,title,width-margin*2)[0];context.fillText(heading,margin,65);
  context.strokeStyle='#dce5dc';context.beginPath();context.moveTo(margin,94);context.lineTo(width-margin,94);context.stroke();
  for(const {row,bold,y} of pages[index]){context.font=`${bold?'600':'400'} 26px sans-serif`;context.fillStyle=bold?'#214c3f':'#243c35';context.fillText(row,margin,y);}
  context.font='20px sans-serif';context.fillStyle='#617463';context.fillText(`Page ${index+1} of ${pages.length} · Amounts in INR`,margin,1550);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Could not create document image.')),'image/png'));
  files.push(new File([blob],`${safe}${pages.length>1?`-${index+1}`:''}.png`,{type:'image/png'}));
 }
 canvas.width=1;canvas.height=1;return files;
}
