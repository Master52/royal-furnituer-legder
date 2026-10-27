import React,{useEffect,useState} from 'react';
import {request} from './api.js';
export default function ChallanPhotos({endpoint,challan}){
 const [index,setIndex]=useState(0),[zoom,setZoom]=useState(1),[rotation,setRotation]=useState(0),[aspect,setAspect]=useState(1),[images,setImages]=useState({}),[error,setError]=useState(''),[loading,setLoading]=useState(false),[retry,setRetry]=useState(0);
 const photos=(challan?.photos||[]).filter(photo=>!photo.deletedAt),photo=photos[index]||photos[0],identity=endpoint+':'+challan?.id;
 useEffect(()=>{setIndex(0);setAspect(1);setZoom(1);setRotation(0);setImages({});setError('');},[identity]);
 useEffect(()=>{
  setZoom(1);setRotation(0);setError('');setLoading(false);
  if(!photo||images[photo.id])return;
  let cancelled=false;setLoading(true);
  request(endpoint,{id:photo.id,challanId:challan.id},'getChallanPhoto').then(result=>{if(!cancelled)setImages(previous=>({...previous,[photo.id]:'data:'+result.mimeType+';base64,'+result.data}));}).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});
  return()=>{cancelled=true;};
 },[endpoint,challan?.id,photo?.id,retry]);
 return <section className="challan-photo-viewer" aria-label="Challan photos"><div className="challan-photo-toolbar"><label>Page<select aria-label="Challan photo page" value={photo?.id||''} onChange={event=>setIndex(photos.findIndex(photo=>photo.id===event.target.value))}>{photos.map((photo,index)=><option key={photo.id} value={photo.id}>Page {index+1} · {photo.name}</option>)}</select></label><button type="button" className="outline" aria-label="Zoom out" disabled={zoom<=.5} onClick={()=>setZoom(value=>Math.max(.5,value-.25))}>-</button><button type="button" className="outline" aria-label="Zoom in" disabled={zoom>=3} onClick={()=>setZoom(value=>Math.min(3,value+.25))}>+</button><button type="button" className="outline" onClick={()=>setRotation(value=>(value+90)%360)}>Rotate</button></div>
  {loading&&<p role="status">Loading private photo…</p>}{error&&<p className="error" role="alert">{error} <button className="outline" onClick={()=>setRetry(value=>value+1)}>Retry photo</button></p>}
  {!photos.length&&<p>{challan?.photosDeletedAt?'Photos have been deleted. The purchase invoice is kept.':'No photos available yet.'}</p>}
  <div className="challan-photo-scroll">{photo&&images[photo.id]&&<div className="challan-photo-canvas" style={{width:`${zoom*100}%`,aspectRatio:rotation%180?1/aspect:aspect}}><img src={images[photo.id]} alt={`Challan ${challan.name}, page ${index+1}`} onLoad={event=>setAspect(event.currentTarget.naturalWidth/event.currentTarget.naturalHeight)} style={{width:`${rotation%180?aspect*100:100}%`,transform:`translate(-50%,-50%) rotate(${rotation}deg)`}}/></div>}</div>
  {photo&&images[photo.id]&&<a href={images[photo.id]} download={photo.name}>Download this photo</a>}
 </section>;
}
