import vm from 'node:vm';
import { readFileSync } from 'node:fs';
// A multi-tab in-memory Sheet, including failure injection between item/header writes.
export function accountBackend() {
  const tabs=new Map(); let failTab='';const calls=[];
  function sheet(name){
    const data=[];
    const value={data,getLastColumn:()=>data[0]?.length||0,getLastRow:()=>data.length,setFrozenRows(){},getRange(r,c,n=1,m=1){return {
      getValues:()=>{calls.push({operation:'read',name,r,c,n,m});return Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>data[r-1+i]?.[c-1+j]??''));},
      setValue(v){data[r-1]??=[];data[r-1][c-1]=v;return this;},
      setValues(rows){calls.push({operation:'write',name,r,c,n,m});if(failTab===name&&r>1){failTab='';throw new Error('Simulated interrupted write');}rows.forEach((row,i)=>{data[r-1+i]??=[];row.forEach((v,j)=>data[r-1+i][c-1+j]=typeof v==='string'&&v.startsWith("'")?v.slice(1):v);});return this;},
      setNumberFormat(){return this;},setBackground(){return this;},setFontColor(){return this;},setFontWeight(){return this;}
    };}};tabs.set(name,value);return value;
  }
  const ss={getSheetByName:name=>tabs.get(name),insertSheet:sheet};
  const context=vm.createContext({console,ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'test-sheet'})},SpreadsheetApp:{openById:()=>ss,flush(){}},LockService:{getScriptLock:()=>({waitLock(){},hasLock:()=>true,releaseLock(){}})}});
  vm.runInContext(readFileSync(new URL('../../google-apps-script/Code.gs',import.meta.url),'utf8'),context);
  const post=(action,transaction)=>context.doPost({postData:{contents:JSON.stringify({action,transaction})}});
  return {post,tabs,context,calls,failNext:name=>{failTab=name;}};
}
