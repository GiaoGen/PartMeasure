// One bounded retry of this batch's known queued PDF, after ordinary-role status reconciliation.
import assert from "node:assert/strict";
import { readFile, writeFile, copyFile, rename } from "node:fs/promises";
const run = process.argv[2]; assert.match(run ?? "", /^[a-f0-9-]{36}$/);
const dir = `tmp/fix-c/${run}`, state = JSON.parse(await readFile(`${dir}/state.json`, "utf8"));
assert.equal(state.run, run); assert.equal(state.operations.project?.value?.name, `FIX-C-${run}`);
const op = state.operations["complete-v1"], file = state.operations["reserve-v1"]?.value;
assert.equal(op?.status, "pending"); assert.ok(file?.id);
const jar = state.cookies.A, root = "http://127.0.0.1:3000";
async function request(path, init = {}) {
	const response = await fetch(root + path, { ...init, redirect: "error", signal: AbortSignal.timeout(75000), headers: { cookie: Object.entries(jar).map(([k,v]) => `${k}=${v}`).join("; "), ...init.headers } });
	for (const c of response.headers.getSetCookie()) { const pair=c.split(";")[0], at=pair.indexOf("="); if(at>0) jar[pair.slice(0,at)]=pair.slice(at+1); }
	return response;
}
const base = `/api/projects/${state.operations.project.value.id}/uploads/${file.id}`;
const before = await request(base), current = (await before.json()).data;
assert.equal(before.status,200); assert.equal(current?.state,"queued"); assert.equal(current?.errorCode,"PROCESSING_INTERRUPTED");
const stamp=Date.now();
await copyFile(`docs/evidence/fix-c/${run}-seed.json`, `docs/evidence/fix-c/${run}-seed-first-failure.json`, 1);
await writeFile(`${dir}/retry-v1-marker`, String(stamp), { flag:"wx" });
const csrfResponse=await request("/api/csrf"), csrf=(await csrfResponse.json()).data.token;
const started=performance.now();
const response=await request(`${base}/retry`,{method:"POST",headers:{origin:root,"Content-Type":"application/json","x-csrf-token":csrf,"Idempotency-Key":op.key},body:"{}"});
const value=await response.json();
const known=["PROCESSING_INTERRUPTED","STORAGE_UNAVAILABLE","PROCESSING_EXPIRED","UPLOAD_OBJECT_NOT_FOUND","DATABASE_TIMEOUT","DATABASE_BUSY","DEPENDENCY_UNAVAILABLE"];
const report={checkedAt:new Date().toISOString(),run,scope:"Exactly one queued PDF retry after read-only status reconciliation; original signed upload is not repeated",beforeState:current.state,httpStatus:response.status,errorCode:known.includes(value.error?.code)?value.error.code:value.error?.code?"OTHER_REDACTED":null,
	state:value.data?.state??null,milliseconds:Math.round(performance.now()-started),timing:response.headers.get("server-timing")};
await writeFile(`docs/evidence/fix-c/${run}-pdf-retry-${stamp}.json`,`${JSON.stringify(report,null,2)}\n`);
console.log(JSON.stringify(report));
assert.equal(response.status,200);assert.equal(value.data?.state,"ready");
op.value=value.data;op.status="done";
await writeFile(`${dir}/state.next.json`,JSON.stringify(state));await rename(`${dir}/state.next.json`,`${dir}/state.json`);
