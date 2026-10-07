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

// Table-based export uses public document fields, never hidden DOM or profit/CP controls.
export async function tableDocumentImages(filename,document){
 const width=1240,height=1754,margin=60,bottom=1620,canvas=globalThis.document.createElement('canvas');canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image export is unavailable in this browser.');
 const available=width-margin*2,columns=document.columns.map(([name,fraction])=>({name,width:available*fraction}));
 const pages=[];let y=0;
 function begin(){if(pages.length>=80)throw new Error('Choose a shorter period; this document needs over 80 images.');pages.push([]);y=margin;ctx.font='700 34px sans-serif';for(const row of wrapImageText(ctx,document.heading,available)){pages.at(-1).push({text:row,x:margin,y,font:'700 34px sans-serif',color:'#214c3f'});y+=43;}pages.at(-1).push({text:document.title,x:margin,y:y+9,font:'600 27px sans-serif'});y+=49;ctx.font='22px sans-serif';for(const line of document.metadata.filter(Boolean))for(const row of wrapImageText(ctx,String(line),available)){pages.at(-1).push({text:row,x:margin,y,font:'22px sans-serif'});y+=30;}y+=18;drawRow(columns.map(col=>[col.name]),42,true);}
 function drawRow(cells,rowHeight,header=false){let x=margin;pages.at(-1).push({rect:[margin,y,available,rowHeight],color:header?'#e8f0ec':'#fff',border:true});cells.forEach((lines,index)=>{for(let line=0;line<lines.length;line++)pages.at(-1).push({text:lines[line],x:x+12,y:y+28+line*28,font:header?'600 22px sans-serif':'22px sans-serif'});x+=columns[index].width;});y+=rowHeight;}
 begin();
 try{
  for(let index=0;index<document.rows.length;index++){
   ctx.font='22px sans-serif';const cells=document.rows[index].map((cell,i)=>String(cell??'').split('\n').flatMap(line=>wrapImageText(ctx,line,columns[i].width-24)));
   const count=Math.max(1,...cells.map(cell=>cell.length));for(let start=0;start<count;){const room=Math.floor((bottom-y-16)/28);if(room<1){begin();continue;}const take=Math.min(count-start,room,25),part=cells.map(lines=>lines.slice(start,start+take));drawRow(part,take*28+16);start+=take;}
   if(index%50===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  for(const [label,value] of document.totals){if(y+48>bottom)begin();pages.at(-1).push({text:label,x:margin+12,y:y+30,font:'600 24px sans-serif'},{text:value,x:margin+available*.55,y:y+30,font:'600 24px sans-serif'});y+=48;}
  const files=[],safe=String(filename).replace(/[^\p{L}\p{N}_-]+/gu,'-').slice(0,90)||'ledger';
  for(let page=0;page<pages.length;page++){
   ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.fillStyle='#214c3f';ctx.fillRect(0,0,width,8);
   for(const block of pages[page]){if(block.rect){ctx.fillStyle=block.color;ctx.fillRect(...block.rect);if(block.border){ctx.strokeStyle='#cbd7d0';ctx.strokeRect(...block.rect);}}else{ctx.font=block.font;ctx.fillStyle=block.color||'#243c35';ctx.fillText(block.text,block.x,block.y);}}
   ctx.font='18px sans-serif';ctx.fillStyle='#617463';ctx.fillText(`Page ${page+1} / ${pages.length}`,margin,1698);ctx.fillText(wrapImageText(ctx,document.footer||'',available-170)[0],margin+160,1698);
   const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Could not create document image.')),'image/png'));files.push(new File([blob],`${safe}${pages.length>1?'-'+(page+1):''}.png`,{type:'image/png'}));
  }return files;
 }finally{canvas.width=1;canvas.height=1;}
}
