import {money} from './ledger.js';
const balanceText=balance=>balance===0?'Settled · ₹0.00':`${money(Math.abs(balance))} · ${balance>0?'Party owes you':'You owe party'}`;
import {measurementText,quantityText} from './measurements.js';
const safe=value=>String(value||'').replace(/[\r\n*_~`]+/g,' ').trim();
export function statementMessage({party,statement,range,detailed,checkedAt},preferences){
 const lines=[`*${safe(preferences.shopName)}*`,`*${detailed?'Detailed ledger statement':'Ledger statement'}*`,`Party: ${safe(party.name)}`];
 if(party.phone)lines.push(`Phone: ${safe(party.phone)}`);
 lines.push(`Period: ${range[0]} to ${range[1]}`,'',`*Opening balance: ${balanceText(statement.opening)}*`,'','────────────');
 for(const entry of statement.entries){lines.push(`*${entry.date} · ${safe(entry.description)}*`,`${entry.delta>0?'Debit':'Credit'}: ${money(Math.abs(entry.delta))}`,`Balance: ${balanceText(entry.balance)}`);
  if(detailed&&entry.invoice){if(!Array.isArray(entry.invoice.items))throw new Error('Refresh invoice details before sharing a detailed statement.');for(const item of entry.invoice.items){lines.push(`  ${safe(item.description)} · ${quantityText(item)} · ${money(item.lineTotalMinor)}`);for(const row of item.measurements||[])lines.push(`  ${safe(measurementText(item,row))}`);}}
  lines.push('');
 }
 if(!statement.entries.length)lines.push('No entries in this period.','');
 lines.push('────────────',`*Closing balance: ${balanceText(statement.closing)}*`,`As of: ${new Date(checkedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}`,'','Payments are tracked against the overall party account.');
 return lines.join('\n');
}
