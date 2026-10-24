import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {accountBackend,TEST_ACCESS_TOKEN} from '../helpers/accountBackend.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,headless:true,args:['--no-sandbox']});
const endpoint='https://script.google.com/macros/s/TEST-ONLY/exec',backend=accountBackend(),errors=[];
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.addInitScript(({endpoint,token})=>{
  localStorage.setItem('rf.endpoint',JSON.stringify(endpoint));
  localStorage.setItem('rf.connectionInfo',JSON.stringify({endpoint,version:'1.28.0'}));
  sessionStorage.setItem('rf.access-token:'+endpoint,token);
 },{endpoint,token:TEST_ACCESS_TOKEN});
 await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort());
 await context.route('https://script.google.com/**',route=>route.fulfill({json:backend.rawPost(route.request().postDataJSON())}));
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.LEDGER_TEST_URL||'http://127.0.0.1:5175',{waitUntil:'domcontentloaded'});
 await page.locator('.brand-intro-logo').waitFor();
 const initial=await page.locator('.brand-intro-logo').boundingBox();assert.ok(initial.width>150,'Intro must start with a large centred logo');
 await page.waitForFunction(()=>!document.querySelector('.brand-intro'));
 assert.equal(await page.locator('[data-brand-home]').isVisible(),true);
 assert.equal(await page.locator('.brand-logo').evaluate(el=>el.complete&&el.naturalWidth>0),true);
 await page.locator('.topbar').getByRole('button',{name:'⚙ Settings',exact:true}).click();
 await page.getByRole('button',{name:'Shop & preferences',exact:true}).click();
 const theme=page.locator('.preferences-panel select').filter({has:page.locator('option[value=dark]')});await theme.selectOption('dark');
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rf.appearance')).theme),'dark');
 assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(27, 23, 19)');
 assert.equal(await page.locator('dialog[open]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(39, 33, 27)');
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!document.querySelector('.brand-intro')&&document.querySelector('.brand-logo'));
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 await mkdir('/tmp/ledger-browser-results',{recursive:true});
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:900});
  for(const value of ['light','dark']){
   await page.locator('.topbar').getByRole('button',{name:'⚙ Settings',exact:true}).click();await page.getByRole('button',{name:'Shop & preferences',exact:true}).click();await theme.selectOption(value);
   await page.getByRole('button',{name:'Close dialog',exact:true}).click();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${value} at ${width}px overflows`);
   await page.screenshot({path:`/tmp/ledger-browser-results/royal-${value}-${width}.png`,fullPage:true});
  }
 }
 // A normal mobile launch must also finish at the mobile header position.
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!document.querySelector('.brand-intro')&&document.querySelector('.brand-logo'));
 assert.equal(await page.locator('[data-brand-home]').isVisible(),true);
 await page.emulateMedia({reducedMotion:'reduce'});await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('[data-brand-home]')&&!document.querySelector('.brand-intro'));
 assert.equal(await page.locator('[data-brand-home]').isVisible(),true);
 const exported=await page.evaluate(async()=>{
  const {tableDocumentImages,documentImages}=await import('/src/documentImages.js');
  const table=await tableDocumentImages('branding',{heading:'Royal Furnitures',title:'Ledger statement',metadata:['Test customer'],columns:[['Description',.7],['Amount',.3]],rows:[['Test entry','₹100']],totals:[['Total','₹100']],footer:'Amounts in INR'});
  const plain=await documentImages('Payment receipt','*Royal Furnitures*\nTest payment');
  const {BRAND_LOGO}=await import('/src/brand.js');const image=new Image();image.src=BRAND_LOGO;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,image.width,image.height).data;
  return {files:[...table,...plain].map(file=>({size:file.size,type:file.type})),transparent:data.some((value,index)=>index%4===3&&value===0)};
 });
 assert.ok(exported.transparent,'Logo needs a transparent background');assert.ok(exported.files.every(file=>file.size>1000&&file.type==='image/png'));
 assert.deepEqual(errors,[]);console.log('Branding passed: startup, mobile, reduced motion, immediate/persisted dark mode, responsive layouts, transparent logo and document image exports.');
}finally{await browser.close();}
