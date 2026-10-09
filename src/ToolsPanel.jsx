import React,{useEffect,useState} from 'react';
import SheetCuttingPanel from './SheetCuttingPanel.jsx';
import LaminatePanel from './LaminatePanel.jsx';
import './tools.css';
export default function ToolsPanel({active=true,shopName='Royal Furnitures'}){
 const [tool,setTool]=useState('cutting');
 useEffect(()=>{if(!active)return;document.body.dataset.toolsActive='true';return()=>{delete document.body.dataset.toolsActive;};},[active]);
 return <section className="tools-hub" aria-label="Tools">
  <div className="heading tools-hub-heading"><div><h1>Tools</h1><p>Measurements & material planning</p></div></div>
  <div className="tools-selector" role="group" aria-label="Choose calculator">
   <button aria-pressed={tool==='cutting'} onClick={()=>setTool('cutting')}><span aria-hidden="true">▦</span>Sheet cutting</button>
   <button aria-pressed={tool==='laminate'} onClick={()=>setTool('laminate')}><span aria-hidden="true">▱</span>Laminate calculator</button>
  </div>
  <div hidden={tool!=='cutting'}><SheetCuttingPanel active={active&&tool==='cutting'} shopName={shopName}/></div>
  <div hidden={tool!=='laminate'}><LaminatePanel shopName={shopName}/></div>
 </section>;
}
