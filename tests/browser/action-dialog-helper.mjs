// Existing workflow checks accept decisions automatically; action-dialogs.mjs
// exercises cancellation, focus, reason validation and explicit acceptance.
export async function acceptActionDialogs(page,{reason='Recorded mistake',onMessage=()=>{}}={}){
 await page.exposeFunction('__ledgerTestActionSeen',onMessage);
 await page.addInitScript(({reason})=>{
  const observe=()=>{
   const observer=new MutationObserver(()=>{
    const dialog=document.querySelector('.action-dialog[open]');
    if(!dialog||dialog.dataset.testAccepted)return;
    dialog.dataset.testAccepted='true';
    window.__ledgerTestActionSeen(dialog.querySelector('.action-message')?.textContent||'').then(()=>{
     const input=dialog.querySelector('textarea');
     if(input){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,reason);input.dispatchEvent(new Event('input',{bubbles:true}));}
     setTimeout(()=>dialog.querySelector('button[type=submit]')?.click(),0);
    });
   });
   observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
  };
  if(document.body)observe();else document.addEventListener('DOMContentLoaded',observe,{once:true});
 },{reason});
}
