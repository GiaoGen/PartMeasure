// Local disposable PostgreSQL only. Cloud Auth/Storage are never replaced by these fixtures.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import pg from "pg";
import * as projects from "../../src/lib/server/service";
import * as annotations from "../../src/lib/server/annotation-service";
import * as issues from "../../src/lib/server/issue-service";
import {
	claimUpload,
	finalizeUpload,
} from "../../src/lib/server/complete-upload";
import {
	type Actor,
	transaction,
	getPool,
	digest,
} from "../../src/lib/server/db";
import {
	emptyMetadata,
	type Geometry,
	type EngineeringMetadata,
	type Annotation,
} from "../../src/lib/annotations";
import { validExtendedGeometry } from "../../src/lib/geometry-extensions";
const url = new URL(process.env.DATABASE_URL ?? "");
if (
	process.env.PM_EVENTS_LOCAL !== "disposable-native-pg" ||
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
const A: Actor = { kind: "owner", id: randomUUID() },
	B: Actor = { kind: "owner", id: randomUUID() },
	results: { check: string; status: string; code?: string }[] = [];
function present<T>(value: T | undefined): T {
	assert.ok(value);
	return value;
}
async function check(check: string, work: () => Promise<void>) {
	try {
		await work();
		results.push({ check, status: "PASS" });
	} catch (e) {
		results.push({
			check,
			status: "FAIL",
			code: (e as { code?: string }).code ?? "ASSERTION_FAILED",
		});
	}
	console.log(JSON.stringify(results.at(-1)));
}
const rejects = (p: Promise<unknown>, code: string) =>
	assert.rejects(p, (e: { code?: string }) => e.code === code);
await admin.connect();
try {
	await admin.query("insert into auth.users(id) values($1),($2)", [A.id, B.id]);
	const project = await projects.createProject(
		A,
		{ name: "EXT local synthetic", description: "" },
		randomUUID(),
	);
	const link = await projects.rotateShare(A, project.id, randomUUID()),
		session = await projects.bootstrap(
			(link.url ?? "").split("/").at(-1) ?? "",
		);
	const G: Actor = { kind: "guest", hash: digest(session.secret) };
	const upload = await projects.reserve(
			G,
			project.id,
			{
				filename: "sample.png",
				declaredMime: "image/png",
				byteSize: 8,
				sha256: "a".repeat(64),
			},
			randomUUID(),
		),
		claim = await claimUpload(G, project.id, upload.id);
	await finalizeUpload(G, claim.upload, {
		bytes: 8,
		hash: "a".repeat(64),
		key: `${project.id}/${upload.id}/canonical.webp`,
		originalKey: `${project.id}/${upload.id}/source`,
		mime: "image/webp",
		width: 1000,
		height: 800,
		normalizationVersion: 1,
		thumbnails: [],
	});
	const fileId = upload.id,
		W = 1000,
		H = 800;
	const angle: Geometry = {
		type: "angle",
		vertex: { x: 0.4, y: 0.5 },
		from: { x: 0.7, y: 0.5 },
		to: { x: 0.4, y: 0.2 },
		reflex: false,
	};
	const arc: Geometry = {
		type: "arc",
		from: { x: 0.3, y: 0.6 },
		via: { x: 0.5, y: 0.35 },
		to: { x: 0.7, y: 0.6 },
	};
	const ellipse: Geometry = {
		type: "ellipse",
		center: { x: 0.5, y: 0.5 },
		axisA: { x: 0.7, y: 0.5 },
		axisB: { x: 0.5, y: 0.625 },
	};
	const create = (g: Geometry, metadata: Partial<EngineeringMetadata> = {}) =>
		annotations.createAnnotation(
			A,
			project.id,
			{
				id: randomUUID(),
				fileId,
				imageHash: "a".repeat(64),
				geometry: g,
				metadata: { ...emptyMetadata(), ...metadata },
			},
			randomUUID(),
		);
	const list = (a: Annotation) =>
		issues.listIssues(G, project.id, null, fileId, a.id);
	const update = (a: Annotation, g: Geometry, metadata = a.metadata) =>
		annotations.changeAnnotation(
			A,
			project.id,
			a.id,
			{ imageHash: "a".repeat(64), geometry: g, metadata },
			a.revision,
			randomUUID(),
		);
	async function submit(
		i: Awaited<ReturnType<typeof list>>["items"][number],
		value: string,
		unit: "mm" | "cm" | "deg",
	) {
		const r = await issues.respondIssue(
			G,
			project.id,
			i.id,
			{
				kind: "numeric",
				value,
				unit,
				body: "",
				evidenceFileIds: [],
				guestLabel: "",
			},
			i.revision,
			randomUUID(),
		);
		return issues.reviewIssue(
			A,
			project.id,
			i.id,
			{
				decision: "confirm",
				responseId: r.responseId,
				value,
				unit,
				source: "customer_numeric",
				note: "",
			},
			r.revision,
			randomUUID(),
		);
	}
	await check(
		"SQL-and-TS-geometry-validation-agree-on-non-square-images",
		async () => {
			const samples: Geometry[] = [
				angle,
				arc,
				ellipse,
				{ ...angle, reflex: true },
				{ ...angle, from: angle.vertex },
				{ ...arc, via: arc.from },
				{ ...ellipse, axisB: { x: 0.6, y: 0.6 } },
				{
					type: "arc",
					from: { x: 0.1, y: 0.1 },
					via: { x: 0.9, y: 0.1 },
					to: { x: 0.9, y: 0.9 },
				},
			];
			for (const g of samples) {
				const actual: boolean = await transaction(
					A,
					async (db) =>
						(
							await db.query(
								"select pm.valid_annotation_geometry($1::jsonb,$2,$3) as ok",
								[JSON.stringify(g), W, H],
							)
						).rows[0].ok,
				);
				assert.equal(actual, validExtendedGeometry(g, W, H));
			}
		},
	);
	await check(
		"angle-auto-request-rejects-length-units-and-confirmation-writes-degrees",
		async () => {
			const a = await create(angle);
			assert.equal(a.schemaVersion, 2);
			const i = present((await list(a)).items[0]);
			assert.equal(i.measurementField, "angleValue");
			await rejects(
				issues.respondIssue(
					G,
					project.id,
					i.id,
					{
						kind: "numeric",
						value: "45",
						unit: "mm",
						body: "",
						evidenceFileIds: [],
						guestLabel: "",
					},
					i.revision,
					randomUUID(),
				),
				"INVALID_MEASUREMENT_UNIT",
			);
			await submit(i, "45", "deg");
			const saved = present(
				(await annotations.annotations(G, project.id, fileId)).items.find(
					(row) => row.id === a.id,
				),
			);
			assert.equal(saved.metadata.angleValue, "45");
			assert.equal(saved.metadata.unit, "mm");
			assert.equal(
				(await issues.detailIssue(G, project.id, i.id)).target?.annotation
					.metadata.angleValue,
				undefined,
			);
		},
	);

	await check(
		"ellipse-default-diameter-and-optional-major-semiaxis",
		async () => {
			const a = await create(ellipse),
				i = present((await list(a)).items[0]);
			assert.equal(i.measurementField, "dimension");
			await submit(i, "20", "mm");
			let saved = present(
				(await annotations.annotations(G, project.id, fileId)).items.find(
					(row) => row.id === a.id,
				),
			);
			assert.equal(saved.metadata.dimension, "20");
			saved = await update(saved, ellipse, {
				...saved.metadata,
				ellipseMeasure: "majorRadius",
			});
			const next = present(
				(await list(saved)).items.find(
					(row) => !row.closedAt && row.state !== "confirmed",
				),
			);
			assert.equal(next.measurementField, "majorRadius");
			await submit(next, "1", "cm");
			saved = present(
				(await annotations.annotations(G, project.id, fileId)).items.find(
					(row) => row.id === a.id,
				),
			);
			assert.equal(saved.metadata.majorRadius, "1");
			assert.equal(saved.metadata.dimension, "2");
			assert.equal(saved.metadata.unit, "cm");
		},
	);
	await check(
		"arc-radius-length-and-angle-have-independent-immutable-confirmations",
		async () => {
			const a = await create(arc, {
					arcQuantities: ["radius", "arcLength", "angle"],
				}),
				items = (await list(a)).items;
			assert.equal(items.length, 3);
			for (const [field, value, unit] of [
				["dimension", "20", "mm"],
				["arcLength", "55", "mm"],
				["angleValue", "180", "deg"],
			] as const)
				await submit(
					present(items.find((i) => i.measurementField === field)),
					value,
					unit,
				);
			const saved = present(
				(await annotations.annotations(G, project.id, fileId)).items.find(
					(row) => row.id === a.id,
				),
			);
			assert.equal(saved.metadata.dimension, "20");
			assert.equal(saved.metadata.arcLength, "55");
			assert.equal(saved.metadata.angleValue, "180");
			assert.equal(saved.collaboration?.pending, 0);
		},
	);
	await check(
		"display-radius-keeps-request-but-target-changes-close-old-snapshot",
		async () => {
			let a = await create(angle),
				i = present((await list(a)).items[0]);
			a = await update(a, { ...angle, arcScale: 0.7 });
			assert.equal(present((await list(a)).items[0]).id, i.id);
			a = await update(a, { ...angle, vertex: { x: 0.45, y: 0.55 } });
			assert.equal((await list(a)).items.filter((x) => !x.closedAt).length, 1);
			assert.ok((await issues.detailIssue(G, project.id, i.id)).closedAt);
			await rejects(submit(i, "45", "deg"), "CLOSED_MEASUREMENT");
		},
	);
	await check(
		"new-types-save-reload-history-and-Guest-owner-isolation",
		async () => {
			const a = await create(ellipse),
				before = (
					await annotations.annotations(G, project.id, fileId)
				).items.find((row) => row.id === a.id);
			assert.deepEqual(before?.geometry, a.geometry);
			await rejects(
				annotations.changeAnnotation(
					G,
					project.id,
					a.id,
					null,
					a.revision,
					randomUUID(),
				),
				"FORBIDDEN",
			);
			await rejects(
				annotations.annotations(B, project.id, fileId),
				"NOT_FOUND",
			);
			const i = present((await list(a)).items[0]);
			await rejects(
				issues.reviewIssue(
					G,
					project.id,
					i.id,
					{
						decision: "remeasure",
						responseId: randomUUID(),
						value: null,
						unit: null,
						source: null,
						note: "forged",
					},
					1,
					randomUUID(),
				),
				"FORBIDDEN",
			);
			await rejects(
				update({ ...a, revision: 999 }, ellipse),
				"REVISION_CONFLICT",
			);
		},
	);
	await check(
		"SQL-also-rejects-unit-forgery-and-old-circle-schema-remains-valid",
		async () => {
			const valid = await transaction(
				A,
				async (db) =>
					(
						await db.query(
							"select pm.valid_measurement_value('45','mm','angleValue') as bad_angle,pm.valid_measurement_value('10','deg','dimension') as bad_length,pm.valid_measurement_value('45','deg','angleValue') as good",
						)
					).rows[0],
			);
			assert.deepEqual(valid, {
				bad_angle: false,
				bad_length: false,
				good: true,
			});
			const circle = await create({
				type: "circle",
				center: { x: 0.5, y: 0.5 },
				radiusX: 0.1,
				radiusY: 0.125,
			});
			assert.equal(circle.schemaVersion, 1);
			assert.equal((await list(circle)).items.length, 1);
		},
	);
	await check("revocation-denies-new-types-too", async () => {
		await projects.revokeShare(A, project.id, link.id, randomUUID());
		await rejects(
			annotations.annotations(G, project.id, fileId),
			"LINK_UNAVAILABLE",
		);
	});
} finally {
	await admin.end();
	await getPool().end();
	await mkdir("docs/evidence/extended-annotations", { recursive: true });
	await writeFile(
		"docs/evidence/extended-annotations/native.json",
		`${JSON.stringify(
			{
				checkedAt: new Date().toISOString(),
				scope:
					"Disposable native PostgreSQL: SQL/transactions/RLS only, no cloud Auth/Storage/browser evidence",
				results,
			},
			null,
			2,
		)}\n`,
	);
}
if (results.some((r) => r.status !== "PASS")) process.exitCode = 1;
