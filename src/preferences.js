import { categories, methods } from './ledger.js';

export const DEFAULT_PREFERENCES = { shopName:'Shop Ledger', address:'', phone:'', defaultCategory:'Sale', defaultMethod:'Cash', theme:'light', largeText:false, printNotes:true, printContact:true };
export function normalizePreferences(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    shopName: typeof input.shopName==='string' && input.shopName.trim() ? input.shopName.trim().slice(0,100) : 'Shop Ledger',
    address: typeof input.address==='string' ? input.address.slice(0,300) : '',
    phone: typeof input.phone==='string' ? input.phone.slice(0,50) : '',
    defaultCategory: categories.includes(input.defaultCategory) ? input.defaultCategory : 'Sale',
    defaultMethod: methods.includes(input.defaultMethod) ? input.defaultMethod : 'Cash',
    theme: input.theme==='dark' ? 'dark' : 'light',
    largeText: input.largeText===true,
    printNotes: input.printNotes!==false,
    printContact: input.printContact!==false,
  };
}
export const preferenceKey = endpoint => `rf.preferences.${endpoint || 'unconnected'}`;
export function entryDefaults(preferences) {
  return { category:preferences.defaultCategory, method:preferences.defaultMethod, direction:preferences.defaultCategory==='Sale'?'in':'out' };
}
export function csvForTransactions(rows) {
  const columns = ['id','transactionDate','transactionTime','timezone','direction','category','method','amount','currency','party','notes','chequeDate','createdAt','updatedAt'];
  const cell = value => {
    let text = String(value ?? '');
    // CSV quoting alone does not stop spreadsheet formula execution.
    if (/^[\t\r\n]|^\s*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"','""') + '"';
  };
  return '\uFEFF' + [columns, ...rows.map(t=>columns.map(key=>key==='amount'?(Number(t.amountMinor)/100).toFixed(2):t[key]))].map(row=>row.map(cell).join(',')).join('\r\n');
}
export function downloadText(text, filename, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text],{type}));
  const link=document.createElement('a');link.href=url;link.download=filename;
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
