// Reuse the existing real browser Guest session; no bootstrap, login or business writes.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const run=process.argv[2];assert.match(run??"",/^[a-f0-9-]{36}$/);
const dir=`tmp/fix-c/${run}`,state=JSON.parse(await readFile(`${dir}/state.json`,"utf8"));
assert.equal(state.operations.project.value.name,`FIX-C-${run}`);
assert.equal(await readFile(`${dir}/browser/guest-created`,"utf8"),"done");
const id=state.operations.project.value.id,photo=state.operations["real-reserve-photo"].value.id,root="http://127.0.0.1:3000";
const context=await chromium.launchPersistentContext(`${dir}/browser/profile-guest`,{channel:"chrome",headless:true,viewport:{width:1440,height:1000}});
const results=[];
try{
	for(const [name,path]of [["guest-project",`/api/guest/projects/${id}`],["guest-photo-metadata",`/api/guest/projects/${id}/files/${photo}`]]){
		const r=await context.request.get(root+path);results.push({name,status:r.status(),timing:r.headers()["server-timing"]??null});
	}
	const page=context.pages()[0]??await context.newPage();
	await page.goto(`${root}/s/session?project=${id}&section=files&file=${photo}`,{waitUntil:"domcontentloaded",timeout:60000});
	await page.waitForFunction(()=>document.querySelector(".detail-heading h2")||Array.from(document.querySelectorAll("h1,h2")).some(x=>/链接已不可用/.test(x.textContent)),{},{timeout:60000}).catch(()=>{});
	await page.screenshot({path:`${dir}/browser/guest-read.png`,fullPage:false});
	results.push(await page.evaluate(()=>({name:"guest-page-structure",unavailable:Array.from(document.querySelectorAll("h1,h2")).some(x=>/链接已不可用/.test(x.textContent)),detailHeading:!!document.querySelector(".detail-heading h2"),correctPhoto:document.querySelector(".detail-heading h2")?.textContent==="images.jpg",canvas:document.querySelectorAll(".annotation-viewport canvas").length,status:Array.from(document.querySelectorAll('[role="alert"]')).map(x=>/服务暂时不可用|读取.*失败|网络|连接/.test(x.textContent)?"DEPENDENCY_OR_READ_FAILURE":"OTHER_ALERT")})));
}finally{
	const report={checkedAt:new Date().toISOString(),run,scope:"Existing real Guest read-only diagnostic; no session creation or business writes",results};
	await writeFile(`docs/evidence/fix-c/${run}-guest-read-${Date.now()}.json`,`${JSON.stringify(report,null,2)}\n`);console.log(JSON.stringify(report));await context.close();
}
