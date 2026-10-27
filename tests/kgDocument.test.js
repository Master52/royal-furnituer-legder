import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {makeInvoice,blankInvoice,blankItem} from '../src/accounts.js';
import {measurementQuantityText} from '../src/measurements.js';
import {accountBackend} from './helpers/accountBackend.js';
import {invoiceImageDocument,ledgerImageDocument} from '../src/documentLayout.js';

async function loadComponent(name){
 const compiled=await build({entryPoints:[new URL(`../src/${name}.jsx`,import.meta.url).pathname],write:false,bundle:true,format:'esm',platform:'node',plugins:[{name:'shared-react',setup(builder){builder.onResolve({filter:/^react$/},()=>({path:import.meta.resolve('react'),external:true}));}}]});
 return (await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'))).default;
}
const preferences={shopName:'Test shop',printContact:false,printNotes:false};
const partyId='kg-render-party-00000001',invoiceId='kg-render-invoice-000001';
function invoice(){
 return {...makeInvoice({...blankInvoice(),partyId,items:[{...blankItem(),description:'ALUMINIUM COATED',billingUnit:'kg',grouped:true,rate:'470',cost:'460',measurements:[{description:'',quantity:'13',pieces:'1'},{description:'',quantity:'-3',pieces:'1'}]}]},invoiceId),invoiceNumber:'RF-S-000001',partyName:'TEST',status:'issued'};
}

test('13 kg minus 3 kg renders in queued and confirmed invoices and detailed statements without crashing',async()=>{
 const InvoiceDocument=await loadComponent('InvoiceDocument'),PartyStatement=await loadComponent('PartyStatement');
 const payload=invoice();assert.equal(payload.items[0].quantityMilli,10000);assert.equal(payload.totalMinor,470000);assert.equal(payload.costTotalMinor,460000);
 const backend=accountBackend();assert.equal(backend.post('createParty',{id:partyId,schemaVersion:1,name:'TEST',phone:'',address:'',openingDate:'2026-01-01',openingBalanceMinor:0}).ok,true);
 const saved=backend.post('createInvoice',payload);assert.equal(saved.ok,true,saved.error);
 for(const record of [{...payload,_pending:true},saved.record]){
  const html=renderToStaticMarkup(React.createElement(InvoiceDocument,{invoice:record,preferences}));
  assert.match(html,/\+13 KG × 1 → \+13 KG/);assert.match(html,/-3 KG × 1 → -3 KG/);assert.match(html,/>10 KG</);assert.match(html,/4,700\.00/);
  const statement={opening:0,closing:470000,entries:[{id:record.id,date:record.invoiceDate,description:record.invoiceNumber,delta:470000,balance:470000,invoice:record}]};
  const ledger=renderToStaticMarkup(React.createElement(PartyStatement,{party:{name:'TEST'},statement,preferences,range:['2026-01-01','2026-12-31'],detailed:true}));
  assert.match(ledger,/-3 KG × 1 → -3 KG/);assert.match(ledger,/>10 KG</);
  assert.match(JSON.stringify(invoiceImageDocument(record,preferences)),/-3 KG/);
  assert.match(JSON.stringify(ledgerImageDocument({party:{name:'TEST'},statement,range:['2026-01-01','2026-12-31'],detailed:true},preferences)),/-3 KG/);
 }
});
test('signed KG display rows apply Pieces and allow individual rows larger than the net-group limit',()=>{
 const item={billingUnit:'kg'};
 assert.equal(measurementQuantityText(item,{quantityMilli:-1200,pieces:2}),'-2.4 KG');
 assert.equal(measurementQuantityText(item,{quantityMilli:-1,pieces:1}),'-0.001 KG');
 assert.equal(measurementQuantityText(item,{quantityMilli:1000000000,pieces:2}),'+2000000 KG');
});
