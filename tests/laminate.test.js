import test from 'node:test';
import assert from 'node:assert/strict';
import {laminateEstimate} from '../src/laminate.js';
import {laminateReportHtml} from '../src/laminateReport.js';
const estimate=input=>laminateEstimate({panels:'24x32x2,30x12',panelUnit:'in',sheetWidth:'4',sheetHeight:'8',sheetUnit:'ft',faces:'1',waste:'10',price:'',...input});
test('coverage includes quantities, faces, waste and whole-sheet cost',()=>{
 const result=estimate({panels:'2x4x3',panelUnit:'ft',faces:'2',price:'1250.50'});
 assert.equal(result.coverageSqft,48);assert.equal(result.requiredSqft,52.8);assert.equal(result.wasteSqft,4.8);assert.equal(result.sheets,2);assert.equal(result.purchasedSqft,64);assert.equal(result.costMinor,250100);
 assert.equal(estimate().panels,3);assert.equal(estimate().costMinor,null);assert.equal(estimate({price:'0'}).costMinor,0);
});
test('exact sheet boundaries use whole-area arithmetic without rounding sheets down',()=>{
 const exact=estimate({panels:'4x8',panelUnit:'ft',waste:'0'});assert.equal(exact.sheets,1);
 assert.equal(estimate({panels:'4x8',panelUnit:'ft',waste:'0.01'}).sheets,2);
 assert.equal(estimate({panels:'4ft x 8ft',faces:'2',waste:'0'}).sheets,2);
 assert.equal(estimate({panels:'96soot x 96soot',waste:'0'}).coverageSqft,1);
});
test('area estimate flags oversize panels and accepts fits after rotation',()=>{
 assert.equal(estimate({panels:'5x5',panelUnit:'ft'}).tooLarge.length,1);
 assert.equal(estimate({panels:'8x4',panelUnit:'ft'}).tooLarge.length,0);
});
test('invalid sizes, faces, percentages and costs cannot produce an estimate',()=>{
 for(const input of [{panels:'24x32x0'},{sheetWidth:'0'},{faces:'3'},{waste:'-1'},{waste:'101'},{waste:'1.001'},{waste:''},{price:'-1'},{price:'1.001'},{price:'Infinity'},{price:'1000000001'}])assert.throws(()=>estimate(input));
});
test('reports contain assumptions and totals and escape shop names',()=>{
 const html=laminateReportHtml(estimate({price:'1500',faces:'2'}),{shopName:'<script>bad</script>'});
 assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));assert.ok(!html.includes('<script>'));
 for(const text of ['Both faces','10% waste','Net coverage','Sheets by area','Estimated sheet cost','not a cutting layout'])assert.ok(html.includes(text));
});
