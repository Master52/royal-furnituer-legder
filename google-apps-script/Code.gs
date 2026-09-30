// Bind this script to your Google Sheet, run setup(), then deploy as a web app.
const BACKEND_VERSION = '1.8.1';
const HEADERS = ['id','schemaVersion','transactionDate','transactionTime','timezone','direction','category','method','amountMinor','currency','party','notes','chequeDate','createdAt','metadata','deletedAt','updatedAt','revision','lastEditId','restoredAt','lastRestoreDeletedAt','recordType','cashReceivedMinor','cashChangeMinor','onlineChangeMinor','fromMethod','toMethod','expectedCashMinor','countedCashMinor','cashAdjustmentMinor','expectedOnlineMinor','countedOnlineMinor','onlineAdjustmentMinor','partyId'];

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  ensureSheet_(ss);
  ensureAccounts_(ss);
  const report = ss.getSheetByName('Report') || ss.insertSheet('Report');
  report.getRange('A1:A3').setValues([['Shop Ledger — Payment report'],['Start date'],['End date']]);
  const defaults = currentReportMonth_(ss);
  ['B2','B3'].forEach((cell,index) => {
    const range = report.getRange(cell);
    if (String(range.getValue()).trim() === '') range.setNumberFormat('@').setValue(defaults[index]);
  });
  SpreadsheetApp.flush();
  refreshReport();
}
function currentReportMonth_(ss) {
  const month = Utilities.formatDate(new Date(),ss.getSpreadsheetTimeZone(),'yyyy-MM');
  const parts = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(parts[0],parts[1],0)).getUTCDate();
  return [month+'-01',month+'-'+lastDay];
}
// Run this explicitly to repair report dates without changing any transactions.
function resetReportDates() {
  const ss = spreadsheet_();
  const report = ss.getSheetByName('Report') || ss.insertSheet('Report');
  report.getRange('B2:B3').setNumberFormat('@').setValues(currentReportMonth_(ss).map(date => [date]));
  SpreadsheetApp.flush();
  setup();
}
function reportDate_(value, timezone) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) return Utilities.formatDate(value,timezone,'yyyy-MM-dd');
  return typeof value === 'string' ? value.trim() : '';
}
function onOpen() { SpreadsheetApp.getUi().createMenu('Shop Ledger').addItem('Refresh report','refreshReport').addToUi(); }
function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Run setup() in the Apps Script editor first.');
  return SpreadsheetApp.openById(id);
}
function ensureSheet_(ss) {
  const sheet = ss.getSheetByName('Transactions') || ss.insertSheet('Transactions');
  let headers = sheet.getLastColumn() ? sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0] : [];
  HEADERS.forEach(name => { if (headers.indexOf(name) < 0) { headers.push(name); sheet.getRange(1,headers.length).setValue(name); } });
  sheet.setFrozenRows(1);
  sheet.getRange(1,1,1,headers.length).setBackground('#214c3f').setFontColor('#ffffff').setFontWeight('bold');
  return {sheet,headers};
}
function records_(sheet,headers) {
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2,1,sheet.getLastRow()-1,headers.length).getValues().filter(row => row[headers.indexOf('id')]).map(row => Object.fromEntries(headers.map((key,i) => [key,row[i]])));
}
function json_(data) { return ContentService.createTextOutput(JSON.stringify({...data,backendVersion:BACKEND_VERSION})).setMimeType(ContentService.MimeType.JSON); }
function doGet() {
  try { const db = ensureSheet_(spreadsheet_()); return json_({ok:true,transactions:records_(db.sheet,db.headers).filter(t => !t.deletedAt)}); }
  catch (error) { return json_({ok:false,error:'Could not load records. Check the script setup and permissions.'}); }
}
function validDate_(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value; }
function integerValue_(value) { if (typeof value === 'number') return Number.isSafeInteger(value) ? value : NaN; if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) { const parsed=Number(value); return Number.isSafeInteger(parsed) ? parsed : NaN; } return NaN; }
function validMinor_(value) { const amount=integerValue_(value); return amount>0 && amount<=100000000000; }
function validate_(t) {
  if (!t || typeof t.id !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(t.id)) throw new Error('Invalid transaction ID.');
  if (t.schemaVersion !== 1 || !Number.isSafeInteger(t.amountMinor) || t.amountMinor <= 0 || t.amountMinor > 100000000000 || t.currency !== 'INR') throw new Error('Invalid amount, currency or schema version.');
  if (!validDate_(t.transactionDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.transactionTime)) throw new Error('Invalid transaction date or time.');
  if (typeof t.party !== 'string' || t.party.length > 150 || typeof t.notes !== 'string' || t.notes.length > 1000 || typeof t.timezone !== 'string' || t.timezone.length > 100) throw new Error('Invalid name, notes or timezone.');
  if (t.recordType === 'adjustment') {
    const fields=['expectedCashMinor','countedCashMinor','cashAdjustmentMinor','expectedOnlineMinor','countedOnlineMinor','onlineAdjustmentMinor'];
    const values=fields.map(key=>integerValue_(t[key]));
    if (!['adjustment','adjustment-cash','adjustment-online'].includes(t.direction) || t.category!=='Cashflow adjustment' || t.method!=='Adjustment' || values.some(value=>!Number.isSafeInteger(value) || Math.abs(value)>100000000000) || (t.direction!=='adjustment-online'&&values[1]<0) || (t.direction!=='adjustment-cash'&&values[4]<0) || values[2]!==values[1]-values[0] || values[5]!==values[4]-values[3] || t.amountMinor!==Math.abs(values[2])+Math.abs(values[5])) throw new Error('Invalid or unbalanced cashflow adjustment.');
    t.chequeDate=''; t.cashReceivedMinor=''; t.cashChangeMinor=''; t.onlineChangeMinor=''; t.fromMethod=''; t.toMethod='';
    return;
  }
  if (t.recordType === 'transfer') {
    if (t.direction !== 'transfer' || t.category !== 'Transfer' || t.method !== 'Transfer' || !['Cash','Online'].includes(t.fromMethod) || !['Cash','Online'].includes(t.toMethod) || t.fromMethod === t.toMethod) throw new Error('Invalid cash/online transfer.');
    t.chequeDate = ''; t.cashReceivedMinor = ''; t.cashChangeMinor = ''; t.onlineChangeMinor = '';
    return;
  }
  if (t.recordType && t.recordType !== 'payment') throw new Error('Invalid transaction type.');
  t.recordType = 'payment';
  if (!['in','out'].includes(t.direction) || !['Sale','Purchase','Bhara','Expense'].includes(t.category) || !['Cash','Online','Cheque'].includes(t.method)) throw new Error('Invalid payment details.');
  if (t.method === 'Cheque' && !validDate_(t.chequeDate)) throw new Error('Cheque given date is required.');
  const cashSale = t.category === 'Sale' && t.direction === 'in' && t.method === 'Cash';
  if (cashSale) {
    const cashReceived = t.cashReceivedMinor === '' || t.cashReceivedMinor == null ? t.amountMinor : integerValue_(t.cashReceivedMinor);
    const cashChange = t.cashChangeMinor === '' || t.cashChangeMinor == null ? 0 : integerValue_(t.cashChangeMinor);
    const onlineChange = t.onlineChangeMinor === '' || t.onlineChangeMinor == null ? 0 : integerValue_(t.onlineChangeMinor);
    if (![cashReceived,cashChange,onlineChange].every(value => Number.isSafeInteger(value) && value >= 0) || cashReceived > 100000000000 || cashChange > 100000000000 || onlineChange > 100000000000 || cashReceived !== t.amountMinor + cashChange + onlineChange) throw new Error('Cash received must equal the sale amount plus cash and online change returned.');
    t.cashReceivedMinor = cashReceived; t.cashChangeMinor = cashChange; t.onlineChangeMinor = onlineChange;
  } else {
    t.cashReceivedMinor = ''; t.cashChangeMinor = ''; t.onlineChangeMinor = '';
  }
  t.fromMethod = ''; t.toMethod = '';
}
function comparable_(t,key) {
  if (key === 'recordType') return t.recordType || 'payment';
  if (['expectedCashMinor','countedCashMinor','cashAdjustmentMinor','expectedOnlineMinor','countedOnlineMinor','onlineAdjustmentMinor'].includes(key)) return t[key] ?? '';
  const cashSale = t.category === 'Sale' && t.direction === 'in' && t.method === 'Cash';
  if (cashSale && key === 'cashReceivedMinor' && (t[key] === '' || t[key] == null)) return Number(t.amountMinor);
  if (cashSale && ['cashChangeMinor','onlineChangeMinor'].includes(key) && (t[key] === '' || t[key] == null)) return 0;
  return t[key] ?? '';
}
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    if (!e || !e.postData || e.postData.contents.length > 100000) throw new Error('Invalid request.');
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'list' || body.action === 'listDeleted') {
      const db = ensureSheet_(spreadsheet_());
      return json_({ok:true,transactions:records_(db.sheet,db.headers).filter(t => body.action==='listDeleted' ? Boolean(t.deletedAt) : !t.deletedAt)});
    }
    if (['listAccounts','createParty','updateParty','createInvoice','cancelInvoice'].includes(body.action)) {
      lock.waitLock(25000);
      return json_(accountAction_(body.action, body.transaction));
    }
    if (!['create','update','delete','restore'].includes(body.action)) throw new Error('Unsupported action. Update the Apps Script deployment to the latest version.');
    const t = body.transaction;
    if (body.action === 'create' || body.action === 'update') validate_(t);
    else if (!t || typeof t.id !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(t.id)) throw new Error('Invalid transaction ID.');
    lock.waitLock(25000);
    const {sheet,headers} = ensureSheet_(spreadsheet_());
    const existing = records_(sheet,headers).find(row => row.id === t.id);
    // Older clients must not silently detach a linked payment during edits.
    if (body.action === 'update' && existing?.partyId && t.partyId === undefined) throw new Error('Update the app before editing a party-linked payment.');
    if (body.action === 'create' || body.action === 'update') {
      if (t.partyId == null) t.partyId='';
      if (typeof t.partyId!=='string') throw new Error('Invalid party ID.');
      if (t.partyId) validatePaymentParty_(t);
    }
    if (body.action === 'restore') {
      if (!existing) throw new Error('Transaction not found. Reload deleted transactions.');
      if (typeof t.deletedAt !== 'string' || !t.deletedAt || !Number.isSafeInteger(t._expectedRevision) || t._expectedRevision < 0) throw new Error('Invalid restore request.');
      if (!existing.deletedAt && existing.lastRestoreDeletedAt === t.deletedAt) return json_({ok:true,id:t.id,restored:true,transaction:existing});
      if (!existing.deletedAt || existing.deletedAt !== t.deletedAt || Number(existing.revision || 0) !== t._expectedRevision) throw new Error('This record changed. Reload deleted transactions before restoring.');
      const ids=sheet.getRange(2,headers.indexOf('id')+1,sheet.getLastRow()-1,1).getValues();
      const rowIndex=ids.findIndex(row=>row[0]===t.id)+2;
      const changed={...existing,deletedAt:'',restoredAt:new Date().toISOString(),lastRestoreDeletedAt:existing.deletedAt,revision:Number(existing.revision || 0)+1,lastEditId:''};
      const values=sheet.getRange(rowIndex,1,1,headers.length).getValues()[0];
      ['deletedAt','restoredAt','lastRestoreDeletedAt','revision','lastEditId'].forEach(key=>{values[headers.indexOf(key)]=changed[key];});
      sheet.getRange(rowIndex,1,1,headers.length).setValues([values.map(value => typeof value === 'string' && /^[=+\-@]/.test(value) ? "'"+value : value)]);SpreadsheetApp.flush();
      return json_({ok:true,id:t.id,restored:true,transaction:changed});
    }
    if (body.action === 'update') {
      const reject = message => { const error = new Error(message); error.code = 'EDIT_CONFLICT'; throw error; };
      if (!existing || existing.deletedAt) reject('This payment no longer exists or has been deleted. Reload the latest records.');
      if (typeof t._editId !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(t._editId) || !Number.isSafeInteger(t._expectedRevision) || t._expectedRevision < 0) throw new Error('Invalid edit request.');
      const fields = ['recordType','transactionDate','transactionTime','direction','category','method','amountMinor','currency','party','partyId','notes','chequeDate','cashReceivedMinor','cashChangeMinor','onlineChangeMinor','fromMethod','toMethod',...(t.recordType==='adjustment'?['expectedCashMinor','countedCashMinor','cashAdjustmentMinor','expectedOnlineMinor','countedOnlineMinor','onlineAdjustmentMinor']:[])];
      if (t.method !== 'Cheque') t.chequeDate = '';
      if (existing.lastEditId === t._editId) {
        if (fields.some(key => String(comparable_(existing,key)) !== String(comparable_(t,key)))) reject('This edit ID was already used for different changes.');
        return json_({ok:true,id:t.id,updated:true,transaction:existing});
      }
      if (Number(existing.revision || 0) !== t._expectedRevision) reject('This payment changed on another device. Reload it before editing again.');
      const ids = sheet.getRange(2,headers.indexOf('id')+1,sheet.getLastRow()-1,1).getValues();
      const rowIndex = ids.findIndex(row => row[0] === t.id)+2;
      const values = sheet.getRange(rowIndex,1,1,headers.length).getValues()[0];
      const changed = {...existing};
      fields.forEach(key => { changed[key] = t[key]; });
      changed.updatedAt = new Date().toISOString(); changed.revision = Number(existing.revision || 0)+1; changed.lastEditId = t._editId;
      [...fields,'updatedAt','revision','lastEditId'].forEach(key => {
        const value = changed[key];
        values[headers.indexOf(key)] = typeof value === 'string' && /^[=+\-@]/.test(value) ? "'"+value : value;
      });
      sheet.getRange(rowIndex,1,1,headers.length).setValues([values.map(value => typeof value === 'string' && /^[=+\-@]/.test(value) ? "'"+value : value)]);
      SpreadsheetApp.flush();
      return json_({ok:true,id:t.id,updated:true,transaction:changed});
    }
    if (body.action === 'delete') {
      if (!existing) throw new Error('Transaction not found. Refresh your records.');
      if (!existing.deletedAt) {
        const ids = sheet.getRange(2,headers.indexOf('id')+1,sheet.getLastRow()-1,1).getValues();
        const rowIndex = ids.findIndex(row => row[0] === t.id)+2;
        const values=sheet.getRange(rowIndex,1,1,headers.length).getValues()[0];
        values[headers.indexOf('deletedAt')]=new Date().toISOString();
        values[headers.indexOf('revision')]=Number(existing.revision || 0)+1;
        values[headers.indexOf('lastEditId')]='';
        sheet.getRange(rowIndex,1,1,headers.length).setValues([values.map(value => typeof value === 'string' && /^[=+\-@]/.test(value) ? "'"+value : value)]);
        SpreadsheetApp.flush();
      }
      return json_({ok:true,id:t.id,deleted:true});
    }
    if (existing) {
      if (existing.deletedAt) throw new Error('This transaction has been deleted. It cannot be recreated with the same ID.');
      const fields = ['recordType','amountMinor','transactionDate','transactionTime','direction','category','method','party','partyId','notes','chequeDate','cashReceivedMinor','cashChangeMinor','onlineChangeMinor','fromMethod','toMethod','expectedCashMinor','countedCashMinor','cashAdjustmentMinor','expectedOnlineMinor','countedOnlineMinor','onlineAdjustmentMinor'];
      if (fields.some(key => String(comparable_(existing,key) || '') !== String(comparable_(t,key) || ''))) throw new Error('This ID already belongs to a different payment.');
      return json_({ok:true,id:t.id,duplicate:true});
    }
    t.createdAt = new Date().toISOString(); t.metadata = '{}'; t.deletedAt = ''; t.updatedAt = ''; t.revision = 0; t.lastEditId = ''; t.restoredAt = ''; t.lastRestoreDeletedAt = '';
    if (t.method !== 'Cheque') t.chequeDate = '';
    const row = headers.map(key => HEADERS.includes(key) ? (t[key] ?? '') : '');
    const range = sheet.getRange(sheet.getLastRow()+1,1,1,headers.length);
    range.setNumberFormat('@');
    // Literal text prevents customer names/notes from executing spreadsheet formulas.
    range.setValues([row.map(value => typeof value === 'string' && /^[=+\-@]/.test(value) ? "'"+value : value)]);
    SpreadsheetApp.flush();
    return json_({ok:true,id:t.id});
  } catch (error) { return json_({ok:false,code:error.code || 'REQUEST_FAILED',error:error.message || 'Could not process request.'}); }
  finally { if (lock.hasLock()) lock.releaseLock(); }
}
function refreshReport() {
  const ss = spreadsheet_(), {sheet,headers} = ensureSheet_(ss);
  const report = ss.getSheetByName('Report');
  if (!report) throw new Error('Run setup() first.');
  const date = value => reportDate_(value,ss.getSpreadsheetTimeZone());
  const start = date(report.getRange('B2').getValue()), end = date(report.getRange('B3').getValue());
  if (!validDate_(start)) throw new Error('Report!B2 must contain a date or YYYY-MM-DD text. Run resetReportDates to use this month.');
  if (!validDate_(end)) throw new Error('Report!B3 must contain a date or YYYY-MM-DD text. Run resetReportDates to use this month.');
  if (start > end) throw new Error('Report!B2 (start date) must be on or before Report!B3 (end date). Run resetReportDates to use this month.');
  const activeRows = records_(sheet,headers).filter(t => !t.deletedAt);
  const seenIds = new Set();
  for (const t of activeRows) {
    if (seenIds.has(t.id)) throw new Error('Cannot refresh report: transaction ID '+t.id+' appears more than once. Remove or repair the duplicate row.');
    seenIds.add(t.id);
    if (!validMinor_(t.amountMinor)) throw new Error('Cannot refresh report: transaction '+t.id+' has an invalid amount in Transactions. Correct that row and retry.');
    if (!validDate_(t.transactionDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.transactionTime)) throw new Error('Cannot refresh report: transaction '+t.id+' has an invalid date or time. Correct that row and retry.');
    if (t.recordType === 'transfer') {
      if (t.direction !== 'transfer' || t.category !== 'Transfer' || !['Cash','Online'].includes(t.fromMethod) || !['Cash','Online'].includes(t.toMethod) || t.fromMethod === t.toMethod) throw new Error('Cannot refresh report: cash/online exchange '+t.id+' has invalid balance fields. Correct that row and retry.');
    } else if (t.recordType === 'adjustment') {
      try { validate_({...t,amountMinor:Number(t.amountMinor)}); } catch (_) { throw new Error('Cannot refresh report: cashflow adjustment '+t.id+' has invalid balance fields. Correct that row and retry.'); }
    } else {
      if ((t.recordType && t.recordType !== 'payment') || !['in','out'].includes(t.direction) || !['Sale','Purchase','Bhara','Expense'].includes(t.category) || !['Cash','Online','Cheque'].includes(t.method) || (t.method==='Cheque' && !validDate_(t.chequeDate))) throw new Error('Cannot refresh report: transaction '+t.id+' has invalid type, method, direction or cheque date. Correct that row and retry.');
      if (t.category === 'Sale' && t.direction === 'in' && t.method === 'Cash' && t.cashReceivedMinor !== '' && t.cashReceivedMinor != null) {
        const received=integerValue_(t.cashReceivedMinor),cashChange=integerValue_(t.cashChangeMinor || 0),onlineChange=integerValue_(t.onlineChangeMinor || 0);
        if (![received,cashChange,onlineChange].every(Number.isSafeInteger) || [received,cashChange,onlineChange].some(value=>value<0 || value>100000000000) || received!==Number(t.amountMinor)+cashChange+onlineChange) throw new Error('Cannot refresh report: cash change details for transaction '+t.id+' do not balance. Correct that row and retry.');
      }
    }
  }
  const rows = activeRows.filter(t => t.transactionDate >= start && t.transactionDate <= end);
  const output = [['Category','Payment in (INR)','Payment out (INR)','Net movement (INR)','Count']];
  ['Sale','Purchase','Bhara','Expense'].forEach(category => {
    const selected = rows.filter(t=>t.category===category);
    const incoming = selected.filter(t=>t.direction==='in').reduce((s,t)=>s+Number(t.amountMinor),0)/100;
    const outgoing = selected.filter(t=>t.direction==='out').reduce((s,t)=>s+Number(t.amountMinor),0)/100;
    output.push([category,incoming,outgoing,incoming-outgoing,selected.length]);
  });
  const total = index => output.slice(1).reduce((sum,row)=>sum+row[index],0);
  output.push(['TOTAL',total(1),total(2),total(3),total(4)]);
  report.getRange(5,1,output.length,5).setValues(output);
  report.getRange('B6:D10').setNumberFormat('#,##0.00');
  report.getRange('A5:E5').setBackground('#214c3f').setFontColor('#ffffff').setFontWeight('bold');
  report.getRange('A12:B12').setValues([['Report generated',new Date()]]);
  report.autoResizeColumns(1,5);
}

