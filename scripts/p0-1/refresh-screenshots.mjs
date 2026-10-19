// Re-capture the two workspace views after copy/size formatting changes only.
import {readFile,writeFile} from 'node:fs/promises';
import {chromium,devices} from '@playwright/test';
import {browserNetwork} from '../shared/browser-network.mjs';
const fixture=JSON.parse(await readFile('tmp/p0-1/business-fixtures.json','utf8'));
const browser=await chromium.launch(browserNetwork()),results=[];
try{
 for(const actor of ['owner','guest']){
  const context=await browser.newContext(actor==='owner'?{viewport:{width:1440,height:1000},storageState:'tmp/p0-1/owner-A.json'}:{...devices['Pixel 7']});
  try{
   const page=await context.newPage();
   await page.goto(actor==='owner'?`http://127.0.0.1:3000/projects/${fixture.projectA}`:fixture.shareUrl);
   if(actor==='guest')await page.waitForURL('**/s/session?project=*',{timeout:60000});
   await page.getByRole('button',{name:/plate.jpg/}).click();
   await page.waitForFunction(()=>document.querySelector('.image-viewport img')?.naturalWidth>0);
   await page.getByText('图片方向已校正，照片元数据已移除。放大后可滚动查看。').waitFor();
   await page.screenshot({path:`docs/evidence/p0-1/screenshots/${actor==='owner'?'engineer-desktop':'guest-mobile-files'}.png`,fullPage:true});
   results.push({actor,status:'PASS'});
  }finally{await context.close();}
 }
}catch{results.push({status:'FAIL',code:'WORKSPACE_SCREENSHOT_NOT_READY'});process.exitCode=1;}
finally{await browser.close();}
await writeFile('docs/evidence/p0-1/final-ui.json',`${JSON.stringify({checkedAt:new Date().toISOString(),purpose:'Production workspace copy and size formatting recheck; not a substitute for business suite',results},null,2)}\n`);
process.stdout.write(`${JSON.stringify(results)}\n`);
