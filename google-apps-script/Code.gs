// Bind this script to your Google Sheet, run setup(), then deploy as a web app.
const BACKEND_VERSION = '1.23.1';
const HEADERS = ['id','schemaVersion','transactionDate','transactionTime','timezone','direction','category','method','amountMinor','currency','party','notes','chequeDate','createdAt','metadata','deletedAt','updatedAt','revision','lastEditId','restoredAt','lastRestoreDeletedAt','recordType','cashReceivedMinor','cashChangeMinor','onlineChangeMinor','fromMethod','toMethod','expectedCashMinor','countedCashMinor','cashAdjustmentMinor','expectedOnlineMinor','countedOnlineMinor','onlineAdjustmentMinor','partyId','deleteReason','settlementDiscountMinor','invoiceId','cashPortionMinor','onlinePortionMinor'];

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty('SPREADSHEET_ID', ss.getId());
  if (!properties.getProperty('LEDGER_ACCESS_TOKEN')) properties.setProperty('LEDGER_ACCESS_TOKEN', Utilities.getUuid().replace(/-/g,'') + Utilities.getUuid().replace(/-/g,''));
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
  const existing=ss.getSheetByName('Transactions');
  const sheet=existing||ss.insertSheet('Transactions'),lastColumn=sheet.getLastColumn();
  let headers=lastColumn?sheet.getRange(1,1,1,lastColumn).getValues()[0]:[];
  const missing=HEADERS.filter(name=>headers.indexOf(name)<0);
  if(missing.length){sheet.getRange(1,headers.length+1,1,missing.length).setValues([missing]);headers=headers.concat(missing);}
  if(!existing||missing.length){sheet.setFrozenRows(1);sheet.getRange(1,1,1,headers.length).setBackground('#214c3f').setFontColor('#ffffff').setFontWeight('bold');}
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
  return json_({ok:false,code:'UNAUTHORIZED',error:'Ledger requests require an access token. Open app Settings to connect.'});
}
function requireAccess_(body) {
  const expected=PropertiesService.getScriptProperties().getProperty('LEDGER_ACCESS_TOKEN');
  if(!expected||expected.length<32||typeof body?.accessToken!=='string'||body.accessToken!==expected){
    const error=new Error('Enter the correct ledger access token in Settings. Your pending uploads remain on this device.');
    error.code='UNAUTHORIZED';throw error;
  }
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
  if(hasSettlement_(t)&&(!Number.isSafeInteger(t.settlementDiscountMinor)||t.settlementDiscountMinor<0||t.settlementDiscountMinor>100000000000||!t.partyId||t.direction!=='in'||t.category!=='Sale'||t.recordType&&t.recordType!=='payment'))throw new Error('Invalid full & final settlement discount.');
  if (t.recordType === 'adjustment') {
    const fields=['expectedCashMinor','countedCashMinor','cashAdjustmentMinor','expectedOnlineMinor','countedOnlineMinor','onlineAdjustmentMinor'];
    const values=fields.map(key=>integerValue_(t[key]));
    if (!['adjustment','adjustment-cash','adjustment-online'].includes(t.direction) || t.category!=='Cashflow adjustment' || t.method!=='Adjustment' || values.some(value=>!Number.isSafeInteger(value) || Math.abs(value)>100000000000) || (t.direction!=='adjustment-online'&&values[1]<0) || (t.direction!=='adjustment-cash'&&values[4]<0) || values[2]!==values[1]-values[0] || values[5]!==values[4]-values[3] || t.amountMinor!==Math.abs(values[2])+Math.abs(values[5])) throw new Error('Invalid or unbalanced cashflow adjustment.');
    t.cashPortionMinor='';t.onlinePortionMinor='';t.chequeDate=''; t.cashReceivedMinor=''; t.cashChangeMinor=''; t.onlineChangeMinor=''; t.fromMethod=''; t.toMethod='';
    return;
  }
  if (t.recordType === 'transfer') {
    if (t.direction !== 'transfer' || t.category !== 'Transfer' || t.method !== 'Transfer' || !['Cash','Online'].includes(t.fromMethod) || !['Cash','Online'].includes(t.toMethod) || t.fromMethod === t.toMethod) throw new Error('Invalid cash/online transfer.');
    t.cashPortionMinor='';t.onlinePortionMinor='';t.chequeDate = ''; t.cashReceivedMinor = ''; t.cashChangeMinor = ''; t.onlineChangeMinor = '';
    return;
  }
  if (t.recordType && t.recordType !== 'payment') throw new Error('Invalid transaction type.');
  t.recordType = 'payment';
  if (!['in','out'].includes(t.direction) || !['Sale','Purchase','Bhara','Expense'].includes(t.category) || !['Cash','Online','Cheque','Split'].includes(t.method)) throw new Error('Invalid payment details.');
  if (t.method === 'Cheque' && !validDate_(t.chequeDate)) throw new Error('Cheque given date is required.');
  if(t.method==='Split'){const cash=integerValue_(t.cashPortionMinor),online=integerValue_(t.onlinePortionMinor);if(![cash,online].every(Number.isSafeInteger)||cash<=0||online<=0||cash+online!==t.amountMinor)throw new Error('Cash and Online portions must add up to the payment amount.');t.cashPortionMinor=cash;t.onlinePortionMinor=online;}else{t.cashPortionMinor='';t.onlinePortionMinor='';}
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
    const body = JSON.parse(e.postData.contents);requireAccess_(body);accountRequest_.action=body.action;
    if(body.action==='deletePayment'){if(!Number.isSafeInteger(body.transaction?._expectedRevision))throw new Error('Payment revision is required for bulk deletion.');body.action='delete';}
    if (body.action === 'list' || body.action === 'listDeleted') {
      const db = ensureSheet_(spreadsheet_());
      return json_({ok:true,transactions:visiblePayments_(spreadsheet_(),records_(db.sheet,db.headers)).filter(t => body.action==='listDeleted' ? Boolean(t.deletedAt) : !t.deletedAt)});
    }
    if(['listStock','importStock','createStockItem','recordStock','reviewInvoiceStock','reverseStock'].includes(body.action)){
      {const started=Date.now();lock.waitLock(25000);accountRequest_.lockWaitMs+=Date.now()-started;}
      try{return json_(stockAction_(body.action,body.transaction));}catch(error){if(!accountRequest_.writes&&!error.code)error.code='STOCK_REJECTED';throw error;}
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
    if(body.action==='update'&&hasSettlement_(existing)&&t.settlementDiscountMinor===undefined)throw new Error('Update the app before editing a full & final payment.');
    if(existing?.invoiceId&&body.action==='create')throw new Error('Retry this payment through its original invoice.');
    if(body.action==='create'&&t.invoiceId)throw new Error('Linked payments must be created with their invoice.');
    if(existing?.invoiceId&&body.action==='update'){
      const invoice=accountReadRows_(spreadsheet_(),'Invoices').find(row=>row.id===existing.invoiceId);
      if(!invoice||t.partyId!==(existing.partyId||'')||t.direction!==(invoice.type==='sale'?'in':'out')||t.category!==(invoice.type==='sale'?'Sale':'Purchase')||!['Cash','Online','Split'].includes(t.method)||t.recordType!=='payment')throw new Error('Keep this invoice payment linked to its original party and invoice type.');
    }
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
      const fields = ['cashPortionMinor','onlinePortionMinor','settlementDiscountMinor','recordType','transactionDate','transactionTime','direction','category','method','amountMinor','currency','party','partyId','notes','chequeDate','cashReceivedMinor','cashChangeMinor','onlineChangeMinor','fromMethod','toMethod',...(t.recordType==='adjustment'?['expectedCashMinor','countedCashMinor','cashAdjustmentMinor','expectedOnlineMinor','countedOnlineMinor','onlineAdjustmentMinor']:[])];
      if (t.method !== 'Cheque') t.chequeDate = '';
      if (existing.lastEditId === t._editId) {
        if (fields.some(key => String(comparable_(existing,key)) !== String(comparable_(t,key)))) reject('This edit ID was already used for different changes.');
        return json_({ok:true,id:t.id,updated:true,transaction:existing});
      }
      if (Number(existing.revision || 0) !== t._expectedRevision) reject('This payment changed on another device. Reload it before editing again.');
      if(hasSettlement_(t))validatePartySettlement_(t,existing.id);
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
      if(hasSettlement_(existing)!==hasSettlement_(t))throw new Error('This ID already belongs to a different settlement. Retry the original payment.');
      if (existing.deletedAt) throw new Error('This transaction has been deleted. It cannot be recreated with the same ID.');
      const fields = ['cashPortionMinor','onlinePortionMinor','settlementDiscountMinor','recordType','amountMinor','transactionDate','transactionTime','direction','category','method','party','partyId','notes','chequeDate','cashReceivedMinor','cashChangeMinor','onlineChangeMinor','fromMethod','toMethod','expectedCashMinor','countedCashMinor','cashAdjustmentMinor','expectedOnlineMinor','countedOnlineMinor','onlineAdjustmentMinor'];
      if (fields.some(key => String(comparable_(existing,key) || '') !== String(comparable_(t,key) || ''))) throw new Error('This ID already belongs to a different payment.');
      return json_({ok:true,id:t.id,duplicate:true});
    }
    if(hasSettlement_(t))validatePartySettlement_(t);
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
  const activeRows = visiblePayments_(ss,records_(sheet,headers)).filter(t => !t.deletedAt);
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
      if(t.method==='Split'){const cash=integerValue_(t.cashPortionMinor),online=integerValue_(t.onlinePortionMinor);if(![cash,online].every(Number.isSafeInteger)||cash<=0||online<=0||cash+online!==Number(t.amountMinor))throw new Error('Invalid split payment '+t.id);}
      if ((t.recordType && t.recordType !== 'payment') || !['in','out'].includes(t.direction) || !['Sale','Purchase','Bhara','Expense'].includes(t.category) || !['Cash','Online','Cheque','Split'].includes(t.method) || (t.method==='Cheque' && !validDate_(t.chequeDate))) throw new Error('Cannot refresh report: transaction '+t.id+' has invalid type, method, direction or cheque date. Correct that row and retry.');
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
  StockItems:['id','operationId','sourceId','name','code','category','baseUnit','secondaryUnit','conversion','saleRateMinor','purchaseRateMinor','saleRateUnit','purchaseRateUnit','lowStock','createdAt'],
  StockMovements:['id','operationId','stockItemId','movementDate','quantity','unit','conversion','baseQuantity','invoiceId','invoiceItemId','reason','createdAt'],
  StockReviews:['id','operationId','invoiceId','invoiceRevision','invoiceItemId','status','reason'],
  StockOperations:['id','kind','payloadHash','openingDate','invoiceId','invoiceRevision','reversesId','createdAt'],
  ItemCatalogue:['id','name','billingUnit','rateMinor','costMinor','saleRateMinor','purchaseRateMinor','updatedAt','sourceId'],
  Parties: ['id','schemaVersion','name','phone','address','openingDate','openingBalanceMinor','createdAt','updatedAt','revision','lastEditId','archivedAt','partyType'],
  Invoices: ['id','schemaVersion','partyId','partyName','partyPhone','partyAddress','type','invoiceNumber','invoiceDate','notes','currency','totalMinor','costTotalMinor','itemCount','status','createdAt','cancelledAt','cancelReason','revision','lastEditId','updatedAt','itemVersion','deletedAt','deleteReason','challanNumber','discountMode','discountValue','invoiceDiscountMinor','walkIn','paymentId','paymentSnapshot'],
  InvoiceItems: ['id','invoiceId','description','quantityMilli','rateMinor','discountMinor','lineTotalMinor','costMinor','lineCostMinor','versionId','billingUnit','measurementUnit','measurementMode','measurementCount','itemNote'],
  InvoiceMeasurements:['id','invoiceId','itemId','description','lengthMilli','widthMilli','quantityMilli','pieces'],
  InvoiceHistory: ['id','invoiceId','revision','changedAt','editId','snapshot'],
  InvoiceNotes: ['id','schemaVersion','invoiceId','invoiceNumber','invoiceRevision','partyId','partyName','partyPhone','partyAddress','invoiceType','type','noteNumber','noteDate','reason','effect','amountMinor','costAdjustmentMinor','currency','status','createdAt','cancelledAt','cancelReason','revision','lastEditId','updatedAt','deletedAt','deleteReason'],
  InvoiceNoteHistory: ['id','noteId','revision','changedAt','editId','snapshot']
};
const ACCOUNT_OPTIONAL_HEADERS={Parties:['partyType'],Invoices:['revision','lastEditId','updatedAt','itemVersion','deletedAt','deleteReason','challanNumber','discountMode','discountValue','invoiceDiscountMinor','walkIn','paymentId','paymentSnapshot'],InvoiceItems:['versionId','billingUnit','measurementUnit','measurementMode','measurementCount','itemNote'],InvoiceNotes:['lastEditId','updatedAt','deletedAt','deleteReason']};
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
  const appended=records.map((record,index)=>{const values=table.headers.map(key=>record[key]??'');const stored=Object.fromEntries(table.headers.map((key,column)=>[key,values[column]]));table.byId.set(record.id,{record:stored,rowIndex:startRow+index,values});return stored;});
  table.records=[...table.records,...appended];
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
function hasSettlement_(t){return t?.settlementDiscountMinor!==undefined&&t.settlementDiscountMinor!==null&&t.settlementDiscountMinor!=='';}
function validatePartySettlement_(t,excludeId){
  const snapshot=accountAction_('listAccounts',{summary:true});
  const party=snapshot.parties.find(p=>p.id===t.partyId&&!p.archivedAt);
  if(!party)throw new Error('Choose an active party before settling.');
  let balance=Number(party.openingBalanceMinor);
  snapshot.invoices.filter(row=>row.partyId===party.id&&row.status==='issued').forEach(row=>{balance+=Number(row.totalMinor)*(row.type==='sale'?1:-1);});
  snapshot.notes.filter(row=>row.partyId===party.id&&row.status==='issued').forEach(row=>{balance+=Number(row.amountMinor)*(row.type==='credit'?-1:1)*(row.invoiceType==='sale'?1:-1);});
  const seen=new Set();
  snapshot.transactions.filter(row=>row.partyId===party.id&&!row.deletedAt&&row.id!==excludeId).forEach(row=>{
    if(seen.has(row.id))throw new Error('A linked payment is duplicated. Repair it before settling.');seen.add(row.id);
    const payment={...row,schemaVersion:Number(row.schemaVersion),amountMinor:Number(row.amountMinor),...(hasSettlement_(row)?{settlementDiscountMinor:Number(row.settlementDiscountMinor)}:{})};validate_(payment);
    balance+=payment.amountMinor*(payment.direction==='in'?-1:1)-Number(payment.settlementDiscountMinor||0);
  });
  if(!Number.isSafeInteger(balance)||balance<=0||!Number.isSafeInteger(t._expectedPartyBalanceMinor)||balance!==t._expectedPartyBalanceMinor||t.amountMinor+t.settlementDiscountMinor!==balance){const error=new Error('The party balance changed or is not receivable. Refresh and review the settlement before saving.');error.code='EDIT_CONFLICT';throw error;}
}
function normalizedInvoice_(t, allowBlankNumber=false){const started=Date.now();try{return normalizedInvoice_data_(t,allowBlankNumber);}finally{if(accountRequest_)accountRequest_.validationMs+=Date.now()-started;}}
function normalizedInvoice_data_(t, allowBlankNumber=false) {
  accountId_(t.id); if(![undefined,null,'',false,true,'false','true'].includes(t.walkIn))throw new Error('Invalid walk-in invoice option.');const walkIn=t.walkIn===true||t.walkIn==='true';
  if(walkIn){if(t.type!=='sale'||t.partyId)throw new Error('Walk-in invoices must be sales without a saved party.');accountId_(t.paymentId);if(t.paymentId!==t.id+'-payment')throw new Error('Invalid walk-in payment link.');}else {accountId_(t.partyId);if(t.paymentId){accountId_(t.paymentId);if(t.paymentId!==t.id+'-payment')throw new Error('Invalid invoice payment link.');}}
  if (t.schemaVersion!==1 || t.currency!=='INR' || !['sale','purchase'].includes(t.type) || !validDate_(t.invoiceDate)) throw new Error('Invalid invoice details.');
  const version=t.itemVersion||'';
  if(version)accountId_(version);
  const invoice={id:t.id,schemaVersion:1,partyId:t.partyId,type:t.type,invoiceNumber:allowBlankNumber && !t.invoiceNumber?'':accountText_(t.invoiceNumber,80,true),invoiceDate:t.invoiceDate,challanNumber:accountText_(t.challanNumber??'',80),notes:accountText_(t.notes,1000),currency:'INR',itemVersion:version};
  if (!Array.isArray(t.items) || !t.items.length || t.items.length>50) throw new Error('An invoice needs 1–50 items.');
  let total=0,cost=0,complete=true;
  const items=t.items.map((item,index)=>{
    if (item.id!==t.id+'-'+(version?version+'-':'')+(index+1) || item.invoiceId!==t.id) throw new Error('Invalid invoice item ID.');
    const unit=item.billingUnit||'',measurements=item.measurements||[],itemNote=accountText_(item.itemNote??'',500);
    const quantityInfo=billingQuantity_({...item,billingUnit:unit,measurements});
    const quantity=quantityInfo.quantityMilli;
    if(item.quantityMilli!==quantity)throw new Error('Item quantity does not match its measurements.');
    if(unit&&item.measurementCount!==measurements.length)throw new Error('Measurement row count does not match the item.');
    const rate=accountAmount_(item.rateMinor),discount=accountAmount_(item.discountMinor);
    const lineTotal=accountAmount_(billingPrice_(rate,quantityInfo)-discount);
    const unitCost=t.type==='sale' && item.costMinor!==null && item.costMinor!=='' && item.costMinor!==undefined ? accountAmount_(item.costMinor) : null;
    const lineCost=unitCost===null?null:billingPrice_(unitCost,quantityInfo);
    total+=lineTotal;
    if (lineCost===null) complete=false; else cost+=lineCost;
    return {id:item.id,invoiceId:t.id,description:accountText_(item.description,300,true),...(itemNote?{itemNote}:{}),quantityMilli:quantity,rateMinor:rate,discountMinor:discount,lineTotalMinor:lineTotal,costMinor:unitCost,lineCostMinor:lineCost,versionId:version,...(unit?{billingUnit:unit,measurementUnit:['sqft','rft'].includes(unit)?item.measurementUnit:'',measurementMode:item.measurementMode||'quantity',measurementCount:measurements.length,measurements:measurements.map(row=>({description:row.description.trim(),lengthMilli:['sqft','rft'].includes(unit)?row.lengthMilli:0,widthMilli:unit==='sqft'||item.measurementMode==='perimeter'?row.widthMilli:0,quantityMilli:['sqft','rft'].includes(unit)?0:row.quantityMilli,pieces:row.pieces}))}: {})};
  });
  if(items.reduce((sum,item)=>sum+(item.measurements?.length||0),0)>1000)throw new Error('An invoice supports at most 1,000 measurement rows.');
  const discountMode=t.discountMode||'amount',discountValue=t.discountValue==null||t.discountValue===''?0:Number(t.discountValue);
  if(!['amount','percent'].includes(discountMode)||!Number.isSafeInteger(discountValue)||discountValue<0||discountValue>100000000000||discountMode==='percent'&&discountValue>10000)throw new Error('Invalid invoice discount.');
  const invoiceDiscountMinor=discountMode==='percent'?Number((BigInt(total)*BigInt(discountValue)+BigInt(5000))/BigInt(10000)):discountValue;
  accountAmount_(total);
  if(invoiceDiscountMinor>total)throw new Error('Invoice discount exceeds the subtotal.');
  total-=invoiceDiscountMinor;
  Object.assign(invoice,{discountMode,discountValue,invoiceDiscountMinor,walkIn,paymentId:t.paymentId||''});
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
function accountInvoiceRecord_(invoice,allItems,measurementIndex){
  const lines=allItems.filter(item=>(item.versionId||'')===(invoice.itemVersion||'')).sort((a,b)=>Number(a.id.split('-').pop())-Number(b.id.split('-').pop()));
  if(lines.length!==Number(invoice.itemCount))throw new Error('Invoice '+invoice.invoiceNumber+' has missing or duplicate items.');
  if(lines.some(item=>Number(item.measurementCount||0)>0)&&!measurementIndex)measurementIndex=accountMeasurementIndex_(spreadsheet_());
  const normalized=normalizedInvoice_({...invoice,schemaVersion:Number(invoice.schemaVersion),items:lines.map(item=>({...item,...(item.billingUnit?{measurementCount:Number(item.measurementCount||0),measurements:(measurementIndex?.get(item.id)||[]).map((row,index)=>{if(row.id!==item.id+'-m'+(index+1)||row.invoiceId!==invoice.id)throw new Error('Invalid measurement row identity.');return {description:row.description,lengthMilli:Number(row.lengthMilli),widthMilli:Number(row.widthMilli),quantityMilli:Number(row.quantityMilli),pieces:Number(row.pieces)};})}:{}),quantityMilli:Number(item.quantityMilli),rateMinor:Number(item.rateMinor),discountMinor:Number(item.discountMinor),costMinor:item.costMinor===''?null:Number(item.costMinor)}))});
  if(!accountSame_(invoice,normalized,['totalMinor','costTotalMinor'])||!['issued','cancelled','deleted'].includes(invoice.status))throw new Error('Invalid invoice totals or status. Repair '+invoice.invoiceNumber+'.');
  normalized.items.forEach((item,index)=>{if(!accountSame_(lines[index],item,['quantityMilli','lineTotalMinor','lineCostMinor']))throw new Error('Invalid invoice item totals. Repair '+invoice.invoiceNumber+'.');});
  const revision=Number(invoice.revision||0);
  if(!Number.isSafeInteger(revision)||revision<0)throw new Error('Invalid invoice revision.');
  return {...invoice,...normalized,revision,itemDiscountMinor:normalized.items.reduce((sum,item)=>sum+item.discountMinor,0)};
}

function invoiceHeaderDefaults_(invoice){return {...invoice,discountMode:invoice.discountMode||'amount',discountValue:Number(invoice.discountValue||0),invoiceDiscountMinor:Number(invoice.invoiceDiscountMinor||0),walkIn:invoice.walkIn===true||invoice.walkIn==='true',paymentId:invoice.paymentId||''};}
function visiblePayments_(ss,rows,invoices){
  if(!rows.some(row=>row.invoiceId))return rows;
  const committed=new Map((invoices||accountReadRows_(ss,'Invoices')).map(invoice=>[invoice.id,invoice]));
  return rows.filter(row=>!row.invoiceId||committed.get(row.invoiceId)?.paymentId===row.id);
}
const INVOICE_PAYMENT_FIELDS=['cashPortionMinor','onlinePortionMinor','id','invoiceId','schemaVersion','recordType','transactionDate','transactionTime','timezone','direction','category','method','amountMinor','currency','party','partyId','notes','chequeDate','cashReceivedMinor','cashChangeMinor','onlineChangeMinor','fromMethod','toMethod'];
function sameInvoicePayment_(a,b){return INVOICE_PAYMENT_FIELDS.every(key=>String(a[key]??'')===String(b[key]??''));}
function normalizedInvoicePayment_(payload,invoice){
  const payment=payload.payment;
  if(!payment||payment.id!==invoice.paymentId||payment.invoiceId!==invoice.id||payment.partyId!==invoice.partyId||payment.recordType!=='payment'||payment.direction!==(invoice.type==='sale'?'in':'out')||payment.category!==(invoice.type==='sale'?'Sale':'Purchase')||!['Cash','Online','Split'].includes(payment.method)||payment.transactionDate!==invoice.invoiceDate||!Number.isSafeInteger(payment.amountMinor)||payment.amountMinor<=0||payment.amountMinor>invoice.totalMinor||invoice.walkIn&&(payment.party!=='CASH SALE'||payment.amountMinor!==invoice.totalMinor)||hasSettlement_(payment))throw new Error('Invalid invoice payment. Walk-in sales require full payment; party advances must be positive and no greater than the invoice total.');
  validate_(payment);
  return Object.fromEntries(INVOICE_PAYMENT_FIELDS.map(key=>[key,payment[key]??'']));
}
function stageInvoicePayment_(ss,payment){
  const {sheet,headers}=ensureSheet_(ss),rows=records_(sheet,headers),matches=rows.filter(row=>row.id===payment.id);
  if(matches.length>1)throw new Error('Duplicate invoice payment IDs. Repair the Sheet before retrying.');
  if(matches.length){if(matches[0].deletedAt||!sameInvoicePayment_(matches[0],payment))throw new Error('This payment ID was already used. Retry the original invoice/payment.');return;}
  const record={...payment,createdAt:new Date().toISOString(),metadata:'{}',deletedAt:'',updatedAt:'',revision:0,lastEditId:'',restoredAt:'',lastRestoreDeletedAt:''};
  sheet.getRange(sheet.getLastRow()+1,1,1,headers.length).setNumberFormat('@').setValues([literalAccountRow_(headers,record)]);
  SpreadsheetApp.flush();
}


function catalogueKey_(name){return String(name).normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase();}
function mergeCatalogueInvoice_(map,invoice){
  if(invoice.status!=='issued')return;
  const stamp=invoice.updatedAt||invoice.createdAt||'',source=invoice.id+':'+Number(invoice.revision||0);
  for(const item of invoice.items||[]){
    const id=catalogueKey_(item.description),previous=map.get(id);
    if(previous&&String(previous.updatedAt||'')>stamp)continue;
    const cost=item.costMinor==null||item.costMinor===''?previous?.costMinor??'':Number(item.costMinor);
    const rate=Number(item.rateMinor),field=invoice.type==='sale'?'saleRateMinor':'purchaseRateMinor';
    map.set(id,{...previous,id,name:id,billingUnit:item.billingUnit||'nos',rateMinor:rate,costMinor:cost,[field]:rate,updatedAt:stamp,sourceId:source});
  }
}
function catalogueSnapshot_(ss,invoices=[]){const map=new Map(accountReadRows_(ss,'ItemCatalogue').map(row=>[row.id,row]));invoices.slice().sort((a,b)=>String(a.updatedAt||a.createdAt||'').localeCompare(String(b.updatedAt||b.createdAt||''))).forEach(invoice=>mergeCatalogueInvoice_(map,invoice));return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name));}
function catalogueWriteChanges_(ss,table,values){
  const additions=[],updates=[];
  for(const value of values){const previous=table.byId.get(value.id);if(!previous)additions.push(value);else if(!accountSame_(previous.record,value,Object.keys(value)))updates.push({value,rowIndex:previous.rowIndex,previous});}
  updates.sort((a,b)=>a.rowIndex-b.rowIndex);
  for(let start=0;start<updates.length;){let end=start+1;while(end<updates.length&&updates[end].rowIndex===updates[end-1].rowIndex+1)end++;
    const batch=updates.slice(start,end),rows=batch.map(row=>literalAccountRow_(table.headers,row.value,row.previous.values)),began=Date.now();
    table.sheet.getRange(batch[0].rowIndex,1,rows.length,table.headers.length).setNumberFormat('@').setValues(rows);
    for(const row of batch){const record={...row.previous.record,...row.value};table.byId.set(record.id,{record,rowIndex:row.rowIndex,values:table.headers.map(key=>record[key]??'')});table.records=table.records.map(old=>old.id===record.id?record:old);}
    if(accountRequest_){accountRequest_.writes++;accountRequest_.writeMs+=Date.now()-began;}start=end;
  }
  accountAppendRows_(ss,'ItemCatalogue',additions);
}
function invoiceResult_(ss,record,extra={}){
  let catalogue,catalogueWarning='';
  try{
    const table=accountTable_(ss,'ItemCatalogue'),map=new Map(table.records.map(row=>[row.id,row]));mergeCatalogueInvoice_(map,record);
    catalogueWriteChanges_(ss,table,[...map.values()]);
    catalogue=[...map.values()];
  }catch(error){catalogueWarning='Invoice saved; catalogue could not sync: '+error.message;}
  return {ok:true,id:record.id,record,...extra,...(catalogue?{catalogue}:{}),...(catalogueWarning?{catalogueWarning}:{})};
}

