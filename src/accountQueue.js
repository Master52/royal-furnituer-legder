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
export async function queueLock(task){
  if(!globalThis.navigator?.locks)throw new Error('This browser cannot safely coordinate saved changes between tabs. Use a browser with Web Locks support. Nothing was added to the queue.');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),5000);
  try{return await navigator.locks.request('rf.accounts.queue',{signal:controller.signal},task);}
  catch(error){if(error.name==='AbortError')throw new Error('Another app tab is blocking local saving. Close that tab and try again. Nothing was added to the upload queue.');throw error;}
  finally{clearTimeout(timer);}
}
export function uploadLock(task){
  if(!globalThis.navigator?.locks)return Promise.reject(new Error('This browser cannot safely coordinate uploads between tabs. Use a browser with Web Locks support.'));
  return navigator.locks.request('rf.accounts.upload',task);
}
