// One ordinary Owner download with bounded counters; never print capability URLs/cookies.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const run=process.argv[2],asset=process.argv[3]??"v1";assert.match(run??"",/^[a-f0-9-]{36}$/);assert.ok(["v1","image"].includes(asset));
const state=JSON.parse(await readFile(`tmp/fix-c/${run}/state.json`,"utf8"));
assert.equal(state.operations.project.value.name,`FIX-C-${run}`);
const cookie=Object.entries(state.cookies.A).map(([k,v])=>`${k}=${v}`).join("; ");
const expected=state.assets.find(a=>a.key===asset);
const digest=createHash("sha256"),start=performance.now();
const result={checkedAt:new Date().toISOString(),run,asset,scope:"One normal Owner download of this batch's ready synthetic original",status:"NOT_PASSED",httpStatus:null,headersMs:null,totalMs:null,bytes:0,expectedBytes:expected.bytes,timing:null,transportCode:null};
try{
	const response=await fetch(`http://127.0.0.1:3000/api/projects/${state.operations.project.value.id}/files/${state.operations[`reserve-${asset}`].value.id}/download${asset==="image"?"?original=1":""}`,{headers:{cookie},redirect:"error",signal:AbortSignal.timeout(75000)});
	result.httpStatus=response.status;result.headersMs=Math.round(performance.now()-start);result.timing=response.headers.get("server-timing");
	assert.equal(response.status,200);
	for await(const part of response.body){result.bytes+=part.length;assert.ok(result.bytes<=expected.bytes);digest.update(part);}
	assert.equal(result.bytes,expected.bytes);assert.equal(digest.digest("hex"),expected.sha256);result.status="PASS";
}catch(e){result.transportCode=["UND_ERR_SOCKET","ETIMEDOUT","ECONNRESET"].includes(e.cause?.code)?e.cause.code:"HTTP_OR_STREAM_FAILURE";process.exitCode=1;}
result.totalMs=Math.round(performance.now()-start);
await writeFile(`docs/evidence/fix-c/${run}-pdf-download-${Date.now()}.json`,`${JSON.stringify(result,null,2)}\n`);console.log(JSON.stringify(result));
