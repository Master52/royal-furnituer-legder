// Bind this script to your Google Sheet, run setup(), then deploy as a web app.
const BACKEND_VERSION = '1.6.0';
const HEADERS = ['id','schemaVersion','transactionDate','transactionTime','timezone','direction','category','method','amountMinor','currency','party','notes','chequeDate','createdAt','metadata','deletedAt','updatedAt','revision','lastEditId','restoredAt','lastRestoreDeletedAt','recordType','cashReceivedMinor','cashChangeMinor','onlineChangeMinor','fromMethod','toMethod','expectedCashMinor','countedCashMinor','cashAdjustmentMinor','expectedOnlineMinor','countedOnlineMinor','onlineAdjustmentMinor'];

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  ensureSheet_(ss);
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
    if (!e || !e.postData || e.postData.contents.length > 24000) throw new Error('Invalid request.');
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'list' || body.action === 'listDeleted') {
      const db = ensureSheet_(spreadsheet_());
      return json_({ok:true,transactions:records_(db.sheet,db.headers).filter(t => body.action==='listDeleted' ? Boolean(t.deletedAt) : !t.deletedAt)});
    }
    if (!['create','update','delete','restore'].includes(body.action)) throw new Error('Unsupported action. Update the Apps Script deployment to the latest version.');
    const t = body.transaction;
    if (body.action === 'create' || body.action === 'update') validate_(t);
    else if (!t || typeof t.id !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(t.id)) throw new Error('Invalid transaction ID.');
    lock.waitLock(25000);
    const {sheet,headers} = ensureSheet_(spreadsheet_());
    const existing = records_(sheet,headers).find(row => row.id === t.id);
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
      const fields = ['recordType','transactionDate','transactionTime','direction','category','method','amountMinor','currency','party','notes','chequeDate','cashReceivedMinor','cashChangeMinor','onlineChangeMinor','fromMethod','toMethod',...(t.recordType==='adjustment'?['expectedCashMinor','countedCashMinor','cashAdjustmentMinor','expectedOnlineMinor','countedOnlineMinor','onlineAdjustmentMinor']:[])];
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
      const fields = ['recordType','amountMinor','transactionDate','transactionTime','direction','category','method','party','notes','chequeDate','cashReceivedMinor','cashChangeMinor','onlineChangeMinor','fromMethod','toMethod','expectedCashMinor','countedCashMinor','cashAdjustmentMinor','expectedOnlineMinor','countedOnlineMinor','onlineAdjustmentMinor'];
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
