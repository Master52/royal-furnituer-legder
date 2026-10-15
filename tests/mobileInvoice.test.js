import test from 'node:test';
import assert from 'node:assert/strict';
import {blankItem} from '../src/accounts.js';
import {mobileItemPreview,untouchedMobileItem} from '../src/mobileInvoice.js';
test('mobile cards reuse invoice quantity, price and discount calculations',()=>{
 const item={...blankItem(),description:'WINDOW',billingUnit:'sqft',measurementUnit:'feet',measurementMode:'dimensions',measurements:[{length:'3',width:'4',pieces:'2',description:''}],rate:'100',cost:'60',discount:'5'};
 assert.equal(mobileItemPreview(item).amountMinor,239500);assert.equal(mobileItemPreview(item).quantityText,'24 SQ. FT.');
});
test('mobile validation accepts a free item but rejects incomplete or invalid entries',()=>{
 assert.equal(mobileItemPreview({...blankItem(),description:'FREE',rate:'0'}).amountMinor,0);
 for(const item of [blankItem(),{...blankItem(),description:'BAD',rate:'1',quantity:'0'},{...blankItem(),description:'BAD',rate:'1',cost:'-1'},{...blankItem(),description:'BAD',rate:'1',discount:'2'}])assert.throws(()=>mobileItemPreview(item));
 assert.equal(untouchedMobileItem(blankItem()),true);assert.equal(untouchedMobileItem({...blankItem(),quantity:'2'}),false);
});
