import {readFile,writeFile} from 'node:fs/promises';
import {request} from '@playwright/test';
import assert from 'node:assert/strict';
const fixture=JSON.parse(await readFile('tmp/p0-1/business-fixtures.json','utf8'));
const c=await request.newContext({baseURL:'http://127.0.0.1:3000'}),results=[];
let status='FAIL',full;
try{
 const csrf=await(await c.get('/api/csrf')).json();
 const boot=await c.post('/api/guest/session',{headers:{origin:'http://127.0.0.1:3000','x-csrf-token':csrf.data.token},data:{token:fixture.shareUrl.split('/').pop()}});
 if(!boot.ok())throw new Error('FIXTURE_UNAVAILABLE');
 for(const range of [null,'bytes=0-15','bytes=0-1,3-4','bytes=999999999-']){
  const r=await c.get(`/api/guest/projects/${fixture.projectA}/files/${fixture.ownerFile}/download`,{headers:range?{Range:range}:{}});
  const bytes=await r.body();
  let errorCode=null;try{errorCode=JSON.parse(bytes.toString('utf8')).error?.code??null;}catch{}
  results.push({range,status:r.status(),bytes:bytes.length,contentRange:r.headers()['content-range']??null,canonicalWebpName:(r.headers()['content-disposition']??'').includes('plate.webp'),errorCode});
  process.stdout.write(`${JSON.stringify(results.at(-1))}\n`);
  assert.equal(r.status(),range===null?200:range==='bytes=0-15'?206:416);
  if(range===null){full=bytes;assert.ok(results.at(-1).canonicalWebpName);}
  if(range==='bytes=0-15')assert.deepEqual(bytes,full.subarray(0,16));
  if(r.status()===416)assert.match(r.headers()['content-range']??'',/^bytes \*\/\d+$/);
 }
 status='PASS';
}catch{results.push({status:'FAIL',code:'RANGE_CHECK_INCOMPLETE'});}finally{await c.dispose();}
await writeFile('docs/evidence/p0-1/range-diagnostic.json',`${JSON.stringify({checkedAt:new Date().toISOString(),status,results},null,2)}\n`);
process.stdout.write(`${JSON.stringify({status,results})}\n`);if(status==='FAIL')process.exitCode=1;
