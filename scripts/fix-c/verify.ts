// FIX-C only. Offline preparation by default; no admin, mail, browser, cleanup or deployment.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import nextEnv from "@next/env";
import sharp from "sharp";
import { emptyMetadata, validateAnnotation, type Annotation, type AnnotationDocument, type Geometry } from "../../src/lib/annotations";
import type { Delivery } from "../../src/lib/deliveries";
import type { FeedbackPage } from "../../src/lib/delivery-feedback";
import type { IssueDetail, IssueSummary } from "../../src/lib/issues";
import { AppError } from "../../src/lib/policy";
import { connectionFailure, signedUploadTarget } from "../maintenance/connection-model";
import { privateDirectory, restrictDirectory } from "../maintenance/private-directory";
import { boundedAssets, hash, once, options, projectScope, publicProgress, root, target, type Asset, type Journal, type Phase } from "./model";

type Role = "A" | "B" | "G1" | "G2";
type State = Journal & {
	run: string; source: string; assets: Asset[];
	cookies: Partial<Record<Role, Record<string, string>>>;
	completed: Phase[];
	sourceReviews?: { at: string; previous: string; current: string }[];
};
type Result = { name: string; status: "PASS" | "NOT_PASSED"; milliseconds: number; code?: string };
const stepBytes = (name: string) => Buffer.from(`ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('FIX-C synthetic ${name}'),'2;1');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n`);
function sampleGeometries(width: number, height: number): Geometry[] {
	const radius = Math.min(width, height) * 0.07;
	return [
		{ type: "line", from: { x: .12, y: .15 }, to: { x: .42, y: .15 } },
		{ type: "circle", center: { x: .65, y: .2 }, radiusX: radius / width, radiusY: radius / height },
		{ type: "angle", from: { x: .12, y: .4 }, vertex: { x: .3, y: .4 }, to: { x: .3, y: .25 }, reflex: false },
		{ type: "arc", from: { x: .45, y: .5 }, via: { x: .55, y: .4 }, to: { x: .65, y: .5 } },
		{ type: "ellipse", center: { x: .7, y: .65 }, axisA: { x: .85, y: .65 }, axisB: { x: .7, y: .7 } },
		{ type: "point", at: { x: .2, y: .7 } },
		{ type: "text", at: { x: .2, y: .85 }, text: "合成中文说明 · 固定历史" },
	];
}
async function assets() {
	const values = [
		{ key: "image", filename: "FIX-C-合成照片.png", mime: "image/png", purpose: "material" as const, content: await readFile("tmp/p0-4/manual-sample.png") },
		{ key: "v1", filename: "FIX-C-合成报告.pdf", mime: "application/pdf", purpose: "delivery" as const, content: await readFile("output/pdf/p2-04b-synthetic-report.pdf") },
		{ key: "v2", filename: "FIX-C-合成空结构.step", mime: "application/octet-stream", purpose: "delivery" as const, content: stepBytes("published") },
		{ key: "private", filename: "FIX-C-私有草稿.step", mime: "application/octet-stream", purpose: "delivery" as const, content: stepBytes("private-draft") },
	];
	const manifest = values.map(({ content, ...a }) => ({ ...a, bytes: content.length, sha256: hash(content) }));
	boundedAssets(manifest);
	const image = await sharp(values[0]?.content).metadata();
	assert.ok(image.width && image.height);
	for (const geometry of sampleGeometries(image.width, image.height)) validateAnnotation(geometry, emptyMetadata(), image.width, image.height);
	return { manifest, values };
}
async function source() {
	const paths = ["package-lock.json", "next.config.ts", "tsconfig.json", "scripts/fix-c/model.ts", "scripts/fix-c/verify.ts", "scripts/maintenance/connection-model.ts", "scripts/maintenance/private-directory.ts"];
	async function walk(dir: string) {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const path = `${dir}/${entry.name}`;
			if (entry.isDirectory()) await walk(path); else if (entry.isFile()) paths.push(path);
		}
	}
	for (const dir of ["src", "supabase/migrations"]) await walk(dir);
	const manifest = [];
	for (const path of paths.sort()) manifest.push({ path, sha256: hash(await readFile(path)) });
	return hash(JSON.stringify(manifest));
}
const hasOwn = (journal: Journal, key: string) => journal.operations[key]?.status === "done";
function resultOf<T>(state: State, key: string): T {
	if (!hasOwn(state, key)) throw new AppError("FIX_C_PREREQUISITE_MISSING");
	return state.operations[key]?.value as T;
}

