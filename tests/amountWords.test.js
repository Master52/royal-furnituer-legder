import test from 'node:test';
import assert from 'node:assert/strict';
import {amountWords} from '../src/amountWords.js';
test('payment amounts use Indian place names and preserve paise',()=>{
 for(const [input,expected] of [['100','one hundred'],['110000','one lakh ten thousand'],['12345678','one crore twenty three lakh forty five thousand six hundred seventy eight'],['1000000000','one hundred crore'],['0','zero'],['100.05','one hundred rupees and five paise'],['0.5','zero rupees and fifty paise'],['100.','one hundred']])assert.equal(amountWords(input),expected);
 for(const invalid of ['',null,'-1','NaN','1e5','100.001','1000000001'])assert.equal(amountWords(invalid),'');
});