function accountAction_(action,t) {
  const ss=spreadsheet_();
  if (action==='listAccounts') {
    const parties=accountReadRows_(ss,'Parties'), headers=accountReadRows_(ss,'Invoices'), items=accountReadRows_(ss,'InvoiceItems');
    const itemsByInvoice=new Map(),partiesById=new Map(parties.map(p=>[p.id,p]));
    items.forEach(item=>{if(!itemsByInvoice.has(item.invoiceId))itemsByInvoice.set(item.invoiceId,[]);itemsByInvoice.get(item.invoiceId).push(item);});
    const measurementIndex=items.some(item=>Number(item.measurementCount||0)>0)?accountMeasurementIndex_(ss):new Map();
    const invoices=headers.map(invoice=>accountInvoiceRecord_(invoice,itemsByInvoice.get(invoice.id)||[],measurementIndex));
    if (new Set(parties.map(p=>p.id)).size!==parties.length || new Set(headers.map(i=>i.id)).size!==headers.length) throw new Error('Duplicate party or invoice IDs. Repair the Sheet before continuing.');
    parties.forEach(p=>{accountId_(p.id);accountAmount_(Number(p.openingBalanceMinor),true);if(!validDate_(p.openingDate))throw new Error('Invalid party opening date.');});
    const transactions=visiblePayments_(ss,accountReadRows_(ss,'Transactions'),invoices).filter(row=>!row.deletedAt);
    [...invoices.filter(row=>!row.walkIn),...transactions.filter(row=>row.partyId)].forEach(row=>{const party=partiesById.get(row.partyId);if(!party || (row.invoiceDate||row.transactionDate)<party.openingDate)throw new Error('A record has a missing party or predates its opening balance. Repair the Sheet before using balances.');});
    const invoicesById=new Map(invoices.map(invoice=>[invoice.id,invoice]));
    const notes=accountReadRows_(ss,'InvoiceNotes').map(note=>accountNoteRecord_(note,invoicesById));
    if(new Set(notes.map(note=>note.id)).size!==notes.length)throw new Error('Duplicate invoice note IDs. Repair the Sheet before continuing.');
    if(new Set(notes.map(note=>note.noteNumber)).size!==notes.length)throw new Error('Duplicate correction note numbers.');
    const noteTotals=new Map();
    notes.filter(note=>note.status==='issued').forEach(note=>{const value=noteTotals.get(note.invoiceId)||{amount:0,cost:0,known:true};const sign=note.type==='credit'?-1:1;value.amount+=sign*note.amountMinor;if(note.costAdjustmentMinor===null)value.known=false;else value.cost+=sign*note.costAdjustmentMinor;noteTotals.set(note.invoiceId,value);});
    invoices.forEach(invoice=>{const adjustment=noteTotals.get(invoice.id);if(!adjustment)return;const net=Number(invoice.totalMinor)+adjustment.amount;if(!Number.isSafeInteger(net)||net<0||net>100000000000)throw new Error('Invalid correction totals. Repair the Sheet before using balances.');if(invoice.costTotalMinor!==null&&invoice.costTotalMinor!==''&&adjustment.known){const cost=Number(invoice.costTotalMinor)+adjustment.cost;if(!Number.isSafeInteger(cost)||cost<0||cost>100000000000)throw new Error('Invalid cost correction totals.');}});
    return {ok:true,catalogue:catalogueSnapshot_(ss,invoices),parties,invoices:t?.summary?invoices.map(invoice=>{const {items,paymentSnapshot,...summary}=invoice;return {...summary,_summary:true,itemSearch:items.flatMap(item=>[item.description,item.itemNote,...(item.measurements||[]).map(row=>row.description)]).join(' ')};}):invoices,transactions,notes};
  }
  if(action==='getInvoices'){
    if(!t||!Array.isArray(t.ids)||!t.ids.length||t.ids.length>500)throw new Error('Choose between 1 and 500 invoices.');
    t.ids.forEach(accountId_);const wanted=new Set(t.ids),headers=accountReadRows_(ss,'Invoices'),allItems=accountReadRows_(ss,'InvoiceItems');
    const byInvoice=new Map();allItems.forEach(item=>{if(wanted.has(item.invoiceId)){if(!byInvoice.has(item.invoiceId))byInvoice.set(item.invoiceId,[]);byInvoice.get(item.invoiceId).push(item);}});
    const measurementIndex=allItems.some(item=>wanted.has(item.invoiceId)&&Number(item.measurementCount||0)>0)?accountMeasurementIndex_(ss):new Map();
    const invoices=headers.filter(invoice=>wanted.has(invoice.id)&&invoice.status!=='deleted').map(invoice=>accountInvoiceRecord_(invoice,byInvoice.get(invoice.id)||[],measurementIndex));
    if(invoices.length!==wanted.size)throw new Error('An invoice no longer exists in the active ledger. Refresh and try again.');return {ok:true,invoices};
  }
  if (!t || typeof t!=='object') throw new Error('Missing record.');
  accountId_(t.id);
  let record=null;
  if (action==='createParty' || action==='updateParty') {
    const name=accountText_(t.name,150,true),phone=accountText_(t.phone,50),address=accountText_(t.address,500);
    const existing=accountRows_(ss,'Parties').find(row=>row.id===t.id);
    const partyType=t.partyType===undefined?(existing?.partyType||''):t.partyType;
    if(!['','customer','supplier','lead','karigar','both'].includes(partyType))throw new Error('Invalid party type.');
    if (action==='updateParty') {
      if (!existing || existing.archivedAt) throw new Error('Party not found or deleted.');
      accountId_(t._editId);
      const fields=['name','phone','address',...(t.partyType===undefined?[]:['partyType'])];
      if (existing.lastEditId===t._editId) {
        if (!accountSame_(existing,t,fields)) throw new Error('Edit ID already used.');
        return {ok:true,id:t.id,record:existing};
      }
      if (!Number.isSafeInteger(t._expectedRevision) || Number(existing.revision||0)!==t._expectedRevision) throw new Error('Party changed on another device. Refresh before editing.');
      record={...existing,name,phone,address,partyType,updatedAt:new Date().toISOString(),revision:Number(existing.revision||0)+1,lastEditId:t._editId};
      accountWrite_(ss,'Parties',record,true);
    } else {
      if (t.schemaVersion!==1 || !validDate_(t.openingDate)) throw new Error('Invalid party opening date or schema.');
      accountAmount_(t.openingBalanceMinor,true);
      const party={id:t.id,schemaVersion:1,name,phone,address,partyType,openingDate:t.openingDate,openingBalanceMinor:t.openingBalanceMinor};
      if (existing) {
        if (!accountSame_({...existing,partyType:existing.partyType||''},party,Object.keys(party))) throw new Error('This ID already belongs to a different party.');
        record=existing;
      } else {record={...party,createdAt:new Date().toISOString(),updatedAt:'',revision:0,lastEditId:'',archivedAt:''};accountWrite_(ss,'Parties',record);}
    }
  } else if (action==='createInvoice') {
    if(t.itemVersion)throw new Error('New invoices must not specify an edit version.');
    const normalized=normalizedInvoice_(t,true),{items,...invoice}=normalized;
    const payment=invoice.paymentId?normalizedInvoicePayment_(t,invoice):null;
    if(t.payment&&!invoice.paymentId)throw new Error('Invoice payment link is required.');
    const parties=accountRows_(ss,'Parties'),party=parties.find(p=>p.id===t.partyId);
    if (!invoice.walkIn&&(!party || party.archivedAt)) throw new Error('Party not found or archived.');
    if (!invoice.walkIn&&t.invoiceDate<party.openingDate) throw new Error('Invoice date cannot predate the party opening balance date.');
    const invoices=accountRows_(ss,'Invoices'),existing=invoices.find(row=>row.id===t.id);
    const allItems=accountRows_(ss,'InvoiceItems').filter(row=>row.invoiceId===t.id);
    const oldItems=allItems.filter(row=>!(row.versionId||''));
    if (oldItems.some(old=>!items.some(item=>item.id===old.id&&accountSame_(old,item,ACCOUNT_HEADERS.InvoiceItems)))) throw new Error('This invoice ID was already used for different items. Retry the original request.');
    if (existing) {
      accountStageMeasurements_(ss,items,true);
      const original=existing.itemVersion?JSON.parse(accountRows_(ss,'InvoiceHistory').find(row=>row.invoiceId===t.id&&Number(row.revision)===0)?.snapshot||'null'):existing;
      if (!original || !accountSame_(invoiceHeaderDefaults_(original),invoice,Object.keys(invoice).filter(key=>key!=='invoiceNumber'||invoice.invoiceNumber)) || oldItems.length!==items.length) throw new Error('This ID already belongs to a different invoice.');
      if(payment){const originalPayment=JSON.parse(existing.paymentSnapshot||'null');if(!originalPayment||!sameInvoicePayment_(originalPayment,payment))throw new Error('Retry the original invoice payment details.');}
      return invoiceResult_(ss,accountInvoiceRecord_(existing,allItems),payment?{transaction:visiblePayments_(ss,accountReadRows_(ss,'Transactions')).find(row=>row.id===invoice.paymentId)}:{});
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
    accountStageMeasurements_(ss,items);
    SpreadsheetApp.flush();
    // The payment is staged first. Readers expose it only after this invoice header commits.
    if(payment)stageInvoicePayment_(ss,payment);
    record={...invoice,items,itemDiscountMinor:items.reduce((sum,item)=>sum+item.discountMinor,0),paymentSnapshot:payment?JSON.stringify(payment):'',partyName:invoice.walkIn?'CASH SALE':party.name,partyPhone:invoice.walkIn?'':party.phone,partyAddress:invoice.walkIn?'':party.address,status:'issued',createdAt:new Date().toISOString(),cancelledAt:'',cancelReason:'',deletedAt:'',deleteReason:'',revision:0,lastEditId:'',updatedAt:''};
    accountWrite_(ss,'Invoices',record);
    if(payment){SpreadsheetApp.flush();return invoiceResult_(ss,record,{transaction:accountReadRows_(ss,'Transactions').find(row=>row.id===invoice.paymentId)});}
  } else if(action==='updateInvoice'){
    accountId_(t._editId);
    const existing=accountRows_(ss,'Invoices').find(row=>row.id===t.id);
    if(!existing)throw new Error('Invoice not found.');
    if(t.type!==existing.type||t.partyId!==existing.partyId||t.invoiceNumber!==existing.invoiceNumber)throw new Error('Invoice number, type and party cannot be changed.');
    const party=accountRows_(ss,'Parties').find(row=>row.id===t.partyId);
    if(!invoiceHeaderDefaults_(existing).walkIn&&(!party||t.invoiceDate<party.openingDate))throw new Error('Invoice date cannot predate the party opening balance date.');
    const normalized=normalizedInvoice_({...t,itemVersion:t._editId,items:t.items.map((item,index)=>({...item,id:t.id+'-'+t._editId+'-'+(index+1),invoiceId:t.id}))});
    if(Boolean(normalized.walkIn)!==invoiceHeaderDefaults_(existing).walkIn||normalized.paymentId!==(existing.paymentId||''))throw new Error('Invoice customer mode and payment link cannot be changed.');
    if(normalized.walkIn&&(normalized.totalMinor!==Number(existing.totalMinor)||normalized.invoiceDate!==existing.invoiceDate))throw new Error('Walk-in invoice amount/date are linked to its payment. Delete and reissue both records to change them. CP and item details can be edited without changing the total.');
    if(t.invoiceDiscountSchemaVersion!==1&&Number(existing.invoiceDiscountMinor||0)>0)throw new Error('Update the app before editing an invoice-level discount.');
    const allItems=accountRows_(ss,'InvoiceItems').filter(row=>row.invoiceId===t.id);
    const staged=allItems.filter(row=>row.versionId===t._editId);
    if(staged.some(old=>!normalized.items.some(item=>item.id===old.id&&accountSame_(old,item,ACCOUNT_HEADERS.InvoiceItems))))throw new Error('This edit ID was already used for different items. Retry the original edit.');
    if(existing.lastEditId===t._editId){
      accountStageMeasurements_(ss,normalized.items,true);
      if(!accountSame_(invoiceHeaderDefaults_(existing),normalized,Object.keys(normalized).filter(key=>key!=='items'))||staged.length!==normalized.items.length)throw new Error('Edit ID already used for a different invoice edit.');
      return invoiceResult_(ss,accountInvoiceRecord_(existing,allItems));
    }
    const history=accountRows_(ss,'InvoiceHistory');
    const committed=history.filter(row=>row.invoiceId===t.id).map(row=>JSON.parse(row.snapshot)).find(previous=>previous.id===t.id&&previous.lastEditId===t._editId);
    if(committed){
      accountStageMeasurements_(ss,normalized.items,true);
      if(!accountSame_(invoiceHeaderDefaults_(committed),normalized,Object.keys(normalized).filter(key=>key!=='items'))||staged.length!==normalized.items.length)throw new Error('Edit ID already used for a different invoice edit.');
      return invoiceResult_(ss,accountInvoiceRecord_(existing,allItems));
    }
    if(existing.status!=='issued')throw new Error('Cancelled invoices cannot be edited.');
    if(t.itemDescriptionSchemaVersion!==1&&allItems.some(item=>(item.versionId||'')===(existing.itemVersion||'')&&item.itemNote))throw new Error('Update the app before editing an invoice with item descriptions.');
    if(t.measurementSchemaVersion!==1&&allItems.some(item=>(item.versionId||'')===(existing.itemVersion||'')&&item.billingUnit))throw new Error('Update the app before editing an invoice with billing units or measurements.');
    if(!Number.isSafeInteger(t._expectedRevision)||Number(existing.revision||0)!==t._expectedRevision){const error=new Error('Invoice changed on another device. Reload it before editing.');error.code='EDIT_CONFLICT';throw error;}
    if(accountRows_(ss,'InvoiceNotes').some(note=>note.invoiceId===t.id))throw new Error('This invoice has correction notes. Add a credit or debit note instead of editing the original.');
    const previous=accountInvoiceRecord_(existing,allItems),changedAt=new Date().toISOString();
    // Stage immutable lines and the previous snapshot. Only the final header
    // switch commits this version; failed writes leave the prior invoice intact.
    const historyId=t.id+'-'+t._editId;
    if(!history.some(row=>row.id===historyId))accountWrite_(ss,'InvoiceHistory',{id:historyId,invoiceId:t.id,revision:previous.revision,changedAt,editId:t._editId,snapshot:JSON.stringify(previous)});
    const stagedIds=new Set(staged.map(item=>item.id));accountAppendRows_(ss,'InvoiceItems',normalized.items.filter(item=>!stagedIds.has(item.id)));
    accountStageMeasurements_(ss,normalized.items);
    SpreadsheetApp.flush();
    record={...existing,...normalized,itemDiscountMinor:normalized.items.reduce((sum,item)=>sum+item.discountMinor,0),revision:previous.revision+1,lastEditId:t._editId,updatedAt:changedAt};
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
    const openingBalance=accountAmount_(Number(party.openingBalanceMinor),true);
    if((openingBalance!==0||t._expectedOpeningBalanceMinor!==undefined)&&(!Number.isSafeInteger(t._expectedOpeningBalanceMinor)||t._expectedOpeningBalanceMinor!==openingBalance)){const error=new Error('Confirm the current opening balance before deleting this party. Refresh and try again.');error.code='EDIT_CONFLICT';throw error;}
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
  return ['createInvoice','updateInvoice'].includes(action)?invoiceResult_(ss,record):{ok:true,id:t.id,record};
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

// Exact rational billing; mirrored in src/measurements.js and checked by regression tests.
function billingQuantity_(item){
  const unit=item.billingUnit||'',mode=item.measurementMode||'quantity';
  if(!['','nos','sqft','rft','kg'].includes(unit))throw new Error('Choose a supported billing unit.');
  const rows=item.measurements||[];
  if(!Array.isArray(rows)||rows.length>100)throw new Error('Each item group supports at most 100 measurement rows.');
  if(!unit&&rows.length)throw new Error('Choose a billing unit for grouped measurements.');
  if(unit==='sqft'&&mode!=='dimensions'||unit==='rft'&&!['dimensions','perimeter'].includes(mode))throw new Error('Choose the measurement calculation.');
  if(['sqft','rft'].includes(unit)&&!['feet','inches'].includes(item.measurementUnit))throw new Error('Choose Feet or Inches.');
  if(!['sqft','rft'].includes(unit)&&unit&&mode!=='quantity')throw new Error('This unit uses quantity or weight.');
  if(['sqft','rft'].includes(unit)&&!rows.length)throw new Error('Add at least one size to this item group.');
  let numerator=BigInt(0),denominator=BigInt(1000);
  if(rows.length){
    if(unit==='sqft')denominator=item.measurementUnit==='inches'?BigInt(144000000):BigInt(1000000);
    else if(unit==='rft')denominator=item.measurementUnit==='inches'?BigInt(12000):BigInt(1000);
    for(const row of rows){
      if(typeof row.description!=='string'||row.description.length>150)throw new Error('Measurement descriptions must be at most 150 characters.');
      if(!Number.isSafeInteger(row.pieces)||row.pieces<=0||row.pieces>1000000)throw new Error('Pieces must be a whole number between 1 and 1,000,000.');
      const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=1000000000;
      let value;
      if(unit==='sqft'){if(!positive(row.lengthMilli)||!positive(row.widthMilli))throw new Error('Enter valid length and width.');value=BigInt(row.lengthMilli)*BigInt(row.widthMilli);}
      else if(unit==='rft'){if(!positive(row.lengthMilli)||mode==='perimeter'&&!positive(row.widthMilli))throw new Error('Enter valid frame dimensions or length.');value=mode==='perimeter'?BigInt(2)*(BigInt(row.lengthMilli)+BigInt(row.widthMilli)):BigInt(row.lengthMilli);}
      else {if(!positive(row.quantityMilli))throw new Error('Enter a valid weight or quantity.');value=BigInt(row.quantityMilli);}
      numerator+=value*BigInt(row.pieces);
    }
  }else{if(!Number.isSafeInteger(item.quantityMilli)||item.quantityMilli<=0||item.quantityMilli>1000000000)throw new Error('Enter a valid item quantity.');numerator=BigInt(item.quantityMilli);}
  if(numerator<=BigInt(0)||numerator>BigInt(1000000)*denominator)throw new Error('Total item quantity must be positive and no greater than 1,000,000.');
  return {numerator,denominator,quantityMilli:Number((numerator*BigInt(1000)+denominator/BigInt(2))/denominator)};
}
function billingPrice_(rate,quantity){
  if(!Number.isSafeInteger(rate)||rate<0||rate>100000000000)throw new Error('Invalid unit price.');
  const amount=(BigInt(rate)*quantity.numerator+quantity.denominator/BigInt(2))/quantity.denominator;
  if(amount>BigInt(100000000000))throw new Error('Item amount exceeds the supported limit.');
  return Number(amount);
}

function accountMeasurementIndex_(ss){
  const records=accountReadRows_(ss,'InvoiceMeasurements'),byItem=new Map(),ids=new Set();
  records.forEach(row=>{if(ids.has(row.id))throw new Error('Duplicate measurement IDs. Repair the Sheet.');ids.add(row.id);if(!byItem.has(row.itemId))byItem.set(row.itemId,[]);byItem.get(row.itemId).push(row);});
  byItem.forEach(rows=>rows.sort((a,b)=>Number(a.id.split('-m').pop())-Number(b.id.split('-m').pop())));return byItem;
}
function accountStageMeasurements_(ss,items,verifyOnly=false){
  const expected=items.flatMap(item=>(item.measurements||[]).map((row,index)=>({id:item.id+'-m'+(index+1),invoiceId:item.invoiceId,itemId:item.id,...row})));
  if(!expected.length)return;
  const table=accountTable_(ss,'InvoiceMeasurements'),wantedItems=new Set(items.map(item=>item.id)),byId=new Map(expected.map(row=>[row.id,row]));
  const existing=table.records.filter(row=>wantedItems.has(row.itemId));
  if(expected.some(row=>table.byId.has(row.id)&&!accountSame_(table.byId.get(row.id).record,row,ACCOUNT_HEADERS.InvoiceMeasurements)))throw new Error('This measurement ID belongs to different saved data. Repair the Sheet before retrying.');
  if(existing.some(row=>!byId.has(row.id)||!accountSame_(row,byId.get(row.id),ACCOUNT_HEADERS.InvoiceMeasurements)))throw new Error('This request ID was already used for different measurements. Retry the original request.');
  const missing=expected.filter(row=>!table.byId.has(row.id));if(verifyOnly&&missing.length)throw new Error('Saved invoice has missing measurements. Repair the Sheet before continuing.');
  if(!verifyOnly)accountAppendRows_(ss,'InvoiceMeasurements',missing);
}

// Stock quantities are decimal strings at 1e-8 precision, never floating-point balances.
const STOCK_SCALE_=BigInt(100000000);
const STOCK_UNITS_=['NOS','PCS','SHEET','BOX','PACKET','BORI','BUNDLE','KG','GRAM','RFT','SQFT','METER','ROLL','SET'];
function stockDecimal_(value,signed=false){
  const text=String(value==null?'':value).trim();
  if(!(signed?/^-?\d+(\.\d{1,8})?$/:/^\d+(\.\d{1,8})?$/).test(text))throw new Error('Invalid stock quantity; use at most 8 decimal places.');
  const negative=text[0]==='-',parts=text.replace(/^-/,'').split('.');
  const amount=BigInt(parts[0])*STOCK_SCALE_+BigInt((parts[1]||'').padEnd(8,'0'));
  if(amount>BigInt('100000000000000000'))throw new Error('Stock quantity is too large.');return negative?-amount:amount;
}
function stockText_(value){const n=BigInt(value),a=n<0?-n:n,rest=a%STOCK_SCALE_;return (n<0?'-':'')+String(a/STOCK_SCALE_)+(rest?'.'+String(rest).padStart(8,'0').replace(/0+$/,''):'');}
function stockConvert_(quantity,factor){const product=stockDecimal_(quantity,true)*stockDecimal_(factor);if(product%STOCK_SCALE_)throw new Error('Stock conversion exceeds 8 decimal places.');const value=stockText_(product/STOCK_SCALE_);stockDecimal_(value,true);return value;}
function stockCanonical_(value){if(Array.isArray(value))return value.map(stockCanonical_);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stockCanonical_(value[key])]));return value;}
function stockSnapshot_(ss){
  const operations=accountReadRows_(ss,'StockOperations');
  if(new Set(operations.map(row=>row.id)).size!==operations.length)throw new Error('Duplicate stock operations. Repair the Sheet.');
  const committed=new Set(operations.map(op=>op.id)),reversed=new Set(operations.filter(op=>op.kind==='reversal').map(op=>op.reversesId));
  const items=accountReadRows_(ss,'StockItems').filter(row=>committed.has(row.operationId));
  const movements=accountReadRows_(ss,'StockMovements').filter(row=>committed.has(row.operationId));
  const reviews=accountReadRows_(ss,'StockReviews').filter(row=>committed.has(row.operationId)&&!reversed.has(row.operationId));
  const balances=new Map();movements.forEach(row=>balances.set(row.stockItemId,(balances.get(row.stockItemId)||BigInt(0))+stockDecimal_(row.baseQuantity,true)));
  return {items:items.map(item=>({...item,saleRateMinor:Number(item.saleRateMinor),purchaseRateMinor:Number(item.purchaseRateMinor),balance:stockText_(balances.get(item.id)||BigInt(0))})),movements,reviews,operations:operations.map(op=>{const {payloadHash,...publicOp}=op;return {...publicOp,reversed:reversed.has(op.id)};}),openingDate:operations.find(op=>op.kind==='opening')?.openingDate||''};
}
function stockItem_(input,operationId){
  accountId_(input.id);const baseUnit=input.baseUnit,secondaryUnit=input.secondaryUnit||'';
  if(!STOCK_UNITS_.includes(baseUnit)||secondaryUnit&&(!STOCK_UNITS_.includes(secondaryUnit)||secondaryUnit===baseUnit))throw new Error('Choose a base unit and a different optional secondary unit.');
  const conversion=secondaryUnit?stockText_(stockDecimal_(input.conversion)):'1';if(stockDecimal_(conversion)<=0)throw new Error('Conversion must be positive.');
  const lowStock=input.lowStock===''||input.lowStock==null?'':stockText_(stockDecimal_(input.lowStock));
  const saleRateUnit=input.saleRateUnit||baseUnit,purchaseRateUnit=input.purchaseRateUnit||baseUnit;if([saleRateUnit,purchaseRateUnit].some(unit=>unit!==baseUnit&&unit!==secondaryUnit))throw new Error('Choose the units for sale and purchase prices.');
  return {id:input.id,operationId,saleRateUnit,purchaseRateUnit,sourceId:accountText_(input.sourceId||'',100),name:accountText_(input.name,300,true).toUpperCase(),code:accountText_(input.code||'',100),category:accountText_(input.category||'',100),baseUnit,secondaryUnit,conversion,lowStock,saleRateMinor:accountAmount_(input.saleRateMinor||0),purchaseRateMinor:accountAmount_(input.purchaseRateMinor||0)};
}
function stockStage_(ss,name,rows){
  const table=accountTable_(ss,name),missing=[];
  rows.forEach(row=>{const previous=table.byId.get(row.id)?.record;if(previous){if(!accountSame_(previous,row,ACCOUNT_HEADERS[name].filter(key=>key!=='createdAt')))throw new Error('This stock request ID already contains different data. Retry the original request.');}else missing.push(row);});accountAppendRows_(ss,name,missing);
}
function stockAction_(action,t){
  const ss=spreadsheet_();if(action==='listStock')return {ok:true,...stockSnapshot_(ss)};
  if(!t||typeof t!=='object')throw new Error('Missing stock request.');accountId_(t.id);
  const payloadHash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(stockCanonical_(t))).map(byte=>('0'+(byte&255).toString(16)).slice(-2)).join(''),operations=accountRows_(ss,'StockOperations'),previous=operations.find(op=>op.id===t.id);
  if(previous){if(previous.payloadHash!==payloadHash)throw new Error('This stock request ID was used with different values.');return {ok:true,id:t.id,stock:stockSnapshot_(ss)};}
  const snapshot=stockSnapshot_(ss),now=new Date().toISOString(),itemsById=new Map(snapshot.items.map(item=>[item.id,item]));
  const operation={id:t.id,kind:'',payloadHash,openingDate:'',invoiceId:'',invoiceRevision:'',reversesId:'',createdAt:now},items=[],movements=[],reviews=[];
  function movement(item,entry,extra={}){
    const quantity=stockText_(stockDecimal_(entry.quantity,true));if(stockDecimal_(quantity,true)===BigInt(0))throw new Error('Stock movement must be nonzero.');
    if(!validDate_(entry.movementDate)||snapshot.openingDate&&entry.movementDate<snapshot.openingDate)throw new Error('Choose a stock movement date on or after opening stock.');
    const unit=entry.unit||item.baseUnit;if(unit!==item.baseUnit&&unit!==item.secondaryUnit)throw new Error('Choose the stock item’s base or secondary unit.');
    const conversion=unit===item.baseUnit?'1':item.conversion,baseQuantity=stockConvert_(quantity,conversion);
    if(['PCS','NOS'].includes(item.baseUnit)&&stockDecimal_(baseQuantity,true)%STOCK_SCALE_)throw new Error(item.name+' converts to fractional '+item.baseUnit+'. Confirm the whole-piece count or conversion; stock will not be rounded.');
    if(baseQuantity==='0')throw new Error('Stock movement rounds to zero.');
    movements.push({id:t.id+'-m'+(movements.length+1),operationId:t.id,stockItemId:item.id,movementDate:entry.movementDate,quantity,unit,conversion,baseQuantity,invoiceId:'',invoiceItemId:'',reason:accountText_(entry.reason||'',500,true),createdAt:now,...extra});
  }
  if(action==='importStock'||action==='createStockItem'){
    if(action==='importStock'&&snapshot.openingDate)throw new Error('Opening stock is already imported. Use stock adjustments instead of importing again.');
    if(action==='importStock'&&(!validDate_(t.openingDate)||!Array.isArray(t.items)||!t.items.length||t.items.length>500))throw new Error('Choose an opening date and 1–500 items.');
    const inputs=action==='importStock'?t.items:[t.item];operation.kind=action==='importStock'?'opening':'item';operation.openingDate=action==='importStock'?t.openingDate:'';
    const sourceIds=new Set(snapshot.items.filter(item=>item.sourceId).map(item=>item.sourceId)),names=new Set(snapshot.items.map(item=>catalogueKey_(item.name)+'|'+catalogueKey_(item.code)));
    inputs.forEach(input=>{
      if(!input)throw new Error('Missing stock item.');const item=stockItem_(input,t.id),nameKey=catalogueKey_(item.name)+'|'+catalogueKey_(item.code);
      if(catalogueKey_(item.name)==='GENERIC SALE')throw new Error('GENERIC SALE is excluded from physical stock.');
      if(itemsById.has(item.id)||items.some(row=>row.id===item.id)||item.sourceId&&sourceIds.has(item.sourceId)||names.has(nameKey))throw new Error('Duplicate stock item or model.');
      names.add(nameKey);if(item.sourceId)sourceIds.add(item.sourceId);items.push({...item,createdAt:now});itemsById.set(item.id,item);
      if(action==='importStock'){
        if(![item.baseUnit,item.secondaryUnit].includes(input.importUnit)||!input.importUnit||!input.saleRateUnit||!input.purchaseRateUnit)throw new Error('Confirm exported quantity and price units before importing.');
        const opening=stockDecimal_(input.quantity);if(opening<0)throw new Error('Review negative opening stock before importing.');
        if(opening>0)movement(item,{quantity:stockText_(opening),unit:input.importUnit,movementDate:t.openingDate,reason:'Opening stock import'});
      }
    });
  }else if(action==='recordStock'){
    if(!snapshot.openingDate)throw new Error('Import opening stock before recording movements.');operation.kind='manual';
    const item=itemsById.get(t.stockItemId);if(!item)throw new Error('Select a stock item.');movement(item,t);
  }else if(action==='reviewInvoiceStock'){
    if(!snapshot.openingDate)throw new Error('Import opening stock before reviewing invoices.');
    const invoice=accountRows_(ss,'Invoices').find(row=>row.id===t.invoiceId);
    if(!invoice||invoice.status!=='issued'||Number(invoice.revision||0)!==t.invoiceRevision||invoice.invoiceDate<snapshot.openingDate)throw new Error('Invoice changed or predates opening stock. Refresh and review it.');
    if(snapshot.operations.some(op=>op.kind==='review'&&op.invoiceId===invoice.id&&!op.reversed&&Number(op.invoiceRevision)!==t.invoiceRevision))throw new Error('Reverse the previous stock updates before reviewing this edited invoice.');
    const invoiceItems=accountRows_(ss,'InvoiceItems').filter(item=>item.invoiceId===invoice.id&&(item.versionId||'')===(invoice.itemVersion||''));
    const allowed=new Set(invoiceItems.map(item=>item.id)),handled=new Set(snapshot.reviews.filter(row=>row.invoiceId===invoice.id).map(row=>row.invoiceItemId));
    if(!Array.isArray(t.entries)||!t.entries.length||t.entries.length>50)throw new Error('Choose invoice items to review.');
    operation.kind='review';operation.invoiceId=invoice.id;operation.invoiceRevision=t.invoiceRevision;
    t.entries.forEach((entry,index)=>{
      if(!allowed.has(entry.invoiceItemId)||handled.has(entry.invoiceItemId)||!['updated','no-impact'].includes(entry.status))throw new Error('Invoice item was already handled or is invalid.');handled.add(entry.invoiceItemId);
      const reason=accountText_(entry.reason||'',500,true);
      if(entry.status==='updated'){
        if(!Array.isArray(entry.movements)||!entry.movements.length||entry.movements.length>20)throw new Error('Choose 1–20 material movements for this item.');
        entry.movements.forEach(input=>{const item=itemsById.get(input.stockItemId);if(!item)throw new Error('Select a stock material.');const quantity=stockDecimal_(input.quantity);if(quantity<=0)throw new Error('Enter a positive material quantity.');movement(item,{...input,quantity:stockText_(invoice.type==='sale'?-quantity:quantity),movementDate:t.movementDate,reason},{invoiceId:invoice.id,invoiceItemId:entry.invoiceItemId});});
      }else if(entry.movements?.length)throw new Error('No-impact items cannot contain stock movements.');
      reviews.push({id:t.id+'-r'+(index+1),operationId:t.id,invoiceId:invoice.id,invoiceRevision:t.invoiceRevision,invoiceItemId:entry.invoiceItemId,status:entry.status,reason});
    });
  }else if(action==='reverseStock'){
    const original=snapshot.operations.find(op=>op.id===t.reversesId);
    if(!original||original.reversed||!['manual','review'].includes(original.kind))throw new Error('Choose an active stock update to reverse.');
    const reason=accountText_(t.reason,500,true);if(!validDate_(t.movementDate)||t.movementDate<snapshot.openingDate)throw new Error('Choose a reversal date on or after opening stock.');
    operation.kind='reversal';operation.reversesId=original.id;
    snapshot.movements.filter(row=>row.operationId===original.id).forEach(row=>movements.push({...row,id:t.id+'-m'+(movements.length+1),operationId:t.id,movementDate:t.movementDate,quantity:stockText_(-stockDecimal_(row.quantity,true)),baseQuantity:stockText_(-stockDecimal_(row.baseQuantity,true)),reason,createdAt:now}));
  }else throw new Error('Unsupported stock action.');
  if(movements.length>1000)throw new Error('Too many stock movements in one request.');
  const balances=new Map(snapshot.items.map(item=>[item.id,stockDecimal_(item.balance,true)]));
  movements.forEach(row=>balances.set(row.stockItemId,(balances.get(row.stockItemId)||BigInt(0))+stockDecimal_(row.baseQuantity,true)));
  if(t.allowNegative!==true&&movements.some(row=>balances.get(row.stockItemId)<0))throw new Error('This update creates negative stock. Review quantities or explicitly allow negative stock.');
  // Child rows are invisible until the operation commits. A failed/lost response retries the same IDs.
  stockStage_(ss,'StockItems',items);stockStage_(ss,'StockMovements',movements);stockStage_(ss,'StockReviews',reviews);
  SpreadsheetApp.flush();accountWrite_(ss,'StockOperations',operation);SpreadsheetApp.flush();
  return {ok:true,id:t.id,stock:stockSnapshot_(ss)};
}
