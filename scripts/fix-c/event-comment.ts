// One synthetic update for the already-approved live-input preservation check.
import assert from "node:assert/strict";
import { readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { once, validRun, type Journal } from "./model";
const run=process.argv[2];assert.ok(validRun(run));
const dir=`tmp/fix-c/${run}`,state:Journal&{cookies:Record<string,Record<string,string>>;completed:string[]}=JSON.parse(await readFile(`${dir}/state.json`,"utf8"));
assert.ok(state.completed.includes("workflow"));assert.ok(!state.completed.includes("revoke"));
const project=state.operations.project?.value as {id:string;name:string},version=state.operations["publish-v1"]?.value as {id:string};assert.equal(project.name,`FIX-C-${run}`);
const jar=state.cookies.G2;assert.ok(jar);
const save=async()=>{await writeFile(`${dir}/state.next.json`,JSON.stringify(state));await rename(`${dir}/state.next.json`,`${dir}/state.json`);};
const headers={cookie:Object.entries(jar).map(([k,v])=>`${k}=${v}`).join("; ")};
const response=await fetch("http://127.0.0.1:3000/api/csrf",{headers,redirect:"error",signal:AbortSignal.timeout(45000)});const csrf=(await response.json()).data.token;
for(const c of response.headers.getSetCookie()){const pair=c.split(";")[0]??"",at=pair.indexOf("=");if(at>0)jar[pair.slice(0,at)]=pair.slice(at+1);}
headers.cookie=Object.entries(jar).map(([k,v])=>`${k}=${v}`).join("; ");
const path=`/api/guest/projects/${project.id}/deliveries/${version.id}/feedback`,body={kind:"comment",body:"FIX-C 事件刷新验证（合成）",guestLabel:"FIX-C Guest2"};
const already=state.operations["browser-event-comment"]?.status==="done";
await once(state,"browser-event-comment",{path,body},randomUUID,save,async key=>{
	const r=await fetch(`http://127.0.0.1:3000${path}`,{method:"POST",headers:{...headers,origin:"http://127.0.0.1:3000","Content-Type":"application/json","x-csrf-token":csrf,"Idempotency-Key":key},body:JSON.stringify(body),redirect:"error",signal:AbortSignal.timeout(60000)});
	assert.equal(r.status,201);return(await r.json()).data;
});
console.log(JSON.stringify({eventComment:already?"REUSED_NO_NEW_EVENT":"CREATED"}));
if(already)process.exitCode=2;
