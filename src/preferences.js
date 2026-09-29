import { categories, methods, validMinorAmount } from './ledger.js';

export const SHOP_BRAND = {
  name: 'Royal Furnitures',
  tagline: 'Apne Gar ko do ROYAL touch sirf Royal Furnitures se',
  address: '46/2, Lakkhad Pitha road',
  phone: '+917987979086',
  timezone: 'Asia/Kolkata',
  instagram: 'https://www.instagram.com/royalfurniture45/',
};
export const DEFAULT_PREFERENCES = { shopName:SHOP_BRAND.name, address:SHOP_BRAND.address, phone:SHOP_BRAND.phone, defaultCategory:'Sale', defaultMethod:'Cash', theme:'light', largeText:false, printNotes:true, printContact:true };
export function normalizePreferences(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const migrateGenericDefaults = input.shopName === 'Shop Ledger' && !String(input.address || '').trim() && !String(input.phone || '').trim();
  return {
    shopName: typeof input.shopName==='string' && input.shopName.trim() && input.shopName.trim() !== 'Shop Ledger' ? input.shopName.trim().slice(0,100) : SHOP_BRAND.name,
    address: typeof input.address==='string' ? (migrateGenericDefaults && !input.address.trim() ? SHOP_BRAND.address : input.address.slice(0,300)) : SHOP_BRAND.address,
    phone: typeof input.phone==='string' ? (migrateGenericDefaults && !input.phone.trim() ? SHOP_BRAND.phone : input.phone.slice(0,50)) : SHOP_BRAND.phone,
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
  const columns = ['id','recordType','transactionDate','transactionTime','timezone','direction','category','method','amount','currency','party','partyId','notes','chequeDate','cashReceivedMinor','cashChangeMinor','onlineChangeMinor','fromMethod','toMethod','expectedCashMinor','countedCashMinor','cashAdjustmentMinor','expectedOnlineMinor','countedOnlineMinor','onlineAdjustmentMinor','createdAt','updatedAt'];
  const cell = value => {
    let text = String(value ?? '');
    // CSV quoting alone does not stop spreadsheet formula execution.
    if (/^[\t\r\n]|^\s*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"','""') + '"';
  };
  return '\uFEFF' + [columns, ...rows.map(t=>columns.map(key=>key==='amount'?(validMinorAmount(t.amountMinor)?(Number(t.amountMinor)/100).toFixed(2):'INVALID'):t[key]))].map(row=>row.map(cell).join(',')).join('\r\n');
}
export function downloadText(text, filename, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text],{type}));
  const link=document.createElement('a');link.href=url;link.download=filename;
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
