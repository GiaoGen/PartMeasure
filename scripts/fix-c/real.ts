// Explicitly approved two real files only; same FIX-C project and normal sessions.
import assert from "node:assert/strict";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { emptyMetadata, validateAnnotation, type AnnotationDocument, type Geometry } from "../../src/lib/annotations";
import { AppError } from "../../src/lib/policy";
import { connectionFailure, signedUploadTarget } from "../maintenance/connection-model";
import { hash, once, projectScope, root, target, validRun, type Journal } from "./model";
type State = Journal & { run: string; source: string; completed: string[]; cookies: Record<string, Record<string,string>> };
async function main() {
	const run = process.argv[2]; assert.ok(validRun(run));
	const dir = `tmp/fix-c/${run}`, state: State = JSON.parse(await readFile(`${dir}/state.json`, "utf8"));
	assert.equal(state.run, run); assert.ok(state.completed.includes("seed")); assert.ok(!state.completed.includes("revoke"));
	assert.ok(!Object.values(state.operations).some(x => x.status === "pending"));
	nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} }); target(process.env);
	const id = projectScope(state), O = `/api/projects/${id}`, G = `/api/guest/projects/${id}`;
	const save = async () => { await writeFile(`${dir}/state.next.json`, JSON.stringify(state), { mode: 0o600 }); await rename(`${dir}/state.next.json`, `${dir}/state.json`); };
	const specs = [
		{ key: "photo", path: "D:/Download/images.jpg", filename: "images.jpg", bytes: 13672, sha256: "02108cf9ba0557f0e60b3108bec1898437fe30ce20dc51f769f0a0253469bd21", mime: "image/jpeg", role: "G1", base: G },
		{ key: "cad", path: "D:/document/prarice1.SLDPRT", filename: "prarice1.SLDPRT", bytes: 311748, sha256: "437a805b57356d30f85a8c402e07bf0140f85dd128dd1c5b7edc2f5eafa42b2b", mime: "application/octet-stream", role: "A", base: O },
	];
	// Verify the user's exact approved bytes before sending any request.
	const contents = await Promise.all(specs.map(async spec => { const bytes = await readFile(spec.path); assert.equal(bytes.length, spec.bytes); assert.equal(hash(bytes), spec.sha256); return bytes; }));
	function client(role: string) {
		const storedJar = state.cookies[role]; assert.ok(storedJar); const jar: Record<string,string> = storedJar; let csrf = "";
		async function raw(path: string, init: RequestInit = {}) {
			assert.ok(path.startsWith("/api/"));
			const r = await fetch(root + path, { ...init, redirect: "error", signal: AbortSignal.timeout(75000), headers: { cookie: Object.entries(jar).map(([k,v]) => `${k}=${v}`).join("; "), ...init.headers } });
			for (const c of r.headers.getSetCookie()) { const pair = c.split(";")[0] ?? "", at = pair.indexOf("="); if(at>0) jar[pair.slice(0,at)] = pair.slice(at+1); }
			await save(); return r;
		}
		async function json<T>(path: string, body?: unknown, key?: string): Promise<T> {
			if(body !== undefined && !csrf) csrf = (await json<{token:string}>("/api/csrf")).token;
			const r = await raw(path, body === undefined ? {} : { method: "POST", headers: { origin: root, "Content-Type": "application/json", "x-csrf-token": csrf, "Idempotency-Key": key ?? randomUUID() }, body: JSON.stringify(body) });
			const j = await r.json(); if(!r.ok) throw new AppError("API_REQUEST_FAILED",r.status); return j.data as T;
		}
		return { raw, json };
	}
	const A = client("A"), G1 = client("G1"); const results: object[] = [];
	let stage = "setup";
	const path = `docs/evidence/fix-c/${run}-real-files-${Date.now()}.json`;
	async function report() { await writeFile(path, `${JSON.stringify({ checkedAt: new Date().toISOString(), run, apiSourceDigest: state.source, driverSha256: hash(await readFile("scripts/fix-c/real.ts")), scope: "User-approved real low-resolution photo and native CAD, same isolated FIX-C project; ordinary sessions; no inferred dimensions", results }, null, 2)}\n`); }
	try {
		for (const [index, spec] of specs.entries()) {
			stage = `real_${spec.key}_upload_and_original_hash`; const started = performance.now(); const c = spec.role === "A" ? A : G1, content = contents[index]; assert.ok(content);
			const write = <T>(name: string, path: string, body: unknown) => once(state, `real-${name}`, { path, body }, randomUUID, save, key => c.json<T>(path, body, key));
			const reservation = await write<{id:string}>(`reserve-${spec.key}`, `${spec.base}/uploads`, { filename: spec.filename, byteSize: spec.bytes, sha256: spec.sha256, declaredMime: spec.mime, purpose: "material" });
			const grant = await write<{signedUrl:string}>(`grant-${spec.key}`, `${spec.base}/uploads/${reservation.id}/grant`, {});
			const url = signedUploadTarget(grant.signedUrl); assert.equal(decodeURIComponent(url.pathname), `/storage/v1/object/upload/sign/partmeasure-quarantine/${id}/${reservation.id}/source`);
			await once(state, `real-put-${spec.key}`, { id: reservation.id, sha256: spec.sha256 }, randomUUID, save, async () => {
				const r = await fetch(url, { method: "PUT", redirect: "error", headers: { "Content-Type": spec.mime }, body: content, signal: AbortSignal.timeout(60000) }); await r.body?.cancel(); if(!r.ok) throw new AppError("PRIVATE_UPLOAD_FAILED",r.status); return { uploaded: true };
			});
			const complete = await write<{state:string}>(`complete-${spec.key}`, `${spec.base}/uploads/${reservation.id}/complete`, {}); assert.equal(complete.state,"ready");
			await once(state, `real-hash-${spec.key}`, { id: reservation.id, sha256: spec.sha256 }, randomUUID, save, async () => {
				const r = await A.raw(`${O}/files/${reservation.id}/download${spec.key === "photo" ? "?original=1" : ""}`); assert.equal(r.status,200);
				const chunks: Uint8Array[] = []; let size = 0;
				for await(const chunk of r.body ?? []) { size += chunk.length; assert.ok(size <= spec.bytes); chunks.push(chunk); }
				const bytes = Buffer.concat(chunks); assert.equal(size,spec.bytes); assert.equal(hash(bytes),spec.sha256);
				await mkdir(`output/fix-c/${run}`,{recursive:true}); await writeFile(`output/fix-c/${run}/downloaded-${spec.key}${spec.key === "photo" ? ".jpg" : ".SLDPRT"}`,bytes);
				return { bytes: size, sha256: spec.sha256 };
			});
			results.push({ name: stage, status: "PASS", bytes: spec.bytes, sha256: spec.sha256, milliseconds: Math.round(performance.now()-started) }); await report(); console.log(JSON.stringify(results.at(-1)));
		}
		const photo = state.operations["real-reserve-photo"]?.value as {id:string};
		const doc = await A.json<AnnotationDocument>(`${O}/files/${photo.id}/annotations`);
		const radius = Math.min(doc.image.width, doc.image.height)*.065;
		const geometries: Geometry[] = [
			{type:"line",from:{x:.12,y:.15},to:{x:.42,y:.15}}, {type:"circle",center:{x:.65,y:.2},radiusX:radius/doc.image.width,radiusY:radius/doc.image.height},
			{type:"angle",from:{x:.12,y:.4},vertex:{x:.3,y:.4},to:{x:.3,y:.25},reflex:false}, {type:"arc",from:{x:.45,y:.5},via:{x:.55,y:.4},to:{x:.65,y:.5}},
			{type:"ellipse",center:{x:.7,y:.65},axisA:{x:.85,y:.65},axisB:{x:.7,y:.7}}, {type:"point",at:{x:.2,y:.7}}, {type:"text",at:{x:.2,y:.85},text:"FIX-C测试 · 非工程尺寸"},
		];
		stage="real_photo_seven_explicit_test_annotations";
		for(const geometry of geometries) {
			const metadata={...emptyMetadata(),name:`FIX-C测试 ${geometry.type}`,notes:"仅用于导出排版/中文/来源验证，不代表实际测量或尺寸。".repeat(20)};
			validateAnnotation(geometry,metadata,doc.image.width,doc.image.height);
			await once(state,`real-annotation-${geometry.type}`,{fileId:photo.id,imageHash:doc.image.imageHash,geometry,metadata},randomUUID,save,key=>A.json(`${O}/annotations`,{id:key,fileId:photo.id,imageHash:doc.image.imageHash,geometry,metadata},key));
		}
		results.push({name:stage,status:"PASS",realDimensionsFilled:false}); await report();
	} catch(error) { results.push({name:stage,status:"NOT_PASSED",...connectionFailure(error)}); await report(); process.exitCode=1; }
	console.log(JSON.stringify({report:path,status:process.exitCode?"NOT_PASSED":"PASS"}));
}
main().catch(e=>{console.error(JSON.stringify(connectionFailure(e)));process.exitCode=1;});
