// No signup/resend here. Verify only the single user-confirmed new test account.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const run=process.argv[2];assert.match(run??"",/^[a-f0-9-]{36}$/);
const dir=`tmp/fix-c/${run}`,account=JSON.parse(await readFile(`${dir}/otp-account.json`,"utf8"));
const jar=new Map(),root="http://127.0.0.1:3000",results=[];
let csrf="";
async function call(path,body){
	if(body&&!csrf)csrf=(await call("/api/csrf")).data.token;
	const r=await fetch(root+path,{method:body?"POST":"GET",headers:{cookie:[...jar].map(([k,v])=>`${k}=${v}`).join("; "),...(body?{origin:root,"Content-Type":"application/json","x-csrf-token":csrf,"Idempotency-Key":randomUUID()}: {})},...(body?{body:JSON.stringify(body)}:{}),redirect:"error",signal:AbortSignal.timeout(45000)});
	for(const c of r.headers.getSetCookie()){const pair=c.split(";")[0],at=pair.indexOf("=");jar.set(pair.slice(0,at),pair.slice(at+1));}
	return{status:r.status,...await r.json()};
}
let stage="normal_new_account_password_login";
try{
	assert.equal((await call("/api/auth/login",{email:account.email,password:account.password})).status,200);results.push({name:stage,status:"PASS"});
	stage="new_confirmed_session_and_empty_normal_project_list";
	assert.equal((await call("/api/auth/session")).data.authenticated,true);
	const projects=await call("/api/projects");assert.equal(projects.status,200);assert.equal(projects.data.items.length,0);results.push({name:stage,status:"PASS"});
	stage="wrong_numeric_signup_code_rejected_without_sending_mail";
	const invalid=await call("/api/auth/verify",{email:account.email,token:"0000000000"});assert.equal(invalid.status,422);assert.equal(invalid.error?.code,"OTP_INVALID_OR_EXPIRED");results.push({name:stage,status:"PASS",httpStatus:invalid.status});
}catch(e){results.push({name:stage,status:"NOT_PASSED",errorClass:e.name});process.exitCode=1;}
const report={checkedAt:new Date().toISOString(),run,scope:"Normal password Auth/API for the single freshly registered mailbox; user independently confirmed email delivery and entered the correct code in the actual local app; no signup/resend/admin/config changes",actualTimeExpiryTested:false,results};
await writeFile(`docs/evidence/fix-c/${run}-otp-check.json`,`${JSON.stringify(report,null,2)}\n`);console.log(JSON.stringify(report));