// Additive account schema. Issued invoices are immutable; corrections cancel and replace.
const ACCOUNT_HEADERS = {
  Parties: ['id','schemaVersion','name','phone','address','openingDate','openingBalanceMinor','createdAt','updatedAt','revision','lastEditId','archivedAt'],
  Invoices: ['id','schemaVersion','partyId','partyName','partyPhone','partyAddress','type','invoiceNumber','invoiceDate','notes','currency','totalMinor','costTotalMinor','itemCount','status','createdAt','cancelledAt','cancelReason'],
  InvoiceItems: ['id','invoiceId','description','quantityMilli','rateMinor','discountMinor','lineTotalMinor','costMinor','lineCostMinor']
};
function accountSheet_(ss, name) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  const headers = sheet.getLastColumn() ? sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0] : [];
  ACCOUNT_HEADERS[name].forEach(key => { if (!headers.includes(key)) { headers.push(key); sheet.getRange(1,headers.length).setValue(key); } });
  sheet.setFrozenRows(1);
  return {sheet,headers};
}
function ensureAccounts_(ss) { Object.keys(ACCOUNT_HEADERS).forEach(name => accountSheet_(ss,name)); }
function accountRows_(ss, name) { const db=accountSheet_(ss,name); return records_(db.sheet,db.headers); }
function accountWrite_(ss, name, value, update=false) {
  const {sheet,headers}=accountSheet_(ss,name);
  const ids=sheet.getLastRow()>1 ? sheet.getRange(2,headers.indexOf('id')+1,sheet.getLastRow()-1,1).getValues() : [];
  const found=ids.findIndex(row=>row[0]===value.id);
  if (found>=0 && !update) throw new Error('This ID already exists.');
  const rowIndex=found>=0?found+2:sheet.getLastRow()+1;
  const previous=found>=0?sheet.getRange(rowIndex,1,1,headers.length).getValues()[0]:[];
  const row=headers.map((key,index)=>Object.prototype.hasOwnProperty.call(value,key)?value[key]??'':previous[index]??'');
  sheet.getRange(rowIndex,1,1,headers.length).setNumberFormat('@').setValues([row.map(value=>typeof value==='string' && /^\s*[=+\-@]/.test(value)?"'"+value:value)]);
}
function accountId_(id) { if (typeof id!=='string' || !/^[a-zA-Z0-9-]{20,80}$/.test(id)) throw new Error('Invalid record ID.'); }
function accountText_(value, max, required=false) {
  if (typeof value!=='string' || value.length>max || (required&&!value.trim())) throw new Error('Invalid or missing text field.');
  return value.trim();
}
function accountAmount_(value, signed=false) {
  if (!Number.isSafeInteger(value) || Math.abs(value)>100000000000 || (!signed && value<0)) throw new Error('Invalid account amount.');
  return value;
}
function accountSame_(a,b,fields) { return fields.every(key=>String(a[key]??'')===String(b[key]??'')); }
function validatePaymentParty_(t) {
  accountId_(t.partyId);
  if (t.recordType && t.recordType!=='payment') throw new Error('Only payments can affect a party balance.');
  const party=accountRows_(spreadsheet_(),'Parties').find(p=>p.id===t.partyId);
  if (!party || party.archivedAt) throw new Error('Party not found or archived. Refresh the party list.');
  if (t.transactionDate<party.openingDate) throw new Error('Party payments cannot predate the opening balance date.');
}
function normalizedInvoice_(t, allowBlankNumber=false) {
  accountId_(t.id); accountId_(t.partyId);
  if (t.schemaVersion!==1 || t.currency!=='INR' || !['sale','purchase'].includes(t.type) || !validDate_(t.invoiceDate)) throw new Error('Invalid invoice details.');
  const invoice={id:t.id,schemaVersion:1,partyId:t.partyId,type:t.type,invoiceNumber:allowBlankNumber && !t.invoiceNumber?'':accountText_(t.invoiceNumber,80,true),invoiceDate:t.invoiceDate,notes:accountText_(t.notes,1000),currency:'INR'};
  if (!Array.isArray(t.items) || !t.items.length || t.items.length>50) throw new Error('An invoice needs 1–50 items.');
  let total=0,cost=0,complete=true;
  const items=t.items.map((item,index)=>{
    if (item.id!==t.id+'-'+(index+1) || item.invoiceId!==t.id) throw new Error('Invalid invoice item ID.');
    const quantity=item.quantityMilli;
    if (!Number.isSafeInteger(quantity) || quantity<=0 || quantity>1000000000) throw new Error('Invalid item quantity.');
    const rate=accountAmount_(item.rateMinor),discount=accountAmount_(item.discountMinor);
    if (!Number.isSafeInteger(rate*quantity)) throw new Error('Item value is too large.');
    const lineTotal=accountAmount_(Math.round(rate*quantity/1000)-discount);
    const unitCost=t.type==='sale' && item.costMinor!==null && item.costMinor!=='' && item.costMinor!==undefined ? accountAmount_(item.costMinor) : null;
    if (unitCost!==null && !Number.isSafeInteger(unitCost*quantity)) throw new Error('Item cost is too large.');
    const lineCost=unitCost===null?null:accountAmount_(Math.round(unitCost*quantity/1000));
    total+=lineTotal;
    if (lineCost===null) complete=false; else cost+=lineCost;
    return {id:item.id,invoiceId:t.id,description:accountText_(item.description,300,true),quantityMilli:quantity,rateMinor:rate,discountMinor:discount,lineTotalMinor:lineTotal,costMinor:unitCost,lineCostMinor:lineCost};
  });
  if (total<=0) throw new Error('Invoice total must be positive.');
  accountAmount_(total); accountAmount_(cost);
  return {...invoice,totalMinor:total,costTotalMinor:complete?cost:null,itemCount:items.length,items};
}
// Reads never initialize/format tabs. Setup and write paths own schema upgrades.
function accountReadRows_(ss,name) {
  const sheet=ss.getSheetByName(name);
  if(!sheet)return [];
  const rowCount=sheet.getLastRow(),columnCount=sheet.getLastColumn();
  if(!rowCount || !columnCount)return [];
  const values=sheet.getRange(1,1,rowCount,columnCount).getValues();
  const headers=values[0],idIndex=headers.indexOf('id');
  if(idIndex<0 || (ACCOUNT_HEADERS[name] && ACCOUNT_HEADERS[name].some(key=>!headers.includes(key)))) throw new Error('Run setup() to update the '+name+' headers.');
  return values.slice(1).filter(row=>row[idIndex]).map(row=>Object.fromEntries(headers.map((key,index)=>[key,row[index]])));
}
function accountAction_(action,t) {
  const ss=spreadsheet_();
  if (action==='listAccounts') {
    const parties=accountReadRows_(ss,'Parties'), headers=accountReadRows_(ss,'Invoices'), items=accountReadRows_(ss,'InvoiceItems');
    const itemsByInvoice=new Map(),partiesById=new Map(parties.map(p=>[p.id,p]));
    items.forEach(item=>{if(!itemsByInvoice.has(item.invoiceId))itemsByInvoice.set(item.invoiceId,[]);itemsByInvoice.get(item.invoiceId).push(item);});
    const invoices=headers.map(invoice=>{
      const lines=(itemsByInvoice.get(invoice.id)||[]).sort((a,b)=>Number(a.id.split('-').pop())-Number(b.id.split('-').pop()));
      if (lines.length!==Number(invoice.itemCount)) throw new Error('Invoice '+invoice.invoiceNumber+' has missing or duplicate items. Repair the test Sheet before continuing.');
      // Sheet text-formatted numbers are normalized before validation and returned consistently.
      const normalized=normalizedInvoice_({...invoice,schemaVersion:Number(invoice.schemaVersion),items:lines.map(item=>({...item,quantityMilli:Number(item.quantityMilli),rateMinor:Number(item.rateMinor),discountMinor:Number(item.discountMinor),costMinor:item.costMinor===''?null:Number(item.costMinor)}))});
      if (!accountSame_(invoice,normalized,['totalMinor','costTotalMinor']) || !['issued','cancelled'].includes(invoice.status)) throw new Error('Invalid invoice totals or status. Repair '+invoice.invoiceNumber+'.');
      return {...invoice,...normalized};
    });
    if (new Set(parties.map(p=>p.id)).size!==parties.length || new Set(headers.map(i=>i.id)).size!==headers.length) throw new Error('Duplicate party or invoice IDs. Repair the Sheet before continuing.');
    parties.forEach(p=>{accountId_(p.id);accountAmount_(Number(p.openingBalanceMinor),true);if(!validDate_(p.openingDate))throw new Error('Invalid party opening date.');});
    const transactions=accountReadRows_(ss,'Transactions').filter(row=>!row.deletedAt);
    [...invoices,...transactions.filter(row=>row.partyId)].forEach(row=>{const party=partiesById.get(row.partyId);if(!party || (row.invoiceDate||row.transactionDate)<party.openingDate)throw new Error('A record has a missing party or predates its opening balance. Repair the Sheet before using balances.');});
    return {ok:true,parties,invoices,transactions};
  }
  if (!t || typeof t!=='object') throw new Error('Missing record.');
  accountId_(t.id);
  let record=null;
  if (action==='createParty' || action==='updateParty') {
    const name=accountText_(t.name,150,true),phone=accountText_(t.phone,50),address=accountText_(t.address,500);
    const existing=accountRows_(ss,'Parties').find(row=>row.id===t.id);
    if (action==='updateParty') {
      if (!existing) throw new Error('Party not found.');
      accountId_(t._editId);
      const fields=['name','phone','address'];
      if (existing.lastEditId===t._editId) {
        if (!accountSame_(existing,t,fields)) throw new Error('Edit ID already used.');
        return {ok:true,id:t.id,record:existing};
      }
      if (!Number.isSafeInteger(t._expectedRevision) || Number(existing.revision||0)!==t._expectedRevision) throw new Error('Party changed on another device. Refresh before editing.');
      record={...existing,name,phone,address,updatedAt:new Date().toISOString(),revision:Number(existing.revision||0)+1,lastEditId:t._editId};
      accountWrite_(ss,'Parties',record,true);
    } else {
      if (t.schemaVersion!==1 || !validDate_(t.openingDate)) throw new Error('Invalid party opening date or schema.');
      accountAmount_(t.openingBalanceMinor,true);
      const party={id:t.id,schemaVersion:1,name,phone,address,openingDate:t.openingDate,openingBalanceMinor:t.openingBalanceMinor};
      if (existing) {
        if (!accountSame_(existing,party,Object.keys(party))) throw new Error('This ID already belongs to a different party.');
        record=existing;
      } else {record={...party,createdAt:new Date().toISOString(),updatedAt:'',revision:0,lastEditId:'',archivedAt:''};accountWrite_(ss,'Parties',record);}
    }
  } else if (action==='createInvoice') {
    const normalized=normalizedInvoice_(t,true),{items,...invoice}=normalized;
    const parties=accountRows_(ss,'Parties'),party=parties.find(p=>p.id===t.partyId);
    if (!party || party.archivedAt) throw new Error('Party not found or archived.');
    if (t.invoiceDate<party.openingDate) throw new Error('Invoice date cannot predate the party opening balance date.');
    const invoices=accountRows_(ss,'Invoices'),existing=invoices.find(row=>row.id===t.id);
    const oldItems=accountRows_(ss,'InvoiceItems').filter(row=>row.invoiceId===t.id);
    if (oldItems.some(old=>!items.some(item=>item.id===old.id&&accountSame_(old,item,ACCOUNT_HEADERS.InvoiceItems)))) throw new Error('This invoice ID was already used for different items. Retry the original request.');
    if (existing) {
      if (!accountSame_(existing,invoice,Object.keys(invoice).filter(key=>key!=='invoiceNumber'||invoice.invoiceNumber)) || oldItems.length!==items.length) throw new Error('This ID already belongs to a different invoice.');
      return {ok:true,id:t.id,record:{...existing,...normalized,invoiceNumber:existing.invoiceNumber}};
    }
    if (!invoice.invoiceNumber) {
      const prefix=t.type==='sale'?'RF-S-':'RF-P-';
      let last=0;
      invoices.forEach(row=>{
        const number=String(row.invoiceNumber||'').toUpperCase();
        if (!number.startsWith(prefix)) return;
        const match=/^RF-[SP]-(\d+)$/.exec(number);
        if (match) last=Math.max(last,Number(match[1]));
      });
      if (!Number.isSafeInteger(last) || last>=999999999999) throw new Error('Invoice number limit reached.');
      invoice.invoiceNumber=prefix+String(last+1).padStart(6,'0');
    }
    if (invoices.some(row=>String(row.invoiceNumber).toLowerCase()===invoice.invoiceNumber.toLowerCase())) throw new Error('Invoice number already exists. Refresh and retry.');
    // Items are staged first. Only a complete parent row makes them visible to readers.
    // Deterministic item IDs allow recovery if the request fails between these writes.
    items.forEach(item=>{if(!oldItems.some(old=>old.id===item.id))accountWrite_(ss,'InvoiceItems',item);});
    SpreadsheetApp.flush();
    record={...invoice,items,partyName:party.name,partyPhone:party.phone,partyAddress:party.address,status:'issued',createdAt:new Date().toISOString(),cancelledAt:'',cancelReason:''};
    accountWrite_(ss,'Invoices',record);
  } else if (action==='cancelInvoice') {
    const invoice=accountRows_(ss,'Invoices').find(row=>row.id===t.id);
    if (!invoice) throw new Error('Invoice not found.');
    const reason=accountText_(t.reason,500,true);
    record=invoice.status==='cancelled'?invoice:{...invoice,status:'cancelled',cancelledAt:new Date().toISOString(),cancelReason:reason};
    if (invoice.status!=='cancelled') accountWrite_(ss,'Invoices',record,true);
  }
  SpreadsheetApp.flush();
  return {ok:true,id:t.id,record};
}
