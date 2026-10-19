import {request,chromium,devices} from '@playwright/test';
import {browserNetwork} from '../shared/browser-network.mjs';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const root='http://127.0.0.1:3000',events=[];
const api=await request.newContext({baseURL:root,storageState:'tmp/p0-1/owner-A.json'});
async function post(url,data){const csrf=await(await api.get('/api/csrf')).json();const r=await api.post(url,{data,headers:{origin:root,'x-csrf-token':csrf.data.token,'Idempotency-Key':randomUUID()}});if(!r.ok())throw new Error('FIXTURE_FAILED');return(await r.json()).data;}
let browser;
let status='FAIL';
try{
 const project=await post('/api/projects',{name:'TUS 真实浏览器验证',description:'7.5MB 二进制 STL 合成样本'});
 const link=await post(`/api/projects/${project.id}/share-links`,{});
 browser=await chromium.launch(browserNetwork());
 const context=await browser.newContext({...devices['Pixel 7']});const page=await context.newPage();
 page.on('response',async r=>{if(r.url().includes('/upload/resumable')){const event={method:r.request().method(),status:r.status()};if(r.status()>=400){try{const body=await r.json();event.reason=String(body.message??body.error??'').replace(/https?:\/\/\S+/g,'[url]').replace(/[A-Za-z0-9_.-]{32,}/g,'[redacted]').slice(0,240);}catch{event.reason='NON_JSON_ERROR';}}events.push(event);process.stdout.write(`${JSON.stringify(event)}\n`);}});
 page.on('requestfailed',r=>{if(r.url().includes('/upload/resumable')){const error=r.failure()?.errorText??'';events.push({method:r.method(),networkError:/^net::[A-Z_]+$/.test(error)?error:'NETWORK_FAILED'});}});
 page.on('console',message=>{if(message.type()==='error'){const text=message.text();const flags=['Content Security Policy','CORS','Access-Control','401','403','404','500'].filter(s=>text.includes(s));if(flags.length)events.push({consoleFlags:flags});}});
 await page.goto(link.url);await page.waitForURL('**/s/session?project=*',{timeout:60000});await page.getByLabel('选择上传文件').waitFor();
 const stl=Buffer.alloc(84+150000*50);stl.write('PartMeasure TUS fixture');stl.write(randomUUID(),40);stl.writeUInt32LE(150000,80);
 await page.getByLabel('选择上传文件').setInputFiles({name:'resumable-check.stl',mimeType:'application/octet-stream',buffer:stl});
 const row=page.locator('.queue li').filter({hasText:'resumable-check.stl'});
 await row.getByText('已完成 · 工程师和客户可查看',{exact:true}).waitFor({timeout:300000});
 status='PASS';await page.screenshot({path:'docs/evidence/p0-1/screenshots/tus-mobile.png',fullPage:true});
}catch{events.push({result:'TUS_UI_NOT_READY'});}finally{await browser?.close();await api.dispose();}
await writeFile('docs/evidence/p0-1/tus.json',`${JSON.stringify({checkedAt:new Date().toISOString(),status,bytes:7500084,events},null,2)}\n`);process.stdout.write(`${JSON.stringify({status,events})}\n`);if(status==='FAIL')process.exitCode=1;
