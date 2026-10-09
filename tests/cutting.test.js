import test from 'node:test';
import assert from 'node:assert/strict';
import {optimizeCutting} from '../src/cutting.js';
import {parseCuttingSizes,cuttingLength} from '../src/cuttingInput.js';
import {sheetSvg,cuttingReportHtml,cuttingArea} from '../src/cuttingReport.js';
const plan=(panels,sheets,options={})=>optimizeCutting({panels:parseCuttingSizes(panels,'mm'),types:parseCuttingSizes(sheets,'mm',{sheets:true}),kerf:0,...options});
function inspect(result){
 const ids=new Set();for(const sheet of result.sheets){
  const rects=[...sheet.placements,...sheet.kerfs,...sheet.leftovers];
  for(const row of rects){assert.ok(row.width>0&&row.height>0);assert.ok(row.x>=0&&row.y>=0&&row.x+row.width<=sheet.width&&row.y+row.height<=sheet.height);}
  for(let a=0;a<rects.length;a++)for(let b=a+1;b<rects.length;b++){const x=rects[a],y=rects[b];assert.ok(x.x+x.width<=y.x||y.x+y.width<=x.x||x.y+x.height<=y.y||y.y+y.height<=x.y,'Rectangles must never overlap');}
  assert.equal(sheet.panelArea+sheet.kerfArea+sheet.unusedArea,sheet.width*sheet.height);
  sheet.placements.forEach(row=>{assert.ok(!ids.has(row.pieceId));ids.add(row.pieceId);});
  for(const cut of sheet.cuts)assert.ok(cut.from<cut.to&&cut.position>=0&&cut.position<=(cut.axis==='V'?sheet.width:sheet.height));
 }
 assert.equal(ids.size+result.unplaced.length,result.requested);
}
test('exact fits require no cuts or cutter loss',()=>{
 const result=plan('48x96','48x96',{kerf:cuttingLength('3','mm')});assert.equal(result.sheets.length,1);assert.equal(result.kerfArea,0);assert.equal(result.unusedArea,0);assert.equal(result.sheets[0].cuts.length,0);inspect(result);
});
test('cutter allowance prevents an impossible tight two-panel fit',()=>{
 assert.equal(plan('24x96x2','48x96',{rotation:false}).sheets.length,1);
 const result=plan('24x96x2','48x96',{rotation:false,kerf:cuttingLength('3','mm')});assert.equal(result.sheets.length,2);inspect(result);
});
test('rotation can be enabled or disabled',()=>{
 const fixed=plan('70x40','40x80',{rotation:false});assert.equal(fixed.placed,0);assert.equal(fixed.unplaced.length,1);
 const rotated=plan('70x40','40x80');assert.equal(rotated.placed,1);assert.equal(rotated.sheets[0].placements[0].rotated,true);inspect(rotated);
});
test('least waste and fewest sheets are different goals',()=>{
 const waste=plan('40x40x2','40x40,100x50',{objective:'waste'}),fewest=plan('40x40x2','40x40,100x50',{objective:'sheets'});
 assert.equal(waste.sheets.length,2);assert.equal(fewest.sheets.length,1);assert.ok(waste.sheetArea<fewest.sheetArea);inspect(waste);inspect(fewest);
});
test('finite sheet quantities are respected and unplaced panels stay visible',()=>{
 const result=plan('40x40x3','40x40x2',{limited:true});assert.equal(result.sheets.length,2);assert.equal(result.placed,2);assert.equal(result.unplaced.length,1);inspect(result);
});
test('mixed sizes and fractional cutter widths preserve bounds and material accounting',()=>{
 for(const rotation of [false,true])for(const kerf of ['0','0.1','3','12']){
  const result=plan('24x32x2,32x32x5,30x12x3,10.5x17.5x2','48x96,48x120',{rotation,kerf:cuttingLength(kerf,'mm',{zero:true})});assert.equal(result.unplaced.length,0);inspect(result);
 }
});
test('oversized panels do not prevent fitting the smaller panels',()=>{
 const result=plan('200x200,20x20x4','40x40',{kerf:cuttingLength('1','mm')});assert.equal(result.unplaced.length,1);assert.equal(result.placed,4);inspect(result);
});
test('a cut near the material edge cannot remove more material than exists',()=>{
 const result=plan('49x49','50x50',{kerf:cuttingLength('3','mm')});inspect(result);assert.equal(result.unusedArea,0);
});
test('reports contain diagrams, cut order, partial-plan warnings and escaped shop names',()=>{
 const result=plan('20x20,100x100','40x40'),html=cuttingReportHtml(result,{unit:'mm',title:'<script>alert(1)</script>'});
 assert.ok(html.includes('<svg'));assert.ok(html.includes('Cut order'));assert.ok(html.includes('Incomplete plan'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('https://'));assert.ok(sheetSvg(result.sheets[0],'mm').includes('role="img"'));
});

test('small but nonzero cutter loss is not displayed as zero',()=>{assert.notEqual(cuttingArea(288*1e8),'0');assert.equal(cuttingArea(288*1e8),'0.000288');});
