// One self-contained asset for the app, printable documents and downloaded reports.
import logo from './brandAsset.js';
export const BRAND_LOGO=logo;
export function loadBrandImage(){
  return new Promise(resolve=>{
    const image=new Image();
    const timer=setTimeout(()=>resolve(null),5000);
    image.onload=()=>{clearTimeout(timer);resolve(image);};
    image.onerror=()=>{clearTimeout(timer);resolve(null);};
    image.src=BRAND_LOGO;
  });
}
export const brandReportLogo=()=>`<img src="${BRAND_LOGO}" alt="Royal Furnitures" style="width:100px;height:100px;object-fit:contain;display:block;margin-bottom:12px">`;
