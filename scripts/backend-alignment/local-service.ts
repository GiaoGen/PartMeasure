// Native disposable PG only: real service SQL/RLS, synthetic identities and files.
// No Supabase Auth/Storage proof, no browser and no remote DDL.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import * as projects from "../../src/lib/server/service";
import * as folders from "../../src/lib/server/folder-service";
import * as annotations from "../../src/lib/server/annotation-service";
import * as issues from "../../src/lib/server/issue-service";
import {
	getPool,
	digest,
	transaction,
	type Actor,
} from "../../src/lib/server/db";
import { emptyMetadata } from "../../src/lib/annotations";
import { folderInput } from "../../src/lib/project-folders";

const url = new URL(process.env.DATABASE_URL ?? "");
if (
	process.env.PM_ALIGNMENT_LOCAL !== "disposable-native-pg" ||
	url.hostname !== "127.0.0.1" ||
	url.port !== "55448"
)
	throw Error("LOCAL_ONLY");
const admin = new pg.Client({
	host: "127.0.0.1",
	port: 55448,
	user: "postgres",
	database: "postgres",
	ssl: {
		rejectUnauthorized: true,
		ca: await readFile(process.env.DATABASE_CA_FILE ?? "", "utf8"),
	},
});
await admin.connect();
const A: Actor = { kind: "owner", id: randomUUID() },
	B: Actor = { kind: "owner", id: randomUUID() };
const results: { check: string; status: string; code?: string }[] = [];
async function check(name: string, work: () => Promise<void>) {
	try {
		await work();
		results.push({ check: name, status: "PASS" });
	} catch (error) {
		const e = error as { code?: string; name?: string };
		results.push({
			check: name,
			status: "FAIL",
			code: e.code ?? e.name ?? "UNKNOWN",
		});
	}
	process.stdout.write(`${name}: ${results.at(-1)?.status}\n`);
}
const rejects = (work: Promise<unknown>, code: string) =>
	assert.rejects(work, (e: { code?: string }) => e.code === code);
const rowCount = async () =>
	Number(
		(await admin.query("select count(*) as n from pm.projects")).rows[0].n,
	);
