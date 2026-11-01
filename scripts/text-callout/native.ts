// New disposable loopback PostgreSQL only; never reads credentials or contacts cloud.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import * as projects from "../../src/lib/server/service";
import * as annotations from "../../src/lib/server/annotation-service";
import { claimUpload, finalizeUpload } from "../../src/lib/server/complete-upload";
import { getPool, type Actor } from "../../src/lib/server/db";
import { emptyMetadata, type Geometry } from "../../src/lib/annotations";
const url = new URL(process.env.DATABASE_URL ?? "");
if (process.env.PM_EVENTS_LOCAL !== "disposable-native-pg" || url.hostname !== "127.0.0.1" || url.port !== "55461") throw Error("LOCAL_ONLY");
const admin = new pg.Client({ host: "127.0.0.1", port: 55461, user: "postgres", database: "postgres", ssl: { rejectUnauthorized: true, ca: await readFile(process.env.DATABASE_CA_FILE ?? "", "utf8") } });
const owner: Actor = { kind: "owner", id: randomUUID() }, other: Actor = { kind: "owner", id: randomUUID() };
const results: string[] = [];
await admin.connect();
try {
	await admin.query("insert into auth.users(id) values($1),($2)", [owner.id, other.id]);
	const project = await projects.createProject(owner, { name: "Local arrow text", description: "" }, randomUUID());
	const upload = await projects.reserve(owner, project.id, { filename: "synthetic.png", declaredMime: "image/png", byteSize: 8, sha256: "a".repeat(64) }, randomUUID());
	const claim = await claimUpload(owner, project.id, upload.id);
	await finalizeUpload(owner, claim.upload, { bytes: 8, hash: "a".repeat(64), key: `${project.id}/${upload.id}/canonical.webp`, originalKey: `${project.id}/${upload.id}/source`, mime: "image/webp", width: 1000, height: 800, normalizationVersion: 1, thumbnails: [] });
	const create = (geometry: Geometry) => annotations.createAnnotation(owner, project.id, { id: randomUUID(), fileId: upload.id, imageHash: "a".repeat(64), geometry, metadata: emptyMetadata() }, randomUUID());
	const legacy = await create({ type: "text", at: { x: 0.5, y: 0.5 }, text: "旧文字" });
	const point = await create({ type: "point", at: { x: 0.2, y: 0.2 } });
	const geometry: Geometry = { type: "text", at: { x: 0.8, y: 0.7 }, labelAt: { x: 0.2, y: 0.2 }, text: "确认此处倒角" };
	const arrow = await create(geometry);
	assert.deepEqual(arrow.geometry, geometry);
	results.push("actual service saves new arrow text beside legacy text and point");
	const changed = await annotations.changeAnnotation(owner, project.id, arrow.id, { geometry: { ...geometry, labelAt: { x: 0.3, y: 0.25 }, text: "新的说明" }, metadata: arrow.metadata, imageHash: "a".repeat(64) }, arrow.revision, randomUUID());
	assert.equal(changed.revision, 2);
	const loaded = await annotations.annotations(owner, project.id, upload.id);
	assert.deepEqual(loaded.items.find(item => item.id === arrow.id)?.geometry, changed.geometry);
	assert.deepEqual(loaded.items.find(item => item.id === legacy.id)?.geometry, legacy.geometry);
	assert.deepEqual(loaded.items.find(item => item.id === point.id)?.geometry, point.geometry);
	const history = await admin.query("select geometry from pm.annotation_revisions where annotation_id=$1 order by revision", [arrow.id]);
	assert.deepEqual(history.rows.map(row => row.geometry), [geometry, changed.geometry]);
	results.push("reload and append-only revisions preserve both arrow endpoints");
	assert.equal((await admin.query("select count(*)::int as n from pm.issues where project_id=$1", [project.id])).rows[0].n, 0);
	results.push("text does not generate numeric measurement tasks");
	const invalid = [{ ...geometry, labelAt: null }, { ...geometry, labelAt: { x: 2, y: 0 } }, { ...geometry, labelAt: geometry.at }, { ...geometry, labelAt: { x: 0.2, y: 0.2, extra: true } }, { ...geometry, extra: true }];
	for (const value of invalid) {
		assert.equal((await admin.query("select pm.valid_annotation_geometry($1::jsonb,1000,800) as valid", [JSON.stringify(value)])).rows[0].valid, false);
	}
	assert.equal((await admin.query("select pm.valid_annotation_geometry($1::jsonb,1000,800) as valid", [JSON.stringify(geometry)])).rows[0].valid, true);
	results.push("database rejects invalid, degenerate and unknown fields independently of client validation");
	await assert.rejects(annotations.annotations(other, project.id, upload.id));
	const permissions = (await admin.query("select has_function_privilege('anon','pm.valid_annotation_geometry_v1(jsonb,integer,integer)','execute') as anon, has_function_privilege('partmeasure_runtime','pm.valid_annotation_geometry_v1(jsonb,integer,integer)','execute') as runtime, prosecdef from pg_proc where oid='pm.valid_annotation_geometry_v1(jsonb,integer,integer)'::regprocedure")).rows[0];
	assert.deepEqual(permissions, { anon: false, runtime: true, prosecdef: false });
	results.push("cross-owner access denied and validator keeps invoker privileges");
	console.log(JSON.stringify({ status: "PASS", checks: results.length, scope: "disposable local PostgreSQL with synthetic metadata; not cloud Auth/Storage" }));
} finally {
	await writeFile("tmp/text-callout-20261101/database-result.json", JSON.stringify({ checkedAt: new Date().toISOString(), results, expectedChecks: 5, scope: "Actual services, 21 migration chain, disposable local PostgreSQL, synthetic records, no cloud" }, null, 2));
	await admin.end(); await getPool().end();
}
