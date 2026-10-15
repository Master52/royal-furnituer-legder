import {money,localNow} from './ledger.js';
import {minor} from './accounts.js';
export const currentSalaryMonth=()=>localNow().slice(0,7);
export const validSalaryMonth=value=>typeof value==='string'&&/^\d{4}-\d{2}$/.test(value)&&Number(value.slice(0,4))>=2000&&Number(value.slice(0,4))<=2200&&Number(value.slice(5))>=1&&Number(value.slice(5))<=12;
export function nextSalaryMonth(month){const [year,index]=month.split('-').map(Number);return index===12?`${year+1}-01`:`${year}-${String(index+1).padStart(2,'0')}`;}
export function salaryMetadata(transaction){try{const value=typeof transaction.metadata==='string'?JSON.parse(transaction.metadata):transaction.metadata;return value?.salaryProfileId?value:null;}catch{return null;}}
export function salaryProfiles(terms){const groups=new Map();for(const term of terms||[]){if(!groups.has(term.profileId))groups.set(term.profileId,[]);groups.get(term.profileId).push(term);}return [...groups.values()].map(versions=>{versions.sort((a,b)=>Number(a.revision)-Number(b.revision));return {...versions.at(-1),versions};});}
export function salaryTermsAt(profile,month){return profile.versions.filter(term=>term.effectiveMonth<=month).sort((a,b)=>a.effectiveMonth.localeCompare(b.effectiveMonth)||Number(a.revision)-Number(b.revision)).at(-1)||null;}
export function makeSalaryTerms(form,profile=null){
 const monthlyMinor=minor(form.monthly,'Monthly salary'),minimumMinor=minor(form.minimum,'Minimum payout'),opening=minor(form.opening||'0','Opening balance'),spreadMonths=Number(form.spreadMonths);
 if(monthlyMinor<=0||monthlyMinor>33333333333)throw new Error('Enter a monthly salary between ₹0.01 and ₹333,333,333.33.');
 if(minimumMinor<0||minimumMinor>monthlyMinor)throw new Error('Minimum payout must be between zero and the monthly salary.');
 if(!Number.isInteger(spreadMonths)||spreadMonths<1||spreadMonths>24)throw new Error('Spread adjustments over 1 to 24 months.');
 if(!form.name.trim()||form.name.trim().length>150)throw new Error('Enter a name of up to 150 characters.');
 if(!['owner','staff'].includes(form.kind))throw new Error('Choose owner or staff.');
 if(!validSalaryMonth(form.effectiveMonth))throw new Error('Choose a valid starting month.');
 if(profile&&form.effectiveMonth<currentSalaryMonth())throw new Error('Salary changes must start this month or later.');
 return {id:crypto.randomUUID(),profileId:profile?.profileId||crypto.randomUUID(),name:form.name.trim(),kind:profile?.kind||form.kind,monthlyMinor,minimumMinor,spreadMonths,effectiveMonth:form.effectiveMonth,startMonth:profile?.startMonth||form.effectiveMonth,openingBalanceMinor:profile?Number(profile.openingBalanceMinor):(form.openingDirection==='advance'?-opening:opening),_expectedRevision:profile?Number(profile.revision):0};
}
export function salaryLedger(profile,transactions,through=currentSalaryMonth()){
 if(!validSalaryMonth(through))throw new Error('Choose a valid month.');
 const payments=transactions.filter(row=>!row.deletedAt&&salaryMetadata(row)?.salaryProfileId===profile.profileId),entries=[];
 let balance=Number(profile.openingBalanceMinor),month=profile.startMonth,planMonths=0,lastTermsId='';
 for(let guard=0;month<=through;guard++,month=nextSalaryMonth(month)){
  if(guard>2412)throw new Error('Salary period is too long.');
  const terms=salaryTermsAt(profile,month);if(!terms)throw new Error('Salary terms are missing.');
  if(terms.id!==lastTermsId||planMonths<=0){planMonths=Number(terms.spreadMonths);lastTermsId=terms.id;}
  const paid=payments.filter(row=>row.transactionDate.slice(0,7)===month).reduce((sum,row)=>sum+Number(row.amountMinor),0),opening=balance;
  balance+=Number(terms.monthlyMinor)-paid;if(!Number.isSafeInteger(balance))throw new Error('Salary balance exceeds the supported limit.');
  const target=Math.min(Number(terms.monthlyMinor)*3,Math.max(Number(terms.minimumMinor),Number(terms.monthlyMinor)+Math.trunc(opening/planMonths)));
  entries.push({month,opening,earned:Number(terms.monthlyMinor),paid,closing:balance,target,remaining:Math.max(0,target-paid),cap:Number(terms.monthlyMinor)*3,terms,planMonths});
  planMonths=paid===target?Math.max(1,planMonths-1):Number(terms.spreadMonths);
  if(balance===0)planMonths=Number(terms.spreadMonths);
 }
 return {entries,balance,payments};
}
export function salarySchedule(profile,transactions,month=currentSalaryMonth()){
 const ledger=salaryLedger(profile,transactions,month),current=ledger.entries.at(-1);if(!current)return [];
 const schedule=[{month,payout:current.remaining,total:current.paid+current.remaining,closing:current.closing-current.remaining,current:true}];
 let balance=current.closing-current.remaining,remaining=current.paid>current.target?Number(current.terms.spreadMonths):Math.max(1,current.planMonths-1),cursor=nextSalaryMonth(month),lastTermsId=current.terms.id;
 for(let i=0;i<120;i++,cursor=nextSalaryMonth(cursor)){
  const terms=salaryTermsAt(profile,cursor);if(terms.id!==lastTermsId){remaining=Number(terms.spreadMonths);lastTermsId=terms.id;}const salary=Number(terms.monthlyMinor),payout=Math.min(salary*3,Math.max(Number(terms.minimumMinor),salary+Math.trunc(balance/remaining)));
  balance+=salary-payout;schedule.push({month:cursor,payout,total:payout,closing:balance});remaining=Math.max(1,remaining-1);
  if(balance===0&&schedule.length>=4)break;
 }
 return schedule;
}
export const salaryBalanceText=balance=>balance===0?'Settled':`${money(Math.abs(balance))} ${balance>0?'unpaid':'advance'}`;
export function salaryLedgerDocument(profile,ledger,preferences){return {heading:preferences.shopName,title:'Salary ledger',metadata:[profile.name,profile.kind==='owner'?'Owner withdrawals':'Staff salary',`${profile.startMonth} to ${ledger.entries.at(-1)?.month||profile.startMonth}`],columns:[['Month',.16],['Opening',.24],['Earned',.16],['Paid',.16],['Closing',.28]],rows:ledger.entries.map(row=>[row.month,salaryBalanceText(row.opening),money(row.earned),money(row.paid),salaryBalanceText(row.closing)]),totals:[['Balance',salaryBalanceText(ledger.balance)]],footer:'Positive balances are unpaid salary. Negative balances are advances. Suggested payouts are separate from actual payments.'};}
export function salaryView(accounts){
 const terms=[...(accounts.salaryTerms||[])],transactions=[...(accounts.transactions||[])];
 for(const operation of accounts.queue||[]){
  if(operation.invalid||operation.failure?.rejected||operation.endpoint&&accounts.endpoint&&operation.endpoint!==accounts.endpoint)continue;
  if(operation.action==='saveSalaryTerms'&&!terms.some(row=>row.id===operation.payload.id))terms.push({...operation.payload,revision:Number(operation.payload._expectedRevision)+1,_pending:true});
  if(operation.action==='createSalaryPayout'&&!transactions.some(row=>row.id===operation.payload.id)){const term=terms.find(row=>row.profileId===operation.payload.profileId);transactions.push({...operation.payload,metadata:{salaryProfileId:operation.payload.profileId,salaryKind:term?.kind},_pending:true});}
 }
 return {profiles:salaryProfiles(terms),transactions,pending:terms.some(row=>row._pending)||transactions.some(row=>row._pending)};
}