try {
	await admin.query("insert into auth.users(id) values($1),($2)", [A.id, B.id]);
	const old = randomUUID();
	await admin.query(
		"insert into pm.projects(id,owner_id,name) values($1,$2,'legacy unclassified')",
		[old, A.id],
	);
	const key = randomUUID(),
		input = folderInput.parse({ name: "  客户 A  ", color: "rose" });
	const fa = await folders.createFolder(A, input, key),
		fb = await folders.createFolder(
			B,
			folderInput.parse({ name: "客户 A" }),
			randomUUID(),
		);
	assert.ok(fa && fb);
	await check(
		"folder-save-replay-normalized-duplicate-and-seven-colors",
		async () => {
			assert.equal((await folders.createFolder(A, input, key))?.id, fa.id);
			await rejects(
				folders.createFolder(
					A,
					folderInput.parse({ name: "客户 A" }),
					randomUUID(),
				),
				"FOLDER_NAME_EXISTS",
			);
			await folders.createFolder(
				A,
				folderInput.parse({ name: "CASE" }),
				randomUUID(),
			);
			await rejects(
				folders.createFolder(
					A,
					folderInput.parse({ name: "case" }),
					randomUUID(),
				),
				"FOLDER_NAME_EXISTS",
			);
			for (const color of [
				"blue",
				"cyan",
				"green",
				"purple",
				"coral",
				"slate",
			] as const)
				await folders.createFolder(
					A,
					folderInput.parse({ name: `color-${color}`, color }),
					randomUUID(),
				);
			const list = await folders.listFolders(A);
			assert.equal(new Set(list.items.map((f) => f.color)).size, 7);
			assert.equal(
				list.items.some((f) => f.id === fb.id),
				false,
			);
		},
	);
	await check(
		"concurrent-same-key-one-result-different-key-one-duplicate",
		async () => {
			const same = randomUUID(),
				value = folderInput.parse({ name: "concurrent-idem" });
			const pair = await Promise.all([
				folders.createFolder(A, value, same),
				folders.createFolder(A, value, same),
			]);
			assert.equal(pair[0]?.id, pair[1]?.id);
			const race = await Promise.allSettled([
				folders.createFolder(
					A,
					folderInput.parse({ name: "concurrent-name" }),
					randomUUID(),
				),
				folders.createFolder(
					A,
					folderInput.parse({ name: "concurrent-name" }),
					randomUUID(),
				),
			]);
			assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
			assert.equal(
				race.filter(
					(r) =>
						r.status === "rejected" && r.reason.code === "FOLDER_NAME_EXISTS",
				).length,
				1,
			);
		},
	);
	const project = await projects.createProject(
		A,
		{ name: "当前项目", description: "", folderId: fa.id },
		randomUUID(),
	);
	await check(
		"project-classification-atomic-idempotent-and-cross-owner-denied",
		async () => {
			assert.equal(project.folder?.color, "rose");
			assert.equal(
				(await projects.projectDetail(A, project.id)).folderId,
				fa.id,
			);
			const before = await rowCount();
			await rejects(
				projects.createProject(
					A,
					{ name: "must not exist", description: "", folderId: fb.id },
					randomUUID(),
				),
				"NOT_FOUND",
			);
			assert.equal(await rowCount(), before);
			await rejects(projects.projectDetail(B, project.id), "NOT_FOUND");
		},
	);
	for (let i = 0; i < 32; i++)
		await projects.createProject(
			A,
			{
				name: `分页 ${i.toString().padStart(2, "0")}`,
				description: i === 0 ? "Needle 中文 100%_literal" : "",
				folderId: fa.id,
			},
			randomUUID(),
		);
	await check(
		"server-search-beyond-first-page-literal-wildcards-and-count-scopes",
		async () => {
			const all = await projects.listProjects(A, null, {
				folderId: fa.id,
				q: "",
			});
			assert.equal(all.items.length, 30);
			assert.ok(all.nextCursor);
			assert.equal(all.counts.folderCount, 33);
			assert.equal(all.counts.searchMatchCount, 33);
			const next = await projects.listProjects(A, all.nextCursor, {
				folderId: fa.id,
				q: "",
			});
			assert.equal(next.items.length, 3);
			assert.equal(
				new Set([...all.items, ...next.items].map((p) => p.id)).size,
				33,
			);
			const match = await projects.listProjects(A, null, {
				folderId: fa.id,
				q: " needle 中文 ",
			});
			assert.equal(match.items.length, 1);
			assert.equal(match.counts.searchMatchCount, 1);
			assert.equal(match.counts.folderCount, 33);
			assert.equal(
				(await projects.listProjects(A, null, { folderId: fa.id, q: "%_" }))
					.items.length,
				1,
			);
			assert.equal(
				(
					await projects.listProjects(A, null, {
						folderId: fa.id,
						q: "' OR true --",
					})
				).items.length,
				0,
			);
		},
	);
	await check(
		"query-bound-cursor-cross-owner-cross-filter-and-stale-anchor",
		async () => {
			const page = await projects.listProjects(A, null, {
				folderId: fa.id,
				q: "",
			});
			await rejects(
				projects.listProjects(A, page.nextCursor, {
					folderId: fa.id,
					q: "分页",
				}),
				"CURSOR_INVALID",
			);
			await rejects(
				projects.listProjects(B, page.nextCursor),
				"CURSOR_INVALID",
			);
			await rejects(projects.listProjects(A, fb.id), "CURSOR_INVALID");
			await rejects(
				projects.listProjects(A, null, { folderId: fb.id, q: "" }),
				"NOT_FOUND",
			);
			assert.equal(
				(await projects.listProjects(A, null, { folderId: "none", q: "" }))
					.items[0]?.id,
				old,
			);
		},
	);
	const share = await projects.rotateShare(A, project.id, randomUUID());
	assert.ok(share.url);
	const session = await projects.bootstrap(share.url.split("/").at(-1) ?? "");
	const guest: Actor = { kind: "guest", hash: digest(session.secret) };
	await check(
		"Guest-private-folder-denial-and-project-metadata-redaction",
		async () => {
			await rejects(folders.listFolders(guest), "FORBIDDEN");
			await rejects(
				folders.createFolder(guest, input, randomUUID()),
				"FORBIDDEN",
			);
			const view = await projects.projectDetail(guest, project.id);
			assert.equal(Object.hasOwn(view, "folder"), false);
			assert.equal(Object.hasOwn(view, "folderId"), false);
			assert.equal(
				await transaction(
					guest,
					async (db) =>
						(await db.query("select id from pm.project_folders")).rowCount,
				),
				0,
			);
		},
	);
	await check(
		"database-composite-owner-FK-and-no-folder-delete-grant",
		async () => {
			await rejects(
				transaction(A, async (db) =>
					db.query("update pm.projects set folder_id=$2 where id=$1", [
						project.id,
						fb.id,
					]),
				),
				"23503",
			);
			await rejects(
				transaction(A, async (db) =>
					db.query("delete from pm.project_folders where id=$1", [fa.id]),
				),
				"42501",
			);
			assert.equal(
				(
					await admin.query(
						"select relrowsecurity from pg_class where oid='pm.project_folders'::regclass",
					)
				).rows[0].relrowsecurity,
				true,
			);
		},
	);
	const fileId = randomUUID(),
		reservation = randomUUID(),
		hash = "a".repeat(64);
	await admin.query(
		"insert into pm.upload_reservations(id,project_id,actor_key,filename,extension,declared_mime,byte_size,sha256,reserved_bytes,quarantine_key,state) values($1,$2,$3,'synthetic.png','png','image/png',128,$4,256,$5,'ready')",
		[reservation, project.id, `owner:${A.id}`, hash, randomUUID()],
	);
	await admin.query(
		"insert into pm.file_assets(id,project_id,reservation_id,filename,mime,extension,byte_size,original_bytes,storage_key,original_key,sha256,original_sha256,width,height,normalization_version,uploader_type) values($1,$2,$3,'synthetic.png','image/webp','png',128,128,$4,$5,$6,$6,1000,800,1,'owner')",
		[fileId, project.id, reservation, randomUUID(), randomUUID(), hash],
	);
	const annotation = await annotations.createAnnotation(
		A,
		project.id,
		{
			id: randomUUID(),
			fileId,
			imageHash: hash,
			geometry: {
				type: "line",
				from: { x: 0.2, y: 0.2 },
				to: { x: 0.7, y: 0.2 },
			},
			metadata: emptyMetadata(),
		},
		randomUUID(),
	);
	const request = {
		kind: "measurement" as const,
		fileId,
		annotationRef: { id: annotation.id, revision: 1 },
		title: "same name",
		targetInfo: "外径",
		description: "",
		measurementMethod: "outside" as const,
	};
	for (let i = 0; i < 32; i++)
		await issues.createMeasurement(A, project.id, request, randomUUID());
	await annotations.createFileIssue(
		A,
		project.id,
		{ fileId, title: "文件文字", description: "" },
		randomUUID(),
	);
	await check(
		"annotation-summary-filtered-issues-pagination-and-fixed-revision",
		async () => {
			const listed = await issues.listIssues(
				A,
				project.id,
				null,
				fileId,
				annotation.id,
			);
			assert.equal(listed.items.length, 30);
			assert.ok(listed.nextCursor);
			assert.equal(listed.counts.awaiting_response, 33);
			assert.equal(listed.filteredCounts.awaiting_response, 32);
			assert.equal(listed.countScope, "project");
			assert.equal(listed.filterScope, "annotation");
			assert.ok(
				listed.items.every(
					(issue) =>
						issue.annotationRef?.id === annotation.id &&
						issue.annotationRef.revision === 1,
				),
			);
			assert.equal(
				(
					await issues.listIssues(
						A,
						project.id,
						listed.nextCursor,
						fileId,
						annotation.id,
					)
				).items.length,
				2,
			);
			await rejects(
				issues.listIssues(
					A,
					project.id,
					listed.nextCursor,
					fileId,
					randomUUID(),
				),
				"CURSOR_INVALID",
			);
			await rejects(
				issues.listIssues(
					guest,
					project.id,
					listed.nextCursor,
					fileId,
					annotation.id,
				),
				"CURSOR_INVALID",
			);
			assert.equal(
				(
					await issues.listIssues(
						guest,
						project.id,
						null,
						fileId,
						annotation.id,
					)
				).items.length,
				30,
			);
			const comment = (
				await issues.listIssues(A, project.id, null, fileId)
			).items.find((issue) => issue.kind === "comment");
			assert.equal(comment?.annotationRef, null);
		},
	);
	await check(
		"file-revision-summary-invalidation-hidden-annotation-and-Guest-history",
		async () => {
			const before = (await projects.files(guest, project.id, null)).items[0];
			assert.equal(typeof before.byteSize, "string");
			assert.equal(before.annotationSummary.count, 1);
			assert.equal(before.previewVersion, `${hash}:n1`);
			await annotations.changeAnnotation(
				A,
				project.id,
				annotation.id,
				{
					geometry: annotation.geometry,
					metadata: { ...annotation.metadata, name: "changed" },
					imageHash: hash,
				},
				1,
				randomUUID(),
			);
			const after = (await projects.files(guest, project.id, null)).items[0];
			assert.notEqual(
				after.annotationSummary.version,
				before.annotationSummary.version,
			);
			assert.equal(
				(
					await issues.listIssues(
						guest,
						project.id,
						null,
						fileId,
						annotation.id,
					)
				).items[0]?.annotationRef?.revision,
				1,
			);
			await annotations.changeAnnotation(
				A,
				project.id,
				annotation.id,
				null,
				2,
				randomUUID(),
			);
			assert.equal(
				(await projects.files(guest, project.id, null)).items[0]
					.annotationSummary.count,
				0,
			);
			assert.equal(
				(
					await issues.listIssues(
						guest,
						project.id,
						null,
						fileId,
						annotation.id,
					)
				).filteredCounts.awaiting_response,
				32,
			);
		},
	);
	await check(
		"revoked-session-cannot-read-summaries-or-query-issues",
		async () => {
			await projects.revokeShare(A, project.id, share.id, randomUUID());
			await rejects(
				issues.listIssues(guest, project.id, null, fileId, annotation.id),
				"LINK_UNAVAILABLE",
			);
			await rejects(
				projects.files(guest, project.id, null),
				"LINK_UNAVAILABLE",
			);
		},
	);
} catch (error) {
	const e = error as { code?: string; name?: string };
	results.push({
		check: "remaining-checks-interrupted",
		status: "FAIL",
		code: e.code ?? e.name ?? "UNKNOWN",
	});
	process.stdout.write(
		`remaining-checks-interrupted: FAIL ${e.code ?? e.name ?? "UNKNOWN"}\n`,
	);
} finally {
	await admin.end();
	await getPool().end();
	await mkdir("docs/evidence/backend-alignment", { recursive: true });
	const report = {
		checkedAt: new Date().toISOString(),
		environment: "native disposable PostgreSQL 18 with strict TLS",
		authAndStorage: "LOCAL STAND-INS ONLY; not Supabase service verification",
		cloudMigrationApplied: false,
		results,
	};
	await writeFile(
		"docs/evidence/backend-alignment/local-service.json",
		`${JSON.stringify(report, null, 2)}\n`,
	);
}
if (results.some((result) => result.status !== "PASS")) process.exitCode = 1;
