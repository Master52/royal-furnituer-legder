import test from 'node:test';
import assert from 'node:assert/strict';
import {salaryProfiles,salaryLedger,salarySchedule,salaryView,makeSalaryTerms,currentSalaryMonth} from '../src/salary.js';
import {accountBackend} from './helpers/accountBackend.js';
import {businessFigures} from '../src/business.js';
import {localNow} from '../src/ledger.js';
const month=currentSalaryMonth(),date=localNow().slice(0,10),profileId='salary-person-test-00000001';
const terms=(changes={})=>({id:'salary-terms-test-000000001',profileId,name:'Test salary',kind:'staff',monthlyMinor:2500000,minimumMinor:1000000,spreadMonths:3,startMonth:month,effectiveMonth:month,openingBalanceMinor:0,_expectedRevision:0,...changes});
const profile=(changes={})=>salaryProfiles([{...terms(changes),revision:1}])[0];
const payment=(amount,changes={})=>({id:'salary-payment-test-000001',amountMinor:amount,transactionDate:date,method:'Cash',metadata:{salaryProfileId:profileId,salaryKind:'staff'},...changes});
const payout=(amount,changes={})=>({id:'salary-payout-test-00000001',profileId,amountMinor:amount,transactionDate:date,method:'Cash',notes:'Salary',_expectedRevision:1,...changes});
function fixture(changes={}){const backend=accountBackend(),result=backend.post('saveSalaryTerms',terms(changes));assert.equal(result.ok,true,result.error);return backend;}
test('unpaid balances and advances carry exactly, with bounded finite payout schedules',()=>{
 const unpaid=profile({openingBalanceMinor:1500000}),advance=profile({openingBalanceMinor:-1500000});
 assert.deepEqual(salarySchedule(unpaid,[]).slice(0,3).map(row=>row.payout),[3000000,3000000,3000000]);
 assert.equal(salarySchedule(unpaid,[])[2].closing,0);
 assert.deepEqual(salarySchedule(advance,[]).slice(0,3).map(row=>row.payout),[2000000,2000000,2000000]);
 const hugeAdvance=salarySchedule(profile({openingBalanceMinor:-6000000}),[]);assert.deepEqual(hugeAdvance.slice(0,4).map(row=>row.payout),[1000000,1000000,1000000,1000000]);assert.equal(hugeAdvance[3].closing,0);
 const owed=salarySchedule(profile({openingBalanceMinor:20000000}),[]);assert.ok(owed.every(row=>row.payout<=7500000));assert.equal(owed.at(-1).closing,0);
 const paid=salaryLedger(profile(),[payment(4000000)]).entries[0];assert.equal(paid.closing,-1500000);assert.equal(paid.remaining,0);assert.deepEqual(salarySchedule(profile(),[payment(4000000)]).slice(1,4).map(row=>row.payout),[2000000,2000000,2000000]);
});
test('following a suggested plan settles the original balance rather than endlessly rescheduling it',()=>{
 const person=profile({startMonth:'2026-01',effectiveMonth:'2026-01',openingBalanceMinor:1500000});
 const paid=[payment(3000000,{transactionDate:'2026-01-10'}),payment(3000000,{id:'second',transactionDate:'2026-02-10'}),payment(3000000,{id:'third',transactionDate:'2026-03-10'})];
 const ledger=salaryLedger(person,paid,'2026-03');assert.deepEqual(ledger.entries.map(row=>row.target),[3000000,3000000,3000000]);assert.equal(ledger.balance,0);
});
test('settings versions preserve historic salary and future effective changes',()=>{
 const old={...terms({startMonth:'2026-01',effectiveMonth:'2026-01'}),revision:1},changed={...old,id:'salary-terms-second-000001',monthlyMinor:3000000,effectiveMonth:'2026-03',revision:2};
 const ledger=salaryLedger(salaryProfiles([old,changed])[0],[],'2026-03');assert.deepEqual(ledger.entries.map(row=>row.earned),[2500000,2500000,3000000]);assert.equal(ledger.balance,8000000);
});
test('backend saves settings and a payout as one cash movement, with identical retries',()=>{
 const backend=fixture();assert.equal(backend.post('saveSalaryTerms',terms()).record.revision,1);
 const result=backend.post('createSalaryPayout',payout(4000000));assert.equal(result.ok,true,result.error);assert.equal(result.transaction.direction,'out');assert.equal(JSON.parse(result.transaction.metadata).salaryProfileId,profileId);
 assert.equal(backend.post('createSalaryPayout',payout(4000000)).ok,true);assert.equal(backend.post('listAccounts',{}).transactions.length,1);
 assert.equal(backend.post('createSalaryPayout',payout(3000000)).ok,false);
 assert.equal(backend.post('saveSalaryTerms',terms({monthlyMinor:3000000})).ok,false);
});
test('server enforces combined monthly cap, revision conflicts and restored-payment limits',()=>{
 const backend=fixture();assert.equal(backend.post('createSalaryPayout',payout(4000000)).ok,true);
 assert.match(backend.post('createSalaryPayout',payout(4000000,{id:'salary-payout-test-00000002'})).error,/three months/);
 assert.equal(backend.post('createSalaryPayout',payout(3500000,{id:'salary-payout-test-00000002'})).ok,true);
 assert.equal(backend.post('delete',{id:'salary-payout-test-00000001'}).ok,true);
 assert.equal(backend.post('createSalaryPayout',payout(4000000,{id:'salary-payout-test-00000003'})).ok,true);
 const deleted=backend.post('listDeleted',{}).transactions[0];assert.match(backend.post('restore',{id:deleted.id,deletedAt:deleted.deletedAt,_expectedRevision:Number(deleted.revision)}).error,/three months/);
 assert.match(backend.post('createSalaryPayout',payout(1,{id:'salary-payout-test-00000004',_expectedRevision:0})).error,/settings changed/);
 assert.match(backend.post('update',{...backend.post('listAccounts',{}).transactions[0],_editId:'salary-edit-test-000000001',_expectedRevision:0}).error,/cannot be edited/);
});
test('salary decreases cannot retroactively invalidate payments or rewrite the opening balance',()=>{
 const backend=fixture();backend.post('createSalaryPayout',payout(7500000));
 assert.match(backend.post('saveSalaryTerms',terms({id:'salary-terms-second-000001',monthlyMinor:1000000,_expectedRevision:1})).error,/three months/);
 assert.match(backend.post('saveSalaryTerms',terms({id:'salary-terms-second-000001',openingBalanceMinor:1,_expectedRevision:1})).error,/cannot be changed/);
});
test('interrupted writes retry safely and salary actions require access',()=>{
 const backend=fixture();backend.failNext('Transactions');assert.equal(backend.post('createSalaryPayout',payout(1000000)).ok,false);assert.equal(backend.post('listAccounts',{}).transactions.length,0);assert.equal(backend.post('createSalaryPayout',payout(1000000)).ok,true);assert.equal(backend.post('listAccounts',{}).transactions.length,1);
 assert.equal(backend.rawPost({action:'createSalaryPayout',transaction:payout(1)}).code,'UNAUTHORIZED');
});
test('pending payouts preview once, rejected requests lose their projection, and owner withdrawals are excluded from expenses',()=>{
 const data={salaryTerms:[{...terms(),revision:1}],transactions:[],queue:[{action:'createSalaryPayout',payload:payout(1000000)}]};
 assert.equal(salaryLedger(salaryView(data).profiles[0],salaryView(data).transactions).entries[0].paid,1000000);
 data.transactions=[payment(1000000,{id:data.queue[0].payload.id})];assert.equal(salaryView(data).transactions.length,1);
 data.transactions=[];data.queue[0].failure={rejected:true};assert.equal(salaryView(data).transactions.length,0);
 const backend=fixture({kind:'owner'}),result=backend.post('createSalaryPayout',payout(1000000));assert.equal(result.ok,true,result.error);const figures=businessFigures([],[],[result.transaction],[date,date]);assert.equal(figures.paid,1000000);assert.equal(figures.expenses,0);
});
test('invalid salaries, minimums, months and payout dates are rejected',()=>{
 for(const changes of [{monthlyMinor:0},{minimumMinor:2600000},{spreadMonths:0},{effectiveMonth:'2026-13'},{kind:'unknown'}])assert.equal(accountBackend().post('saveSalaryTerms',terms(changes)).ok,false);
 const backend=fixture();assert.equal(backend.post('createSalaryPayout',payout(0)).ok,false);assert.equal(backend.post('createSalaryPayout',payout(100,{transactionDate:'2200-01-01'})).ok,false);
 assert.throws(()=>makeSalaryTerms({name:'Staff',kind:'staff',monthly:'5000',minimum:'10000',spreadMonths:3,effectiveMonth:month,opening:'0'}),/Minimum/);
});
