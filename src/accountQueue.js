export const ACCOUNT_QUEUE_KEY='rf.accounts.pending';
export const operationKey=operation=>`${operation.endpoint}|${operation.action}|${operation.payload?.id}|${operation.payload?._editId||''}`;
export function readAccountQueue(storage){
  try {
    const value=JSON.parse(storage.getItem(ACCOUNT_QUEUE_KEY));
    if(!value)return [];
    const queue=value.queue??[value];
    return Array.isArray(queue)&&queue.every(item=>item&&typeof item==='object'&&(item.invalid||typeof item.endpoint==='string'&&item.action&&item.payload?.id))?queue:[{invalid:true}];
  }catch{return [{invalid:true}];}
}
export function writeAccountQueue(storage,queue){
  if(queue.length)storage.setItem(ACCOUNT_QUEUE_KEY,JSON.stringify({queue}));else storage.removeItem(ACCOUNT_QUEUE_KEY);
}
export function queueLock(task){
  return globalThis.navigator?.locks?navigator.locks.request('rf.accounts.queue',task):Promise.resolve().then(task);
}
export function uploadLock(task){
  return globalThis.navigator?.locks?navigator.locks.request('rf.accounts.upload',{ifAvailable:true},lock=>lock?task():false):task();
}
