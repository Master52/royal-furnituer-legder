import {randomUUID} from './uuid.js';
export const MAX_CHALLAN_PHOTOS=10;
export const CHALLAN_PHOTO_BYTES=750000;
export const challanCompletion=record=>record.completedAt?'Completed':'Pending';
export function photoDeletionDate(record){
 if(record.amountOnly||!record.autoDelete||!record.completedAt||record.photosDeletedAt)return '';
 const time=Date.parse(record.completedAt);return Number.isFinite(time)?new Date(time+30*86400000).toISOString():'';
}
export function validateCapture(name,photos){
 if(!name.trim()||name.trim().length>150)throw new Error('Enter a challan name, up to 150 characters.');
 if(!photos.length||photos.length>MAX_CHALLAN_PHOTOS)throw new Error('Choose between 1 and 10 challan photos.');
 for(const photo of photos)if(photo.mimeType!=='image/jpeg'||!photo.data.startsWith('/9j/')||photo.data.length>1000000)throw new Error('A photo is too large or unreadable. Choose it again.');
}
export async function prepareChallanPhoto(file){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose a JPEG, PNG or WebP photo.');
 if(file.size>25*1024*1024)throw new Error('Choose photos smaller than 25 MB each.');
 const url=URL.createObjectURL(file);
 try{
  const image=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('This photo could not be opened. Try another image.'));image.src=url;});
  const canvas=document.createElement('canvas'),ratio=Math.min(1,2000/Math.max(image.naturalWidth,image.naturalHeight));
  canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
  const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  let blob;for(const quality of [.88,.78,.68,.58,.48]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=CHALLAN_PHOTO_BYTES)break;}
  if(!blob||blob.size>CHALLAN_PHOTO_BYTES)throw new Error('This photo is too detailed to upload. Crop it or photograph the page in smaller sections.');
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('The photo could not be read.'));reader.readAsDataURL(blob);});
  return {id:randomUUID(),name:(file.name.replace(/\.[^.]+$/,'').slice(0,140)||'Challan photo')+'.jpg',mimeType:'image/jpeg',data};
 }finally{URL.revokeObjectURL(url);}
}
