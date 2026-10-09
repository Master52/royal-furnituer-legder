import {MAX_PANELS} from './cuttingInput.js';

const area=rect=>rect.width*rect.height;
function orientations(panel,rotate){return rotate&&panel.width!==panel.height?[{width:panel.width,height:panel.height,rotated:false},{width:panel.height,height:panel.width,rotated:true}]:[{width:panel.width,height:panel.height,rotated:false}];}
function fillSheet(type,panels,{rotation,kerf,split}){
 const sheet={typeId:type.id,width:type.width,height:type.height,placements:[],cuts:[],kerfs:[],leftovers:[{x:0,y:0,width:type.width,height:type.height}]};
 for(const panel of panels){
  let best;
  sheet.leftovers.forEach((rect,index)=>orientations(panel,rotation).forEach(size=>{
   if(size.width>rect.width||size.height>rect.height)return;
   const score=[Math.min(rect.width-size.width,rect.height-size.height),area(rect)-area(size),index];
   if(!best||compare(score,best.score)<0)best={rect,index,size,score};
  }));
  if(!best)continue;
  const {rect,index,size}=best,{x,y,width,height}=rect,w=size.width,h=size.height;
  sheet.leftovers.splice(index,1);sheet.placements.push({...panel,...size,x,y});
  const gapX=Math.min(kerf,width-w),gapY=Math.min(kerf,height-h),restX=width-w-gapX,restY=height-h-gapY;
  const vertical=split==='vertical'||split==='adaptive'&&restX*height>=restY*width;
  const cut=(axis,position,from,to,band)=>{sheet.cuts.push({number:sheet.cuts.length+1,axis,position,from,to});if(band.width>0&&band.height>0)sheet.kerfs.push(band);};
  if(vertical){
   if(width>w)cut('V',x+w,y,y+height,{x:x+w,y,width:gapX,height});
   if(height>h)cut('H',y+h,x,x+w,{x,y:y+h,width:w,height:gapY});
   if(restX>0)sheet.leftovers.push({x:x+w+gapX,y,width:restX,height});
   if(restY>0)sheet.leftovers.push({x,y:y+h+gapY,width:w,height:restY});
  }else{
   if(height>h)cut('H',y+h,x,x+width,{x,y:y+h,width,height:gapY});
   if(width>w)cut('V',x+w,y,y+h,{x:x+w,y,width:gapX,height:h});
   if(restY>0)sheet.leftovers.push({x,y:y+h+gapY,width,height:restY});
   if(restX>0)sheet.leftovers.push({x:x+w+gapX,y,width:restX,height:h});
  }
 }
 sheet.panelArea=sheet.placements.reduce((sum,panel)=>sum+area(panel),0);
 sheet.kerfArea=sheet.kerfs.reduce((sum,rect)=>sum+area(rect),0);
 sheet.unusedArea=sheet.leftovers.reduce((sum,rect)=>sum+area(rect),0);
 return sheet;
}
function compare(a,b){for(let i=0;i<a.length;i++){if(a[i]!==b[i])return a[i]<b[i]?-1:1;}return 0;}
function candidateScore(sheet,mode){const used=sheet.panelArea,raw=area(sheet);return mode==='smallest'?[raw,-used]:mode==='coverage'?[-used,raw]:[-used/raw,raw,-used];}
function trial(panels,types,options){
 let remaining=[...panels];const sheets=[],used=new Map();
 while(remaining.length){
  let best;
  for(const type of types){
   if(options.limited&&(used.get(type.id)||0)>=type.quantity)continue;
   const candidate=fillSheet(type,remaining,options);if(!candidate.placements.length)continue;
   const score=candidateScore(candidate,options.mode);
   if(!best||compare(score,best.score)<0)best={sheet:candidate,score};
  }
  if(!best)break;
  const sheet=best.sheet,placed=new Set(sheet.placements.map(panel=>panel.pieceId));
  sheets.push({...sheet,number:sheets.length+1});used.set(sheet.typeId,(used.get(sheet.typeId)||0)+1);remaining=remaining.filter(panel=>!placed.has(panel.pieceId));
 }
 const panelArea=sheets.reduce((sum,sheet)=>sum+sheet.panelArea,0),sheetArea=sheets.reduce((sum,sheet)=>sum+area(sheet),0);
 return {sheets,unplaced:remaining,panelArea,sheetArea,kerfArea:sheets.reduce((sum,sheet)=>sum+sheet.kerfArea,0),unusedArea:sheets.reduce((sum,sheet)=>sum+sheet.unusedArea,0)};
}
export function optimizeCutting({panels,types,rotation=true,kerf=0,objective='waste',limited=false},{budgetMs=4000}={}){
 if(!Array.isArray(panels)||!Array.isArray(types)||!panels.length||!types.length||types.length>12)throw new Error('Enter panels and available sheet sizes.');
 if(!Number.isSafeInteger(kerf)||kerf<0||!['waste','sheets'].includes(objective))throw new Error('Invalid cutter width or optimization goal.');
 for(const row of [...panels,...types])if(!Number.isSafeInteger(row.width)||!Number.isSafeInteger(row.height)||row.width<=0||row.height<=0||!Number.isSafeInteger(row.quantity)||row.quantity<1||row.quantity>MAX_PANELS)throw new Error('Invalid panel size or quantity.');
 const pieces=panels.flatMap(row=>Array.from({length:row.quantity},(_,index)=>({...row,pieceId:`${row.id}-${index+1}`,copy:index+1})));
 if(pieces.length>MAX_PANELS)throw new Error(`Use at most ${MAX_PANELS} panels.`);
 const orders=[(a,b)=>area(b)-area(a),(a,b)=>Math.max(b.width,b.height)-Math.max(a.width,a.height),(a,b)=>Math.min(b.width,b.height)-Math.min(a.width,a.height),(a,b)=>b.height-a.height,(a,b)=>b.width-a.width];
 const started=Date.now();let best,trials=0;
 const quality=plan=>[plan.unplaced.length,plan.unplaced.length?-plan.panelArea:0,...(objective==='sheets'?[plan.sheets.length,plan.sheetArea]:[plan.sheetArea,plan.sheets.length]),plan.kerfArea];
 outer:for(const sort of orders)for(const split of ['vertical','horizontal','adaptive'])for(const mode of ['efficiency','coverage','smallest']){
  if(best&&Date.now()-started>budgetMs)break outer;
  const candidate=trial([...pieces].sort(sort),types,{rotation,kerf,limited,split,mode});trials++;
  if(!best||compare(quality(candidate),quality(best))<0)best=candidate;
 }
 return {...best,requested:pieces.length,placed:pieces.length-best.unplaced.length,trials,elapsedMs:Date.now()-started,rotation,kerf,objective,limited,panels,types};
}
