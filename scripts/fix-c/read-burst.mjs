// One bounded two-role page-load-shaped burst. Eight GETs, no business mutations or automatic retries.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const run=process.argv[2];assert.match(run??"",/^[a-f0-9-]{36}$/);
const state=JSON.parse(await readFile(`tmp/fix-c/${run}/state.json`,"utf8"));
assert.equal(state.operations.project.value.name,`FIX-C-${run}`);
const id=state.operations.project.value.id,file=state.operations["real-reserve-photo"].value.id;
const requests=[];
for(const role of ["A","G1"]){
	const base=`/api/${role==="A"?"":"guest/"}projects/${id}`,cookie=Object.entries(state.cookies[role]).map(([k,v])=>`${k}=${v}`).join("; ");
	for(const[name,path]of[["project",base],["files",`${base}/files`],["issues",`${base}/issues`],["annotations",`${base}/files/${file}/annotations`]])requests.push({role,name,path,cookie});
}
const results=await Promise.all(requests.map(async q=>{
	const start=performance.now();
	try{const r=await fetch(`http://127.0.0.1:3000${q.path}`,{headers:{cookie:q.cookie},redirect:"error",signal:AbortSignal.timeout(60000)});const j=await r.json();
		return{role:q.role,name:q.name,status:r.status,timing:r.headers.get("server-timing"),errorCode:["DATABASE_BUSY","DATABASE_TIMEOUT","DEPENDENCY_UNAVAILABLE","DEPENDENCY_TIMEOUT","AUTH_REQUIRED","LINK_UNAVAILABLE"].includes(j.error?.code)?j.error.code:j.error?"OTHER_REDACTED":null,milliseconds:Math.round(performance.now()-start)};
	}catch{return{role:q.role,name:q.name,status:"TRANSPORT_FAILED",milliseconds:Math.round(performance.now()-start)};}
}));
const report={checkedAt:new Date().toISOString(),run,scope:"Exactly eight GETs representing initial current Owner/Guest page reads, normal real sessions, no retries/writes; local dev, not hosted load test",results};
const filePath=`docs/evidence/fix-c/${run}-read-burst-${Date.now()}.json`;await writeFile(filePath,`${JSON.stringify(report,null,2)}\n`);console.log(JSON.stringify(report));
