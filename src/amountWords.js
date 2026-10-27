const small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const tens=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
function words(value){
 if(value<20)return small[value];
 if(value<100)return tens[Math.floor(value/10)]+(value%10?' '+small[value%10]:'');
 for(const [scale,label] of [[10000000,'crore'],[100000,'lakh'],[1000,'thousand'],[100,'hundred']]){
  if(value>=scale)return words(Math.floor(value/scale))+' '+label+(value%scale?' '+words(value%scale):'');
 }
}
export function amountWords(value){
 const text=String(value??'').trim();
 if(!/^\d+(\.\d{0,2})?$/.test(text))return '';
 const [whole,fraction='']=text.split('.'),rupees=Number(whole),paise=Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(rupees)||rupees>1000000000)return '';
 return words(rupees)+(paise?' rupees and '+words(paise)+' paise':'');
}