async function main() {
	const args = options(process.argv.slice(2));
	const digest = await source();
	if (args.mode === "prepare") {
		const batch = await assets(), run = randomUUID();
		await mkdir("tmp/fix-c", { recursive: true });
		const dir = `tmp/fix-c/${run}`;
		await privateDirectory(dir);
		const state: State = { run, source: digest, assets: batch.manifest, cookies: {}, operations: {}, completed: [] };
		await writeFile(`${dir}/state.json`, JSON.stringify(state), { flag: "wx", mode: 0o600 });
		await mkdir("docs/evidence/fix-c", { recursive: true });
		const plan = { run, preparedAt: new Date().toISOString(), sourceDigest: digest, offlineOnly: true, assets: batch.manifest, totalBytes: batch.manifest.reduce((n, a) => n + a.bytes, 0),
			phases: ["seed: one new project/share/two real Guest sessions/four uploads/seven annotations/two published versions/private draft", "workflow: three response kinds/remeasure/fixed snapshot/version receipts/ordinary-role denials", "revoke: archive/read-only/revoke this share/restore/old sessions stay denied"],
			excluded: "No OTP/mail/admin/old fixture writes/delete/cleanup/browser/device/deploy/network changes. Browser and actual exports require separate explicit authorization; pause before revoke." };
		await writeFile(`docs/evidence/fix-c/plan-${run}.json`, `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" });
		console.log(JSON.stringify(plan));
		return;
	}
	const dir = `tmp/fix-c/${args.run}`;
	await restrictDirectory(dir);
	const state: State = JSON.parse(await readFile(`${dir}/state.json`, "utf8"));
	assert.equal(state.run, args.run);
	if (args.mode === "inspect") {
		console.log(JSON.stringify({ run: state.run, sourceDigest: state.source, currentSourceDigest: digest, completed: state.completed, progress: publicProgress(state) }));
		return;
	}
	if (args.mode === "review-source") {
		// Explicit local review after a focused fix. Never resolves an ambiguous write or sends API requests.
		if (Object.values(state.operations).some(op => op.status === "pending")) throw new AppError("FIX_C_PENDING_REQUIRES_RECONCILIATION");
		projectScope(state);
		const review = { at: new Date().toISOString(), previous: state.source, current: digest };
		state.sourceReviews ??= []; state.sourceReviews.push(review); state.source = digest;
		await writeFile(`${dir}/state.next.json`, JSON.stringify(state), { mode: 0o600 }); await rename(`${dir}/state.next.json`, `${dir}/state.json`);
		await writeFile(`docs/evidence/fix-c/${state.run}-source-review-${Date.now()}.json`, `${JSON.stringify({ run: state.run, offlineOnly: true, ...review, scope: "Explicit source review; no API request, pending reconciliation or business result implied" }, null, 2)}\n`);
		console.log(JSON.stringify({ offlineOnly: true, ...review }));
		return;
	}
	assert.equal(digest, state.source, "FIX_C_SOURCE_CHANGED_PREPARE_OR_REVIEW_AFFECTED_CHECKS");
	if (Object.values(state.operations).some(op => op.status === "pending")) throw new AppError("FIX_C_PENDING_REQUIRES_RECONCILIATION");
	if (state.completed.includes(args.phase)) throw new AppError("FIX_C_PHASE_ALREADY_COMPLETED");
	if (args.phase !== "seed" && !state.completed.includes("seed")) throw new AppError("FIX_C_SEED_REQUIRED");
	if (args.phase === "revoke" && !state.completed.includes("workflow")) throw new AppError("FIX_C_WORKFLOW_REQUIRED");
	const batch = await assets();
	assert.deepEqual(batch.manifest, state.assets, "FIX_C_ASSET_CHANGED");
	nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
	target(process.env);
	const save = async () => {
		await writeFile(`${dir}/state.next.json`, JSON.stringify(state), { mode: 0o600 });
		await rename(`${dir}/state.next.json`, `${dir}/state.json`);
	};
	// Private cookie jars survive process boundaries; raw capability values never enter public evidence.
	const results: Result[] = [];
	let stage = "setup";
	const reportPath = `docs/evidence/fix-c/${state.run}-${args.phase}.json`;
	async function report() {
		await writeFile(reportPath, `${JSON.stringify({ run: state.run, checkedAt: new Date().toISOString(), sourceDigest: digest, phase: args.mode === "apply" ? args.phase : null,
			scope: "Current loopback app + normal Auth/Guest sessions + isolated restricted database/private Storage; synthetic API flow only. Not browser/real engineering/phone/mainland/hosted acceptance.",
			networkChanged: false, proxyTunAbsenceCertified: false, results, progress: publicProgress(state) }, null, 2)}\n`);
	}
	async function check<T>(name: string, work: () => Promise<T>) {
		stage = name; const start = performance.now();
		try {
			const value = await work();
			results.push({ name, status: "PASS", milliseconds: Math.round(performance.now() - start) });
			await report(); console.log(JSON.stringify(results.at(-1))); return value;
		} catch (error) {
			results.push({ name, status: "NOT_PASSED", milliseconds: Math.round(performance.now() - start), ...connectionFailure(error) });
			await report(); throw error;
		}
	}
	function client(role: Role) {
		state.cookies[role] ??= {};
		const jar = state.cookies[role];
		let csrf = "";
		async function raw(path: string, init: RequestInit = {}) {
			if (!path.startsWith("/api/")) throw new AppError("FIX_C_API_PATH_ONLY");
			const response = await fetch(root + path, { ...init, redirect: "error", signal: init.signal ?? AbortSignal.timeout(60000), headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "), ...init.headers } });
			for (const c of response.headers.getSetCookie()) {
				const pair = c.split(";")[0] ?? "", at = pair.indexOf("=");
				if (at > 0) jar[pair.slice(0, at)] = pair.slice(at + 1);
			}
			await save(); return response;
		}
		async function request(path: string, method = "GET", body?: unknown, key: string = randomUUID(), revision?: number, expectedStatus?: number) {
			if (method !== "GET" && !csrf) csrf = (await json<{ token: string }>("/api/csrf")).token;
			const response = await raw(path, { method, headers: method === "GET" ? {} : { origin: root, "Content-Type": "application/json", "x-csrf-token": csrf, "Idempotency-Key": key, ...(revision === undefined ? {} : { "X-PM-Revision": `"${revision}"` }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
			const value = await response.json();
			if (expectedStatus !== undefined) {
				if (response.status !== expectedStatus) throw new AppError("FIX_C_UNEXPECTED_STATUS", response.status);
			} else if (!response.ok) throw new AppError("API_REQUEST_FAILED", response.status);
			return value;
		}
		async function json<T>(path: string, method = "GET", body?: unknown, key?: string, revision?: number): Promise<T> {
			return (await request(path, method, body, key, revision)).data as T;
		}
		return { raw, json, request };
	}
	const A = client("A"), B = client("B"), G = client("G1"), G2 = client("G2");
	const write = <T>(name: string, c: ReturnType<typeof client>, path: string, body: unknown, method = "POST", revision?: number, expectedStatus?: number) =>
		once(state, name, { path, method, body, revision, expectedStatus }, randomUUID, save, async key => {
			const value = await c.request(path, method, body, key, revision, expectedStatus);
			return (expectedStatus === undefined ? value.data : { status: expectedStatus, code: value.error?.code }) as T;
		});
	async function download(c: ReturnType<typeof client>, path: string, expected: Asset) {
		const response = await c.raw(path);
		assert.equal(response.status, 200); assert.ok(response.headers.get("cache-control")?.includes("no-store"));
		const digest = (await import("node:crypto")).createHash("sha256"); let bytes = 0;
		for await (const part of response.body ?? []) {
			bytes += part.length; if (bytes > expected.bytes) throw new AppError("FIX_C_DOWNLOAD_LIMIT"); digest.update(part);
		}
		assert.equal(bytes, expected.bytes); assert.equal(digest.digest("hex"), expected.sha256);
	}
	async function deny(c: ReturnType<typeof client>, path: string, status: number) {
		const response = await c.raw(path); await response.body?.cancel(); assert.equal(response.status, status);
	}
	try {
		const accounts = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8"));
		for (const [role, c] of [["A", A], ["B", B]] as const) await check(`normal_owner_${role}_login`, async () => {
			await c.json("/api/auth/login", "POST", accounts[role]);
			assert.equal((await c.json<{ authenticated: boolean }>("/api/auth/session")).authenticated, true);
		});
		if (args.phase === "seed") {
			await check("create_only_one_new_FIX_C_project", () => write("project", A, "/api/projects", { name: `FIX-C-${state.run}`, description: "合成收口验证；不是客户工程资料；不自动删除" }));
		}
		const id = projectScope(state), O = `/api/projects/${id}`, GP = `/api/guest/projects/${id}`;
		if (args.phase === "seed") {
			const link = await check("one_new_share", () => write<{ id: string; url: string }>("share", A, `${O}/share-links`, {}));
			const url = new URL(link.url); assert.equal(url.origin, root); assert.match(url.pathname, /^\/s\/[A-Za-z0-9_-]+$/);
			for (const [name, c] of [["G1", G], ["G2", G2]] as const) await check(`${name}_normal_guest_bootstrap`, () => write(`session-${name}`, c, "/api/guest/session", { token: url.pathname.split("/").at(-1) }));
			for (const asset of batch.values) await check(`upload_${asset.key}_ready_and_original_hash`, async () => {
				const c = asset.key === "image" ? G : A, base = asset.key === "image" ? GP : O;
				const reserved = await write<{ id: string }>(`reserve-${asset.key}`, c, `${base}/uploads`, { filename: asset.filename, byteSize: asset.content.length, declaredMime: asset.mime, sha256: hash(asset.content), purpose: asset.purpose });
				const grant = await write<{ signedUrl: string }>(`grant-${asset.key}`, c, `${base}/uploads/${reserved.id}/grant`, {});
				const uploadURL = signedUploadTarget(grant.signedUrl);
				assert.equal(decodeURIComponent(uploadURL.pathname), `/storage/v1/object/upload/sign/partmeasure-quarantine/${id}/${reserved.id}/source`);
				await once(state, `put-${asset.key}`, { id: reserved.id, sha256: hash(asset.content) }, randomUUID, save, async () => {
					const response = await fetch(uploadURL, { method: "PUT", redirect: "error", headers: { "Content-Type": asset.mime }, body: asset.content, signal: AbortSignal.timeout(60000) });
					await response.body?.cancel(); if (!response.ok) throw new AppError("PRIVATE_UPLOAD_FAILED", response.status); return { uploaded: true };
				});
				const complete = await write<{ state: string; scanPerformed: boolean; validationPolicy: string }>(`complete-${asset.key}`, c, `${base}/uploads/${reserved.id}/complete`, {});
				assert.equal(complete.state, "ready"); assert.equal(complete.scanPerformed, false); assert.equal(complete.validationPolicy, "format-only-v2");
				const manifest = state.assets.find(a => a.key === asset.key); assert.ok(manifest);
				await download(A, `${O}/files/${reserved.id}/download${asset.key === "image" ? "?original=1" : ""}`, manifest);
			});
			const photo = resultOf<{ id: string }>(state, "reserve-image");
			const doc = await A.json<AnnotationDocument>(`${O}/files/${photo.id}/annotations`);
			const geometries = sampleGeometries(doc.image.width, doc.image.height);
			for (const geometry of geometries) await check(`save_${geometry.type}_annotation`, async () => {
				const metadata = { ...emptyMetadata(), name: `合成${geometry.type}标注`, notes: "仅验证人工尺寸及固定历史。中文长备注：".repeat(20) };
				validateAnnotation(geometry, metadata, doc.image.width, doc.image.height);
				// Operation UUID doubles as stable client annotation ID before any write.
				await once(state, `annotation-${geometry.type}`, { fileId: photo.id, imageHash: doc.image.imageHash, geometry, metadata }, randomUUID, save,
					key => A.json(`${O}/annotations`, "POST", { id: key, fileId: photo.id, imageHash: doc.image.imageHash, geometry, metadata }, key));
			});
			for (const key of ["v1", "v2", "private"]) await check(`delivery_${key}`, async () => {
				const file = resultOf<{ id: string }>(state, `reserve-${key}`);
				const draft = await write<Delivery>(`draft-${key}`, A, `${O}/deliveries`, { description: `FIX-C ${key} 合成版本；保留不可覆盖历史`, fileIds: [file.id] });
				if (key !== "private") await write(`publish-${key}`, A, `${O}/deliveries/${draft.id}/publish`, {}, "POST", draft.revision);
			});
		}
		const photo = resultOf<{ id: string }>(state, "reserve-image"), v1 = resultOf<Delivery>(state, "publish-v1"), v2 = resultOf<Delivery>(state, "publish-v2"), draft = resultOf<Delivery>(state, "draft-private");
		if (args.phase === "seed") {
			await check("ordinary_roles_private_draft_original_revision_and_wrong_version_boundaries", async () => {
				const privateFile = resultOf<{ id: string }>(state, "reserve-private");
				const line = resultOf<Annotation>(state, "annotation-line");
				await deny(B, O, 404); await deny(B, `${O}/files/${photo.id}/download`, 404);
				await deny(G, `${GP}/deliveries/${draft.id}`, 404); await deny(G, `${GP}/files/${privateFile.id}`, 404);
				await deny(G, `${GP}/files/${privateFile.id}/download`, 404); await deny(G, `${GP}/files/${photo.id}/download?original=1`, 403);
				await deny(G, `${GP}/annotations/${line.id}/revisions`, 403);
				await deny(G, `${GP}/deliveries/${v1.id}/files/${resultOf<{ id: string }>(state, "reserve-v2").id}/download`, 404);
				const visible = await G.json<{ drafts: unknown[]; published: Delivery }>(`${GP}/deliveries`);
				assert.deepEqual(visible.drafts, []); assert.equal(visible.published.id, v2.id);
			});
			await check("old_version_attachment_hash_and_history_identity", async () => {
				const file = resultOf<{ id: string }>(state, "reserve-v1"), manifest = state.assets.find(a => a.key === "v1"); assert.ok(manifest);
				await download(G, `${GP}/deliveries/${v1.id}/files/${file.id}/download`, manifest);
				const history = await G.json<{ items: Delivery[]; nextCursor: string | null }>(`${GP}/deliveries?view=history&beforeVersion=${v2.versionNo}`);
				assert.deepEqual(history.items.map(x => x.id), [v1.id]); assert.equal(history.nextCursor, null);
			});
		}
		if (args.phase === "workflow") {
			await check("three_response_kinds_remeasure_and_immutable_old_target", async () => {
				const summaries = await once(state, "issue-selection", { project: id }, randomUUID, save, () => G.json<{ items: IssueSummary[] }>(`${GP}/issues`));
				for (const [type, kind] of [["line", "numeric"], ["circle", "photo"], ["angle", "unable"]] as const) {
					const ann = resultOf<Annotation>(state, `annotation-${type}`), head = summaries.items.find(i => i.annotationRef?.id === ann.id); assert.ok(head);
					const before = await once(state, `snapshot-${type}`, { issue: head.id }, randomUUID, save, () => G.json<IssueDetail>(`${GP}/issues/${head.id}`));
					const request = { kind, body: kind === "unable" ? "合成：工具无法到达" : "合成回复", guestLabel: "FIX-C Guest", evidenceFileIds: kind === "photo" ? [photo.id] : [], ...(kind === "numeric" ? { value: "12.3", unit: "mm" } : {}) };
					const first = await write<{ responseId: string; state: string; revision: number }>(`reply-${type}`, G, `${GP}/issues/${head.id}/responses`, request, "POST", 1);
					assert.equal(first.state, "submitted");
					if (kind === "unable") {
						const review = await write<{ revision: number }>("remeasure", A, `${O}/issues/${head.id}/review`, { decision: "remeasure", responseId: first.responseId, value: null, unit: null, source: null, note: "合成补测原因" }, "POST", first.revision);
						await write("resubmit", G, `${GP}/issues/${head.id}/responses`, { kind: "numeric", value: "45", unit: "deg", body: "", guestLabel: "FIX-C Guest", evidenceFileIds: [] }, "POST", review.revision);
					}
					if (type === "line") {
						const doc = await A.json<AnnotationDocument>(`${O}/files/${photo.id}/annotations`);
						await write("change-line-target", A, `${O}/annotations/${ann.id}`, { imageHash: doc.image.imageHash, geometry: { type: "line", from: { x: .12, y: .18 }, to: { x: .42, y: .18 } }, metadata: ann.metadata }, "PATCH", ann.revision);
					}
					const after = await G.json<IssueDetail>(`${GP}/issues/${head.id}`);
					assert.deepEqual(after.target, before.target);
					assert.equal(after.responses.length, kind === "unable" ? 2 : 1);
					if (kind === "photo") { assert.equal(after.responses[0]?.value, null); assert.equal(after.responses[0]?.attachments.length, 1); }
					if (kind === "unable") { assert.equal(after.reviews.length, 1); assert.equal(after.state, "submitted"); }
				}
			});
			await check("version_feedback_append_receipts_and_other_guest_denial", async () => {
				const path = `${GP}/deliveries/${v1.id}/feedback`;
				await write("comment", G, path, { kind: "comment", body: "合成指定旧版留言；不代表尺寸验收", guestLabel: "FIX-C Guest" });
				await write("received", G, path, { kind: "received", body: "", guestLabel: "FIX-C Guest" });
				const accepted = await write<{ id: string }>("accepted", G, path, { kind: "accepted", body: "", guestLabel: "FIX-C Guest" });
				const denied = await write<{ code: string }>("other-guest-withdraw-denied", G2, path, { kind: "withdrawn", targetId: accepted.id, body: "", guestLabel: "FIX-C Guest2" }, "POST", undefined, 409);
				assert.equal(denied.code, "FEEDBACK_STATE_CONFLICT");
				await write("owner-feedback-denied", A, `${O}/deliveries/${v1.id}/feedback`, { kind: "comment", body: "合成拒绝验证", guestLabel: "" }, "POST", undefined, 403);
				await write("withdrawn", G, path, { kind: "withdrawn", targetId: accepted.id, body: "", guestLabel: "FIX-C Guest" });
				const history = await G.json<FeedbackPage>(path); assert.equal(history.total, 4); assert.equal(history.myReceipt, null);
				assert.deepEqual(history.receipts, { received: 0, accepted: 0 });
				assert.equal((await G.json<FeedbackPage>(`${GP}/deliveries/${v2.id}/feedback`)).total, 0);
			});
		}
		if (args.phase === "revoke") await check("archive_readonly_revoke_restore_old_sessions_stay_denied", async () => {
			const project = resultOf<{ revision: number }>(state, "project");
			const archived = await write<{ revision: number }>("archive", A, `${O}/archive`, { archived: true }, "POST", project.revision);
			await G.json(GP);
			const manifest = state.assets.find(a => a.key === "v1"); assert.ok(manifest);
			await download(G, `${GP}/deliveries/${v1.id}/files/${resultOf<{ id: string }>(state, "reserve-v1").id}/download`, manifest);
			await write("archived-owner-write-denied", A, `${O}/deliveries`, { description: "不得保存", fileIds: [] }, "POST", undefined, 409);
			await write("archived-guest-write-denied", G, `${GP}/deliveries/${v1.id}/feedback`, { kind: "comment", body: "不得保存", guestLabel: "" }, "POST", undefined, 409);
			const share = resultOf<{ id: string }>(state, "share");
			await write("revoke-own-share", A, `${O}/share-links/${share.id}`, {}, "DELETE");
			for (const c of [G, G2]) await deny(c, GP, 401);
			await write("restore", A, `${O}/archive`, { archived: false }, "POST", archived.revision);
			for (const c of [G, G2]) {
				await deny(c, GP, 401); await deny(c, `${GP}/files/${photo.id}/preview?variant=640`, 401);
				await deny(c, `${GP}/files/${photo.id}/download`, 401);
				await deny(c, `${GP}/files/${photo.id}/annotated-export`, 401);
				await deny(c, `${GP}/image-access?ids=${photo.id}`, 401);
			}
			await A.json(O);
		});
		await check("source_unchanged", async () => assert.equal(await source(), digest));
		state.completed.push(args.phase); await save();
	} catch {
		if (!results.some(r => r.status === "NOT_PASSED")) results.push({ name: stage, status: "NOT_PASSED", milliseconds: 0, code: "SETUP_OR_SCOPE_FAILED" });
		process.exitCode = 1;
	} finally { await report(); }
	console.log(JSON.stringify({ report: reportPath, status: process.exitCode ? "NOT_PASSED" : "PASS", completed: state.completed }));
}
main().catch(error => { console.error(JSON.stringify({ status: "NOT_PASSED", ...connectionFailure(error) })); process.exitCode = 1; });
