import test from 'node:test';
import assert from 'node:assert/strict';
import {cuttingLength,parseCuttingSizes,cuttingDimension} from '../src/cuttingInput.js';
test('panel sizes accept mixed separators and default quantity to one',()=>{
 const rows=parseCuttingSizes('24x32 x2, 32×32×5\n30x12','in');assert.deepEqual(rows.map(row=>row.quantity),[2,5,1]);assert.equal(rows[0].width,24*254000);assert.equal(cuttingDimension(rows[2].height,'ft'),'1');
});
test('unit conversions keep fractional inches and cutter widths exact',()=>{
 assert.equal(cuttingLength('0.001','in'),254);assert.equal(cuttingLength('1','ft'),cuttingLength('12','in'));assert.equal(cuttingLength('25.4','mm'),cuttingLength('1','in'));assert.equal(cuttingLength('0','mm',{zero:true}),0);
});
test('local feet, inches and soot convert consistently, including mixed dimensions',()=>{
 assert.equal(cuttingLength('8','soot'),cuttingLength('1','in'));
 assert.equal(cuttingLength('96','soot'),cuttingLength('1','ft'));
 assert.equal(cuttingLength('0.5','soot'),15875);
 assert.equal(cuttingLength('1','soot'),cuttingLength('3.175','mm'));
 assert.equal(cuttingLength('0.001','soot'),32);
 const mixed=cuttingLength('2ft 3in 2soot','in');
 assert.equal(mixed,cuttingLength('27.25','in'));
 assert.equal(cuttingLength(`2' 3" 2soot`,'ft'),mixed);
 assert.equal(cuttingLength('2 feet 3 inches 2 suta','mm'),mixed);
 const rows=parseCuttingSizes('2ft 3in 2soot x 4ft x 2, 12in x 16soot','ft');
 assert.equal(rows[0].width,mixed);assert.equal(rows[0].height,cuttingLength('4','ft'));
 assert.equal(rows[0].quantity,2);assert.equal(rows[1].height,cuttingLength('2','in'));
 assert.equal(cuttingDimension(cuttingLength('1','in'),'soot'),'8');
 for(const value of ['-2ft','1ft rubbish','2ft + 3in','1.0001soot','3unknown'])assert.throws(()=>cuttingLength(value,'ft'));
});
test('bad sizes and oversized jobs are rejected before calculation',()=>{
 for(const text of ['', '24x', '24x32x0', '24x32x2.5', '24x32x601','24x32x300,24x32x301','24x32<script>','0x32','Infinityx32'])assert.throws(()=>parseCuttingSizes(text,'in'));
 assert.throws(()=>cuttingLength('-3','mm',{zero:true}));assert.throws(()=>cuttingLength('1.0001','mm'));assert.throws(()=>cuttingLength('50001','mm'));assert.throws(()=>parseCuttingSizes(Array(13).fill('48x96').join(','),'in',{sheets:true}));
});
