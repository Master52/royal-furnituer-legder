import {accountBackend} from './accountBackend.js';
export function challanBackend({ready=true}={}){
 const backend=accountBackend(),properties=new Map([['SPREADSHEET_ID','test-sheet'],['LEDGER_ACCESS_TOKEN','test-ledger-access-token-0000000000000001']]),files=new Map(),folders=new Map(),triggers=[],scopeChecks=[];
 let now=Date.parse('2026-10-26T12:00:00Z'),sequence=0;
 const iterator=values=>{let index=0;return {hasNext:()=>index<values.length,next:()=>values[index++]};};
 function blob(bytes,mimeType='image/jpeg',name='photo.jpg'){return {getBytes:()=>[...bytes],getContentType:()=>mimeType,getName:()=>name};}
 function folder(id){return {getId:()=>id,getName:()=> 'Private challans',isTrashed:()=>false,getFilesByName:name=>iterator([...files.values()].filter(file=>file.parent===id&&file.name===name&&!file.trashed)),createFile:blob=>{
  const file={id:'private-file-'+(++sequence),name:blob.getName(),parent:id,trashed:false,getId(){return this.id;},getName(){return this.name;},getParents(){return iterator([{getId:()=>this.parent}]);},getBlob:()=>blob,isTrashed(){return this.trashed;},setTrashed(value){this.trashed=value;return this;}};files.set(file.id,file);return file;
 }};}
 const drive={createFolder:name=>{const id='private-folder-'+(++sequence);const result=folder(id);folders.set(id,result);return result;},getFolderById:id=>{if(!folders.has(id))throw new Error('Folder not found');return folders.get(id);},getFileById:id=>{if(!files.has(id))throw new Error('File not found');return files.get(id);}};
 backend.context.PropertiesService={getScriptProperties:()=>({getProperty:key=>properties.get(key)||null,setProperty:(key,value)=>properties.set(key,value)})};
 backend.context.DriveApp=drive;
 backend.context.ScriptApp={AuthMode:{FULL:'FULL'},requireScopes:(mode,scopes)=>scopeChecks.push({mode,scopes:[...scopes]}),getProjectTriggers:()=>triggers,newTrigger:name=>({timeBased(){return this;},everyDays(){return this;},atHour(){return this;},inTimezone(){return this;},create(){const trigger={getHandlerFunction:()=>name};triggers.push(trigger);return trigger;}})};
 backend.context.Utilities.base64Decode=data=>[...Buffer.from(data,'base64')];backend.context.Utilities.base64Encode=data=>Buffer.from(data.map(value=>value&255)).toString('base64');backend.context.Utilities.newBlob=blob;
 backend.context.LockService={getScriptLock:()=>({waitLock(){},tryLock:()=>true,hasLock:()=>true,releaseLock(){}})};
 backend.context.Date=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 if(ready)backend.context.setupChallanStorage();
 return {...backend,files,folders,properties,triggers,scopeChecks,setNow:value=>{now=Date.parse(value);}};
}
