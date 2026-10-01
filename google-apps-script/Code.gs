// Bind this script to your Google Sheet, run setup(), then deploy as a web app.
const BACKEND_VERSION = '1.14.0';
const HEADERS = ['id','schemaVersion','transactionDate','transactionTime','timezone','direction','category','method','amountMinor','currency','party','notes','chequeDate','createdAt','metadata','deletedAt','updatedAt','revision','lastEditId','restoredAt','lastRestoreDeletedAt','recordType','cashReceivedMinor','cashChangeMinor','onlineChangeMinor','fromMethod','toMethod','expectedCashMinor','countedCashMinor','cashAdjustmentMinor','expectedOnlineMinor','countedOnlineMinor','onlineAdjustmentMinor','partyId','deleteReason'];

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
  if(accountRequest_?.spreadsheet)return accountRequest_.spreadsheet;
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Run setup() in the Apps Script editor first.');
  const ss=SpreadsheetApp.openById(id);if(accountRequest_)accountRequest_.spreadsheet=ss;return ss;
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
let accountRequest_ = null;
function performanceSnapshot_(){const p=accountRequest_;return p?{elapsedMs:Date.now()-p.startedAt,lockWaitMs:p.lockWaitMs,reads:p.reads,readMs:p.readMs,validationMs:p.validationMs,writes:p.writes,writeMs:p.writeMs}:null;}
function json_(data) { if(accountRequest_)data={...data,performance:performanceSnapshot_()};return ContentService.createTextOutput(JSON.stringify({...data,backendVersion:BACKEND_VERSION})).setMimeType(ContentService.MimeType.JSON); }
function doGet() {
  try { const db = ensureSheet_(spreadsheet_()); return json_({ok:true,transactions:records_(db.sheet,db.headers).filter(t => !t.deletedAt)}); }
  catch (error) { return json_({ok:false,error:'Could not load records. Check the script setup and permissions.'}); }
}
function validDate_(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value; }
function integerValue_(value) { if (typeof value === 'number') return Number.isSafeInteger(value) ? value : NaN; if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) { const parsed=Number(value); return Number.isSafeInteger(parsed) ? parsed : NaN; } return NaN; }
function validMinor_(value) { const amount=integerValue_(value); return amount>0 && amount<=100000000000; }
function validate_(t){const started=Date.now();try{return validate_data_(t);}finally{if(accountRequest_)accountRequest_.validationMs+=Date.now()-started;}}
function validate_data_(t) {
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
  accountRequest_={startedAt:Date.now(),action:'unknown',lockWaitMs:0,reads:0,readMs:0,validationMs:0,writes:0,writeMs:0,tabs:new Map()};
  try {
    if (!e || !e.postData || e.postData.contents.length > 100000) throw new Error('Invalid request.');
    const body = JSON.parse(e.postData.contents);accountRequest_.action=body.action;
    if(body.action==='deletePayment'){if(!Number.isSafeInteger(body.transaction?._expectedRevision))throw new Error('Payment revision is required for bulk deletion.');body.action='delete';}
    if (body.action === 'list' || body.action === 'listDeleted') {
      const db = ensureSheet_(spreadsheet_());
      return json_({ok:true,transactions:records_(db.sheet,db.headers).filter(t => body.action==='listDeleted' ? Boolean(t.deletedAt) : !t.deletedAt)});
    }
    if (['getInvoices','listAccounts','createParty','updateParty','createInvoice','updateInvoice','cancelInvoice','createInvoiceNote','cancelInvoiceNote','deleteInvoice','deleteParty','deleteInvoiceNote','updateInvoiceNote'].includes(body.action)) {
      {const started=Date.now();lock.waitLock(25000);accountRequest_.lockWaitMs+=Date.now()-started;}
      return json_(accountAction_(body.action, body.transaction));
    }
    if (!['create','update','delete','restore'].includes(body.action)) throw new Error('Unsupported action. Update the Apps Script deployment to the latest version.');
    const t = body.transaction;
    if (body.action === 'create' || body.action === 'update') validate_(t);
    else if (!t || typeof t.id !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(t.id)) throw new Error('Invalid transaction ID.');
    {const started=Date.now();lock.waitLock(25000);accountRequest_.lockWaitMs+=Date.now()-started;}
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
      if(existing.deletedAt&&existing.partyId)validatePaymentParty_(existing);
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
        if(t._expectedRevision!==undefined&&(!Number.isSafeInteger(t._expectedRevision)||t._expectedRevision!==Number(existing.revision||0))){const error=new Error('Payment changed. Refresh before deleting.');error.code='EDIT_CONFLICT';throw error;}
        const ids = sheet.getRange(2,headers.indexOf('id')+1,sheet.getLastRow()-1,1).getValues();
        const rowIndex = ids.findIndex(row => row[0] === t.id)+2;
        const values=sheet.getRange(rowIndex,1,1,headers.length).getValues()[0];
        values[headers.indexOf('deletedAt')]=new Date().toISOString();
        values[headers.indexOf('deleteReason')]=t.reason===undefined?'':accountText_(t.reason,500,true);
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
  finally { if (lock.hasLock()) lock.releaseLock();if(accountRequest_&&PropertiesService.getScriptProperties().getProperty('LEDGER_PERF_LOGGING')==='true')console.info(JSON.stringify({event:'ledger_performance',action:accountRequest_.action,...performanceSnapshot_()}));accountRequest_=null; }
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

// Additive account schema. Revisions retain previous invoice and note snapshots.
const ACCOUNT_HEADERS = {
  Parties: ['id','schemaVersion','name','phone','address','openingDate','openingBalanceMinor','createdAt','updatedAt','revision','lastEditId','archivedAt'],
  Invoices: ['id','schemaVersion','partyId','partyName','partyPhone','partyAddress','type','invoiceNumber','invoiceDate','notes','currency','totalMinor','costTotalMinor','itemCount','status','createdAt','cancelledAt','cancelReason','revision','lastEditId','updatedAt','itemVersion','deletedAt','deleteReason','challanNumber'],
  InvoiceItems: ['id','invoiceId','description','quantityMilli','rateMinor','discountMinor','lineTotalMinor','costMinor','lineCostMinor','versionId'],
  InvoiceHistory: ['id','invoiceId','revision','changedAt','editId','snapshot'],
  InvoiceNotes: ['id','schemaVersion','invoiceId','invoiceNumber','invoiceRevision','partyId','partyName','partyPhone','partyAddress','invoiceType','type','noteNumber','noteDate','reason','effect','amountMinor','costAdjustmentMinor','currency','status','createdAt','cancelledAt','cancelReason','revision','lastEditId','updatedAt','deletedAt','deleteReason'],
  InvoiceNoteHistory: ['id','noteId','revision','changedAt','editId','snapshot']
};
const ACCOUNT_OPTIONAL_HEADERS={Invoices:['revision','lastEditId','updatedAt','itemVersion','deletedAt','deleteReason','challanNumber'],InvoiceItems:['versionId'],InvoiceNotes:['lastEditId','updatedAt','deletedAt','deleteReason']};
function accountSheet_(ss,name){
  const cached=accountRequest_?.tabs.get(name);if(cached?.db)return cached.db;
  const sheet=ss.getSheetByName(name)||ss.insertSheet(name);
  const headers=sheet.getLastColumn()?sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0]:[];
  const missing=ACCOUNT_HEADERS[name].filter(key=>!headers.includes(key));
  if(missing.length){sheet.getRange(1,headers.length+1,1,missing.length).setValues([missing]);headers.push(...missing);}
  sheet.setFrozenRows(1);const db={sheet,headers};
  if(accountRequest_)accountRequest_.tabs.set(name,{db});return db;
}
function ensureAccounts_(ss){Object.keys(ACCOUNT_HEADERS).forEach(name=>accountSheet_(ss,name));}
function accountTable_(ss,name){
  const db=accountSheet_(ss,name),cached=accountRequest_?.tabs.get(name);
  if(cached?.table)return cached.table;
  const started=Date.now(),lastRow=db.sheet.getLastRow();
  const values=lastRow>1?db.sheet.getRange(2,1,lastRow-1,db.headers.length).getValues():[];
  const idColumn=db.headers.indexOf('id'),byId=new Map(),records=[];
  values.forEach((row,index)=>{const id=row[idColumn];if(!id)return;if(byId.has(id))throw new Error('Duplicate IDs in '+name+'. Repair the Sheet before writing.');const record=Object.fromEntries(db.headers.map((key,column)=>[key,row[column]]));byId.set(id,{record,rowIndex:index+2,values:row});records.push(record);});
  const table={...db,lastRow,byId,records};if(cached)cached.table=table;
  if(accountRequest_){accountRequest_.reads++;accountRequest_.readMs+=Date.now()-started;}return table;
}
function accountRows_(ss,name){return accountTable_(ss,name).records;}
function literalAccountRow_(headers,value,previous=[]){return headers.map((key,index)=>{const cell=Object.prototype.hasOwnProperty.call(value,key)?value[key]??'':previous[index]??'';return typeof cell==='string'&&/^\s*[=+\-@]/.test(cell)?"'"+cell:cell;});}
function accountWrite_(ss,name,value,update=false){
  const table=accountTable_(ss,name),existing=table.byId.get(value.id);
  if(existing&&!update)throw new Error('This ID already exists.');
  const rowIndex=existing?existing.rowIndex:table.lastRow+1,started=Date.now();
  const row=literalAccountRow_(table.headers,value,existing?.values);
  table.sheet.getRange(rowIndex,1,1,table.headers.length).setNumberFormat('@').setValues([row]);
  const record=Object.fromEntries(table.headers.map((key,index)=>[key,Object.prototype.hasOwnProperty.call(value,key)?value[key]??'':existing?.values[index]??'']));
  table.lastRow=Math.max(table.lastRow,rowIndex);table.byId.set(value.id,{record,rowIndex,values:table.headers.map(key=>record[key])});
  if(existing)table.records=table.records.map(old=>old.id===value.id?record:old);else table.records=[...table.records,record];
  if(accountRequest_){accountRequest_.writes++;accountRequest_.writeMs+=Date.now()-started;}
}
function accountAppendRows_(ss,name,records){
  if(!records.length)return;const table=accountTable_(ss,name),ids=new Set();
  records.forEach(record=>{if(ids.has(record.id)||table.byId.has(record.id))throw new Error('This ID already exists.');ids.add(record.id);});
  const started=Date.now(),startRow=table.lastRow+1;
  const rows=records.map(record=>literalAccountRow_(table.headers,record));
  table.sheet.getRange(startRow,1,rows.length,table.headers.length).setNumberFormat('@').setValues(rows);
  records.forEach((record,index)=>{const values=table.headers.map(key=>record[key]??'');const stored=Object.fromEntries(table.headers.map((key,column)=>[key,values[column]]));table.byId.set(record.id,{record:stored,rowIndex:startRow+index,values});table.records=[...table.records,stored];});
  table.lastRow+=rows.length;if(accountRequest_){accountRequest_.writes++;accountRequest_.writeMs+=Date.now()-started;}
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
function normalizedInvoice_(t, allowBlankNumber=false){const started=Date.now();try{return normalizedInvoice_data_(t,allowBlankNumber);}finally{if(accountRequest_)accountRequest_.validationMs+=Date.now()-started;}}
function normalizedInvoice_data_(t, allowBlankNumber=false) {
  accountId_(t.id); accountId_(t.partyId);
  if (t.schemaVersion!==1 || t.currency!=='INR' || !['sale','purchase'].includes(t.type) || !validDate_(t.invoiceDate)) throw new Error('Invalid invoice details.');
  const version=t.itemVersion||'';
  if(version)accountId_(version);
  const invoice={id:t.id,schemaVersion:1,partyId:t.partyId,type:t.type,invoiceNumber:allowBlankNumber && !t.invoiceNumber?'':accountText_(t.invoiceNumber,80,true),invoiceDate:t.invoiceDate,challanNumber:accountText_(t.challanNumber??'',80),notes:accountText_(t.notes,1000),currency:'INR',itemVersion:version};
  if (!Array.isArray(t.items) || !t.items.length || t.items.length>50) throw new Error('An invoice needs 1–50 items.');
  let total=0,cost=0,complete=true;
  const items=t.items.map((item,index)=>{
    if (item.id!==t.id+'-'+(version?version+'-':'')+(index+1) || item.invoiceId!==t.id) throw new Error('Invalid invoice item ID.');
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
    return {id:item.id,invoiceId:t.id,description:accountText_(item.description,300,true),quantityMilli:quantity,rateMinor:rate,discountMinor:discount,lineTotalMinor:lineTotal,costMinor:unitCost,lineCostMinor:lineCost,versionId:version};
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
  const started=Date.now();const values=sheet.getRange(1,1,rowCount,columnCount).getValues();if(accountRequest_){accountRequest_.reads++;accountRequest_.readMs+=Date.now()-started;}
  const headers=values[0],idIndex=headers.indexOf('id');
  if(idIndex<0 || (ACCOUNT_HEADERS[name] && ACCOUNT_HEADERS[name].some(key=>!headers.includes(key)&&!ACCOUNT_OPTIONAL_HEADERS[name]?.includes(key)))) throw new Error('Run setup() to update the '+name+' headers.');
  return values.slice(1).filter(row=>row[idIndex]).map(row=>Object.fromEntries(headers.map((key,index)=>[key,row[index]])));
}
function accountInvoiceRecord_(invoice,allItems){
  const lines=allItems.filter(item=>(item.versionId||'')===(invoice.itemVersion||'')).sort((a,b)=>Number(a.id.split('-').pop())-Number(b.id.split('-').pop()));
  if(lines.length!==Number(invoice.itemCount))throw new Error('Invoice '+invoice.invoiceNumber+' has missing or duplicate items.');
  const normalized=normalizedInvoice_({...invoice,schemaVersion:Number(invoice.schemaVersion),items:lines.map(item=>({...item,quantityMilli:Number(item.quantityMilli),rateMinor:Number(item.rateMinor),discountMinor:Number(item.discountMinor),costMinor:item.costMinor===''?null:Number(item.costMinor)}))});
  if(!accountSame_(invoice,normalized,['totalMinor','costTotalMinor'])||!['issued','cancelled','deleted'].includes(invoice.status))throw new Error('Invalid invoice totals or status. Repair '+invoice.invoiceNumber+'.');
  const revision=Number(invoice.revision||0);
  if(!Number.isSafeInteger(revision)||revision<0)throw new Error('Invalid invoice revision.');
  return {...invoice,...normalized,revision};
}
function accountAction_(action,t) {
  const ss=spreadsheet_();
  if (action==='listAccounts') {
    const parties=accountReadRows_(ss,'Parties'), headers=accountReadRows_(ss,'Invoices'), items=accountReadRows_(ss,'InvoiceItems');
    const itemsByInvoice=new Map(),partiesById=new Map(parties.map(p=>[p.id,p]));
    items.forEach(item=>{if(!itemsByInvoice.has(item.invoiceId))itemsByInvoice.set(item.invoiceId,[]);itemsByInvoice.get(item.invoiceId).push(item);});
    const invoices=headers.map(invoice=>accountInvoiceRecord_(invoice,itemsByInvoice.get(invoice.id)||[]));
    if (new Set(parties.map(p=>p.id)).size!==parties.length || new Set(headers.map(i=>i.id)).size!==headers.length) throw new Error('Duplicate party or invoice IDs. Repair the Sheet before continuing.');
    parties.forEach(p=>{accountId_(p.id);accountAmount_(Number(p.openingBalanceMinor),true);if(!validDate_(p.openingDate))throw new Error('Invalid party opening date.');});
    const transactions=accountReadRows_(ss,'Transactions').filter(row=>!row.deletedAt);
    [...invoices,...transactions.filter(row=>row.partyId)].forEach(row=>{const party=partiesById.get(row.partyId);if(!party || (row.invoiceDate||row.transactionDate)<party.openingDate)throw new Error('A record has a missing party or predates its opening balance. Repair the Sheet before using balances.');});
    const invoicesById=new Map(invoices.map(invoice=>[invoice.id,invoice]));
    const notes=accountReadRows_(ss,'InvoiceNotes').map(note=>accountNoteRecord_(note,invoicesById));
    if(new Set(notes.map(note=>note.id)).size!==notes.length)throw new Error('Duplicate invoice note IDs. Repair the Sheet before continuing.');
    if(new Set(notes.map(note=>note.noteNumber)).size!==notes.length)throw new Error('Duplicate correction note numbers.');
    const noteTotals=new Map();
    notes.filter(note=>note.status==='issued').forEach(note=>{const value=noteTotals.get(note.invoiceId)||{amount:0,cost:0,known:true};const sign=note.type==='credit'?-1:1;value.amount+=sign*note.amountMinor;if(note.costAdjustmentMinor===null)value.known=false;else value.cost+=sign*note.costAdjustmentMinor;noteTotals.set(note.invoiceId,value);});
    invoices.forEach(invoice=>{const adjustment=noteTotals.get(invoice.id);if(!adjustment)return;const net=Number(invoice.totalMinor)+adjustment.amount;if(!Number.isSafeInteger(net)||net<0||net>100000000000)throw new Error('Invalid correction totals. Repair the Sheet before using balances.');if(invoice.costTotalMinor!==null&&invoice.costTotalMinor!==''&&adjustment.known){const cost=Number(invoice.costTotalMinor)+adjustment.cost;if(!Number.isSafeInteger(cost)||cost<0||cost>100000000000)throw new Error('Invalid cost correction totals.');}});
    return {ok:true,parties,invoices:t?.summary?invoices.map(invoice=>{const {items,...summary}=invoice;return {...summary,_summary:true,itemSearch:items.map(item=>item.description).join(' ')};}):invoices,transactions,notes};
  }
  if(action==='getInvoices'){
    if(!t||!Array.isArray(t.ids)||!t.ids.length||t.ids.length>500)throw new Error('Choose between 1 and 500 invoices.');
    t.ids.forEach(accountId_);const wanted=new Set(t.ids),headers=accountReadRows_(ss,'Invoices'),allItems=accountReadRows_(ss,'InvoiceItems');
    const byInvoice=new Map();allItems.forEach(item=>{if(wanted.has(item.invoiceId)){if(!byInvoice.has(item.invoiceId))byInvoice.set(item.invoiceId,[]);byInvoice.get(item.invoiceId).push(item);}});
    const invoices=headers.filter(invoice=>wanted.has(invoice.id)&&invoice.status!=='deleted').map(invoice=>accountInvoiceRecord_(invoice,byInvoice.get(invoice.id)||[]));
    if(invoices.length!==wanted.size)throw new Error('An invoice no longer exists in the active ledger. Refresh and try again.');return {ok:true,invoices};
  }
  if (!t || typeof t!=='object') throw new Error('Missing record.');
  accountId_(t.id);
  let record=null;
  if (action==='createParty' || action==='updateParty') {
    const name=accountText_(t.name,150,true),phone=accountText_(t.phone,50),address=accountText_(t.address,500);
    const existing=accountRows_(ss,'Parties').find(row=>row.id===t.id);
    if (action==='updateParty') {
      if (!existing || existing.archivedAt) throw new Error('Party not found or deleted.');
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
    if(t.itemVersion)throw new Error('New invoices must not specify an edit version.');
    const normalized=normalizedInvoice_(t,true),{items,...invoice}=normalized;
    const parties=accountRows_(ss,'Parties'),party=parties.find(p=>p.id===t.partyId);
    if (!party || party.archivedAt) throw new Error('Party not found or archived.');
    if (t.invoiceDate<party.openingDate) throw new Error('Invoice date cannot predate the party opening balance date.');
    const invoices=accountRows_(ss,'Invoices'),existing=invoices.find(row=>row.id===t.id);
    const allItems=accountRows_(ss,'InvoiceItems').filter(row=>row.invoiceId===t.id);
    const oldItems=allItems.filter(row=>!(row.versionId||''));
    if (oldItems.some(old=>!items.some(item=>item.id===old.id&&accountSame_(old,item,ACCOUNT_HEADERS.InvoiceItems)))) throw new Error('This invoice ID was already used for different items. Retry the original request.');
    if (existing) {
      const original=existing.itemVersion?JSON.parse(accountRows_(ss,'InvoiceHistory').find(row=>row.invoiceId===t.id&&Number(row.revision)===0)?.snapshot||'null'):existing;
      if (!original || !accountSame_(original,invoice,Object.keys(invoice).filter(key=>key!=='invoiceNumber'||invoice.invoiceNumber)) || oldItems.length!==items.length) throw new Error('This ID already belongs to a different invoice.');
      return {ok:true,id:t.id,record:accountInvoiceRecord_(existing,allItems)};
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
    const oldItemIds=new Set(oldItems.map(item=>item.id));accountAppendRows_(ss,'InvoiceItems',items.filter(item=>!oldItemIds.has(item.id)));
    SpreadsheetApp.flush();
    record={...invoice,items,partyName:party.name,partyPhone:party.phone,partyAddress:party.address,status:'issued',createdAt:new Date().toISOString(),cancelledAt:'',cancelReason:'',deletedAt:'',deleteReason:'',revision:0,lastEditId:'',updatedAt:''};
    accountWrite_(ss,'Invoices',record);
  } else if(action==='updateInvoice'){
    accountId_(t._editId);
    const existing=accountRows_(ss,'Invoices').find(row=>row.id===t.id);
    if(!existing)throw new Error('Invoice not found.');
    if(t.type!==existing.type||t.partyId!==existing.partyId||t.invoiceNumber!==existing.invoiceNumber)throw new Error('Invoice number, type and party cannot be changed.');
    const party=accountRows_(ss,'Parties').find(row=>row.id===t.partyId);
    if(!party||t.invoiceDate<party.openingDate)throw new Error('Invoice date cannot predate the party opening balance date.');
    const normalized=normalizedInvoice_({...t,itemVersion:t._editId,items:t.items.map((item,index)=>({...item,id:t.id+'-'+t._editId+'-'+(index+1),invoiceId:t.id}))});
    const allItems=accountRows_(ss,'InvoiceItems').filter(row=>row.invoiceId===t.id);
    const staged=allItems.filter(row=>row.versionId===t._editId);
    if(staged.some(old=>!normalized.items.some(item=>item.id===old.id&&accountSame_(old,item,ACCOUNT_HEADERS.InvoiceItems))))throw new Error('This edit ID was already used for different items. Retry the original edit.');
    if(existing.lastEditId===t._editId){
      if(!accountSame_(existing,normalized,Object.keys(normalized).filter(key=>key!=='items'))||staged.length!==normalized.items.length)throw new Error('Edit ID already used for a different invoice edit.');
      return {ok:true,id:t.id,record:accountInvoiceRecord_(existing,allItems)};
    }
    const history=accountRows_(ss,'InvoiceHistory');
    const committed=history.filter(row=>row.invoiceId===t.id).map(row=>JSON.parse(row.snapshot)).find(previous=>previous.id===t.id&&previous.lastEditId===t._editId);
    if(committed){
      if(!accountSame_(committed,normalized,Object.keys(normalized).filter(key=>key!=='items'))||staged.length!==normalized.items.length)throw new Error('Edit ID already used for a different invoice edit.');
      return {ok:true,id:t.id,record:accountInvoiceRecord_(existing,allItems)};
    }
    if(existing.status!=='issued')throw new Error('Cancelled invoices cannot be edited.');
    if(!Number.isSafeInteger(t._expectedRevision)||Number(existing.revision||0)!==t._expectedRevision){const error=new Error('Invoice changed on another device. Reload it before editing.');error.code='EDIT_CONFLICT';throw error;}
    if(accountRows_(ss,'InvoiceNotes').some(note=>note.invoiceId===t.id))throw new Error('This invoice has correction notes. Add a credit or debit note instead of editing the original.');
    const previous=accountInvoiceRecord_(existing,allItems),changedAt=new Date().toISOString();
    // Stage immutable lines and the previous snapshot. Only the final header
    // switch commits this version; failed writes leave the prior invoice intact.
    const historyId=t.id+'-'+t._editId;
    if(!history.some(row=>row.id===historyId))accountWrite_(ss,'InvoiceHistory',{id:historyId,invoiceId:t.id,revision:previous.revision,changedAt,editId:t._editId,snapshot:JSON.stringify(previous)});
    const stagedIds=new Set(staged.map(item=>item.id));accountAppendRows_(ss,'InvoiceItems',normalized.items.filter(item=>!stagedIds.has(item.id)));
    SpreadsheetApp.flush();
    record={...existing,...normalized,revision:previous.revision+1,lastEditId:t._editId,updatedAt:changedAt};
    accountWrite_(ss,'Invoices',record,true);
  } else if (action==='createInvoiceNote') {
    const normalized=normalizedInvoiceNote_(t);
    const notes=accountRows_(ss,'InvoiceNotes'),existing=notes.find(note=>note.id===t.id);
    if(existing){
      const original=accountRows_(ss,'InvoiceNoteHistory').filter(row=>row.noteId===t.id&&Number(row.revision)===0).map(row=>JSON.parse(row.snapshot))[0]||existing;
      if(!accountSame_(original,normalized,Object.keys(normalized)))throw new Error('This note ID belongs to different changes. Retry the original request.');
      return {ok:true,id:t.id,record:accountNoteRecord_(existing,accountRows_(ss,'Invoices'))};
    }
    const invoice=accountRows_(ss,'Invoices').find(row=>row.id===t.invoiceId);
    if(!invoice||invoice.status!=='issued')throw new Error('Choose an issued invoice before creating a correction note.');
    if(!Number.isSafeInteger(t._expectedRevision)||t._expectedRevision!==Number(invoice.revision||0)){const error=new Error('Invoice changed on another device. Refresh before creating a correction note.');error.code='EDIT_CONFLICT';throw error;}
    if(t.noteDate<invoice.invoiceDate)throw new Error('A correction note cannot predate its invoice.');
    if(invoice.type==='purchase'&&normalized.costAdjustmentMinor!==0)throw new Error('Purchase notes do not change sales costs.');
    const related=notes.filter(note=>note.invoiceId===invoice.id&&note.status==='issued');
    const sign=normalized.type==='credit'?-1:1;
    const net=Number(invoice.totalMinor)+related.reduce((sum,n)=>sum+(n.type==='credit'?-1:1)*Number(n.amountMinor),0)+sign*normalized.amountMinor;
    if(net<0||net>100000000000)throw new Error('The correction exceeds the invoice value remaining after earlier notes.');
    const costKnown=invoice.costTotalMinor!==''&&invoice.costTotalMinor!=null&&related.every(n=>n.costAdjustmentMinor!==''&&n.costAdjustmentMinor!=null)&&normalized.costAdjustmentMinor!==null;
    if(costKnown){const cost=Number(invoice.costTotalMinor)+related.reduce((sum,n)=>sum+(n.type==='credit'?-1:1)*Number(n.costAdjustmentMinor),0)+sign*normalized.costAdjustmentMinor;if(cost<0||cost>100000000000)throw new Error('The cost correction exceeds the recorded invoice cost.');}
    const prefix=normalized.type==='credit'?'RF-CN-':'RF-DN-';let last=0;
    notes.forEach(note=>{const match=new RegExp('^'+prefix+'(\\d+)$').exec(String(note.noteNumber||''));if(match)last=Math.max(last,Number(match[1]));});
    if(!Number.isSafeInteger(last)||last>=999999999999)throw new Error('Note number limit reached.');
    record={...normalized,noteNumber:prefix+String(last+1).padStart(6,'0'),invoiceNumber:invoice.invoiceNumber,invoiceRevision:Number(invoice.revision||0),partyId:invoice.partyId,partyName:invoice.partyName,partyPhone:invoice.partyPhone,partyAddress:invoice.partyAddress,invoiceType:invoice.type,status:'issued',createdAt:new Date().toISOString(),cancelledAt:'',cancelReason:'',revision:0,lastEditId:'',updatedAt:'',deletedAt:'',deleteReason:''};
    accountWrite_(ss,'InvoiceNotes',record);
  } else if(action==='updateInvoiceNote') {
    accountId_(t._editId);
    const normalized=normalizedInvoiceNote_(t),notes=accountRows_(ss,'InvoiceNotes'),existing=notes.find(note=>note.id===t.id);
    if(!existing)throw new Error('Correction note not found.');
    if(existing.invoiceId!==t.invoiceId||existing.type!==t.type)throw new Error('The original invoice and note type cannot be changed.');
    const invoices=accountRows_(ss,'Invoices'),invoice=invoices.find(row=>row.id===existing.invoiceId);
    const history=accountRows_(ss,'InvoiceNoteHistory');
    const committed=existing.lastEditId===t._editId?existing:history.filter(row=>row.noteId===t.id).map(row=>JSON.parse(row.snapshot)).find(previous=>previous.lastEditId===t._editId);
    if(committed){
      if(!accountSame_(committed,normalized,Object.keys(normalized)))throw new Error('This edit ID was used for different note changes.');
      return {ok:true,id:t.id,record:accountNoteRecord_(existing,invoices)};
    }
    if(existing.status!=='issued'||!invoice||invoice.status!=='issued')throw new Error('Only active notes on an issued invoice can be edited.');
    if(!Number.isSafeInteger(t._expectedRevision)||t._expectedRevision!==Number(existing.revision||0)){const error=new Error('Correction note changed on another device. Reload it before editing.');error.code='EDIT_CONFLICT';throw error;}
    if(t.noteDate<invoice.invoiceDate||invoice.type==='purchase'&&normalized.costAdjustmentMinor!==0)throw new Error('Invalid note date or purchase cost correction.');
    const changedAt=new Date().toISOString();
    record={...existing,...normalized,revision:Number(existing.revision||0)+1,lastEditId:t._editId,updatedAt:changedAt};
    validateNoteTotals_(invoice,[...notes.filter(note=>note.invoiceId===invoice.id&&note.id!==t.id),record]);
    const historyId=t.id+'-'+t._editId;
    if(!history.some(row=>row.id===historyId))accountWrite_(ss,'InvoiceNoteHistory',{id:historyId,noteId:t.id,revision:Number(existing.revision||0),changedAt,editId:t._editId,snapshot:JSON.stringify(existing)});
    SpreadsheetApp.flush();
    accountWrite_(ss,'InvoiceNotes',record,true);
  } else if(action==='deleteInvoiceNote') {
    const notes=accountRows_(ss,'InvoiceNotes'),existing=notes.find(note=>note.id===t.id);
    if(!existing)throw new Error('Correction note not found.');
    const invoices=accountRows_(ss,'Invoices'),invoice=invoices.find(row=>row.id===existing.invoiceId);
    if(existing.status==='deleted'||invoice?.status==='deleted')return {ok:true,id:t.id,record:accountNoteRecord_(existing,invoices)};
    if(!Number.isSafeInteger(t._expectedRevision)||t._expectedRevision!==Number(existing.revision||0)){const error=new Error('Correction note changed. Reload before deleting.');error.code='EDIT_CONFLICT';throw error;}
    if(!invoice||invoice.status!=='issued')throw new Error('Original invoice is no longer active.');
    validateNoteTotals_(invoice,notes.filter(note=>note.invoiceId===invoice.id&&note.id!==t.id));
    record={...existing,status:'deleted',deletedAt:new Date().toISOString(),deleteReason:accountText_(t.reason,500,true),revision:Number(existing.revision||0)+1};
    accountWrite_(ss,'InvoiceNotes',record,true);
  } else if(action==='cancelInvoiceNote') {
    const notes=accountRows_(ss,'InvoiceNotes'),existing=notes.find(note=>note.id===t.id);
    if(!existing)throw new Error('Correction note not found.');
    if(existing.status==='cancelled')return {ok:true,id:t.id,record:accountNoteRecord_(existing,accountRows_(ss,'Invoices'))};
    if(existing.status!=='issued')throw new Error('Only active notes can be cancelled.');
    if(!Number.isSafeInteger(t._expectedRevision)||t._expectedRevision!==Number(existing.revision||0))throw new Error('Correction note changed. Refresh before cancelling.');
    const invoice=accountRows_(ss,'Invoices').find(row=>row.id===existing.invoiceId);
    if(!invoice||invoice.status==='deleted')throw new Error('This note belongs to a deleted invoice.');
    const active=notes.filter(note=>note.invoiceId===existing.invoiceId&&note.id!==t.id&&note.status==='issued');
    const net=Number(invoice.totalMinor)+active.reduce((sum,n)=>sum+(n.type==='credit'?-1:1)*Number(n.amountMinor),0);
    if(net<0||net>100000000000)throw new Error('Cancel dependent correction notes first. The remaining invoice value must not be negative.');
    if(invoice.costTotalMinor!==''&&invoice.costTotalMinor!=null&&active.every(n=>n.costAdjustmentMinor!==''&&n.costAdjustmentMinor!=null)){
      const cost=Number(invoice.costTotalMinor)+active.reduce((sum,n)=>sum+(n.type==='credit'?-1:1)*Number(n.costAdjustmentMinor),0);
      if(cost<0||cost>100000000000)throw new Error('Cancel dependent cost correction notes first.');
    }
    record={...existing,status:'cancelled',cancelledAt:new Date().toISOString(),cancelReason:accountText_(t.reason,500,true),revision:Number(existing.revision||0)+1};
    accountWrite_(ss,'InvoiceNotes',record,true);
  } else if(action==='deleteInvoice') {
    const invoice=accountRows_(ss,'Invoices').find(row=>row.id===t.id);
    if(!invoice)throw new Error('Invoice not found.');
    if(invoice.status==='deleted')return {ok:true,id:t.id,record:accountInvoiceRecord_(invoice,accountRows_(ss,'InvoiceItems').filter(item=>item.invoiceId===t.id))};
    if(!Number.isSafeInteger(t._expectedRevision)||t._expectedRevision!==Number(invoice.revision||0)){const error=new Error('Invoice changed. Refresh before deleting.');error.code='EDIT_CONFLICT';throw error;}
    const notes=accountRows_(ss,'InvoiceNotes').filter(note=>note.invoiceId===invoice.id);
    if(t._expectedNotes!==noteRevisionToken_(notes)){const error=new Error('The invoice correction notes changed. Refresh before deleting.');error.code='EDIT_CONFLICT';throw error;}
    record={...invoice,status:'deleted',deletedAt:new Date().toISOString(),deleteReason:accountText_(t.reason,500,true),revision:Number(invoice.revision||0)+1};
    accountWrite_(ss,'Invoices',record,true);
    record=accountInvoiceRecord_(record,accountRows_(ss,'InvoiceItems').filter(item=>item.invoiceId===t.id));
  } else if(action==='deleteParty') {
    const party=accountRows_(ss,'Parties').find(row=>row.id===t.id);
    if(!party)throw new Error('Party not found.');
    if(party.archivedAt)return {ok:true,id:t.id,record:party};
    if(!Number.isSafeInteger(t._expectedRevision)||t._expectedRevision!==Number(party.revision||0))throw new Error('Party changed. Refresh before deleting.');
    const invoices=accountRows_(ss,'Invoices'),payments=accountReadRows_(ss,'Transactions');
    if(Number(party.openingBalanceMinor)!==0)throw new Error('This party has an opening balance and cannot be deleted.');
    if(invoices.some(invoice=>invoice.partyId===party.id&&invoice.status==='issued')||payments.some(payment=>payment.partyId===party.id&&!payment.deletedAt))throw new Error('This party has active invoices or payments. Delete those records first.');
    record={...party,archivedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),revision:Number(party.revision||0)+1};
    accountWrite_(ss,'Parties',record,true);
  } else if (action==='cancelInvoice') {
    const invoice=accountRows_(ss,'Invoices').find(row=>row.id===t.id);
    if(invoice?.status==='deleted')throw new Error('Deleted invoices cannot be cancelled.');
    if (!invoice) throw new Error('Invoice not found.');
    if(invoice.status!=='cancelled'&&accountRows_(ss,'InvoiceNotes').some(note=>note.invoiceId===t.id))throw new Error('This invoice has correction notes. Use a credit note to reverse its remaining value.');
    const reason=accountText_(t.reason,500,true);
    record=invoice.status==='cancelled'?invoice:{...invoice,status:'cancelled',cancelledAt:new Date().toISOString(),cancelReason:reason,revision:Number(invoice.revision||0)+1};
    if (invoice.status!=='cancelled') accountWrite_(ss,'Invoices',record,true);
  }
  SpreadsheetApp.flush();
  return {ok:true,id:t.id,record};
}

function normalizedInvoiceNote_(t){const started=Date.now();try{return normalizedInvoiceNote_data_(t);}finally{if(accountRequest_)accountRequest_.validationMs+=Date.now()-started;}}
function normalizedInvoiceNote_data_(t) {
  accountId_(t.id);accountId_(t.invoiceId);
  if(t.schemaVersion!==1||t.currency!=='INR'||!['credit','debit'].includes(t.type)||!['price','return'].includes(t.effect)||!validDate_(t.noteDate))throw new Error('Invalid correction note.');
  const amount=accountAmount_(t.amountMinor);
  if(amount<=0)throw new Error('Correction note amount must be positive.');
  const cost=t.costAdjustmentMinor===''||t.costAdjustmentMinor==null?null:accountAmount_(t.costAdjustmentMinor);
  if(t.effect==='price'&&cost!==0)throw new Error('Price corrections must leave costs unchanged.');
  return {id:t.id,schemaVersion:1,invoiceId:t.invoiceId,type:t.type,noteDate:t.noteDate,reason:accountText_(t.reason,1000,true),effect:t.effect,amountMinor:amount,costAdjustmentMinor:cost,currency:'INR'};
}
function accountNoteRecord_(note,invoices){
  const normalized=normalizedInvoiceNote_({...note,schemaVersion:Number(note.schemaVersion),amountMinor:Number(note.amountMinor),costAdjustmentMinor:note.costAdjustmentMinor===''||note.costAdjustmentMinor==null?null:Number(note.costAdjustmentMinor)});
  const invoice=invoices instanceof Map?invoices.get(note.invoiceId):invoices.find(row=>row.id===note.invoiceId);
  if(!invoice||!['issued','deleted'].includes(invoice.status)||invoice.partyId!==note.partyId||invoice.type!==note.invoiceType||invoice.invoiceNumber!==note.invoiceNumber||invoice.status!=='deleted'&&Number(invoice.revision||0)!==Number(note.invoiceRevision)||note.noteDate<invoice.invoiceDate||!['issued','cancelled','deleted'].includes(note.status)||note.invoiceType==='purchase'&&normalized.costAdjustmentMinor!==0)throw new Error('Invalid correction note link or status. Repair the Sheet before using balances.');
  if(!/^RF-(CN|DN)-\d+$/.test(String(note.noteNumber||''))||!String(note.noteNumber).startsWith(note.type==='credit'?'RF-CN-':'RF-DN-')||!Number.isSafeInteger(Number(note.revision||0))||Number(note.revision||0)<0)throw new Error('Invalid correction note number or revision.');
  return {...note,...normalized,status:invoice.status==='deleted'?'deleted':note.status,revision:Number(note.revision||0)};
}

function noteRevisionToken_(notes){return notes.filter(note=>note.status!=='deleted').map(note=>note.id+':'+Number(note.revision||0)).sort().join('|');}

function validateNoteTotals_(invoice,notes){
  const active=notes.filter(note=>note.status==='issued');
  const net=Number(invoice.totalMinor)+active.reduce((sum,note)=>sum+(note.type==='credit'?-1:1)*Number(note.amountMinor),0);
  if(!Number.isSafeInteger(net)||net<0||net>100000000000)throw new Error('This change would make the remaining invoice value negative or too large. Adjust dependent notes first.');
  if(invoice.costTotalMinor!==''&&invoice.costTotalMinor!=null&&active.every(note=>note.costAdjustmentMinor!==''&&note.costAdjustmentMinor!=null)){
    const cost=Number(invoice.costTotalMinor)+active.reduce((sum,note)=>sum+(note.type==='credit'?-1:1)*Number(note.costAdjustmentMinor),0);
    if(!Number.isSafeInteger(cost)||cost<0||cost>100000000000)throw new Error('This change would make the recorded cost negative or too large. Adjust dependent cost notes first.');
  }
}
