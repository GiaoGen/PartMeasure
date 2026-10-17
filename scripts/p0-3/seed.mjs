// Human-trial fixtures through real application APIs; reuses existing project/files/share.
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { context, call, requireData, root } from "../p0-2/helpers.mjs";
const f = JSON.parse(await readFile("tmp/p0-3/fixture.json", "utf8")),
	a = await context("A"),
	g = await context();
try {
	await requireData(
		await call(g, "/api/guest/session", "POST", {
			token: f.shareUrl.split("/").pop(),
		}),
	);
	const image = (
		await requireData(
			await call(a, `/api/projects/${f.projectA}/files/${f.image}/annotations`),
		)
	).image;
	const meta = (name) => ({
		name,
		dimension: "",
		unit: "mm",
		source: "human",
		circleMeasure: "diameter",
		holeDepth: "",
		holeType: "",
		thread: "",
		notes: "合成试样，人工试用数据不代表真实工程尺寸",
	});
	async function annotation(name, geometry) {
		return requireData(
			await call(a, `/api/projects/${f.projectA}/annotations`, "POST", {
				id: randomUUID(),
				fileId: f.image,
				imageHash: image.imageHash,
				geometry,
				metadata: meta(name),
			}),
			201,
		);
	}
	const circle = await annotation("试用孔 A", {
			type: "circle",
			center: { x: 0.25, y: 0.35 },
			radiusX: 72 / 1600,
			radiusY: 72 / 1000,
		}),
		line = await annotation("试用外宽", {
			type: "line",
			from: { x: 0.14375, y: 0.8 },
			to: { x: 0.85625, y: 0.8 },
		});
	const comment = await requireData(
		await call(a, `/api/projects/${f.projectA}/issues`, "POST", {
			fileId: f.attachment,
			title: "试用 · STEP 附件包含哪些零件",
			description: "用文字说明即可，不需要填写数值或几何对象。",
		}),
		201,
	);
	async function issue(target, title, method, targetInfo, description) {
		return requireData(
			await call(a, `/api/projects/${f.projectA}/issues`, "POST", {
				kind: "measurement",
				fileId: f.image,
				annotationRef: { id: target.id, revision: target.revision },
				title,
				targetInfo,
				description,
				measurementMethod: method,
			}),
			201,
		);
	}
	const unable = await issue(
		circle,
		"试用 · 孔深与无法测量",
		"depth",
		"左上圆孔的孔深",
		"没有适合的量具时，选择无法测量并说明；工程师可要求补充视角。",
	);
	const photo = await issue(
		line,
		"试用 · 外宽仅上传照片",
		"outside",
		"线段两端所指安装板外宽",
		"可以只上传卡尺测量照片，不强制读数。合成试样仅用于试用。",
	);
	const numeric = await issue(
		circle,
		"试用 · 孔 A 内径填数值",
		"inside",
		"左上孔 A 的内径",
		"填写手工读数及单位，或提供测量照片。不要根据图片像素推算。",
	);
	const review = await issue(
		circle,
		"试用 · 工程师审核与修正",
		"other",
		"核对左上孔 A 的测量回复",
		"此任务已准备一份测试回复，供工程师检查审核流程。",
	);
	await requireData(
		await call(
			g,
			`/api/guest/projects/${f.projectA}/issues/${review.id}/responses`,
			"POST",
			{
				kind: "numeric",
				value: "8.2",
				unit: "mm",
				body: "合成测试回复，仅用于审核试用",
				evidenceFileIds: [f.exif],
				guestLabel: "试用客户",
			},
			{ revision: 1 },
		),
		201,
	);
	f.p03.manual = {
		circle: circle.id,
		line: line.id,
		comment: comment.id,
		unable: unable.id,
		photo: photo.id,
		numeric: numeric.id,
		review: review.id,
	};
	const stamp = Date.now();
	await sharp(Buffer.from(`<svg width="1000" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="1000" height="600" fill="#e7ecf1"/><rect x="120" y="200" width="760" height="140" fill="#aebccc"/><path d="M160 120V430H330V350M830 120V430H660V350" stroke="#39475a" stroke-width="16" fill="none"/><text x="50" y="65" font-size="27">SYNTHETIC TRIAL PHOTO - NOT A REAL MEASUREMENT</text><text x="60" y="530" font-size="24">Human entry only - ${stamp}</text></svg>`)).png().toFile("tmp/p0-3/manual-evidence.png");
	await writeFile("tmp/p0-3/fixture.json", JSON.stringify(f));
	await writeFile(
		"tmp/p0-3/manual-entry.txt",
		`Owner: ${root}/projects/${f.projectA}\nGuest (secret; do not commit): ${f.shareUrl}\nCredentials: D:/PartMeasure/tmp/p0-1/test-passwords.txt\nNew synthetic evidence image: D:/PartMeasure/tmp/p0-3/manual-evidence.png\n`,
	);
	await writeFile(
		"docs/evidence/p0-3/manual-fixtures.json",
		`${JSON.stringify({ checkedAt: new Date().toISOString(), normalAuth: true, synthetic: true, readyTasks: 5, existingProcessedPrivateAssets: true }, null, 2)}\n`,
	);
	process.stdout.write(
		"manual trial fixtures: PASS (5 tasks; real normal API)\n",
	);
} finally {
	await a.dispose();
	await g.dispose();
}
