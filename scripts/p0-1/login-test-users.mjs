// Reauthenticate existing fixtures through the application. No Admin API or email.
import { readFile } from 'node:fs/promises';
import { request } from '@playwright/test';
const accounts=JSON.parse(await readFile('tmp/p0-1/test-accounts.json','utf8'));
let failed=false;
for(const [actor,account] of Object.entries(accounts)){
 const c=await request.newContext({baseURL:'http://127.0.0.1:3000'});
 try{
  const csrf=await(await c.get('/api/csrf')).json();
  const r=await c.post('/api/auth/login',{headers:{origin:'http://127.0.0.1:3000','x-csrf-token':csrf.data.token},data:{email:account.email,password:account.password}});
  if(r.ok())await c.storageState({path:`tmp/p0-1/owner-${actor}.json`});
  else failed=true;
  process.stdout.write(`${actor}: password-login ${r.status()}\n`);
 }finally{await c.dispose();}
}
if(failed)process.exitCode=1;
