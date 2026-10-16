import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { context, call, requireData } from "./helpers.mjs";
await mkdir("tmp/p0-2", { recursive: true });
await mkdir("docs/evidence/p0-2/screenshots", { recursive: true });
const results = [],
	contexts = [],
	accounts = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8"));
let stage = "login";
try {
	for (const actor of ["A", "B"]) {
		const c = await context();
		contexts.push(c);
		await requireData(
			await call(c, "/api/auth/login", "POST", accounts[actor]),
		);
		await c.storageState({ path: `tmp/p0-2/owner-${actor}.json` });
	}
	const [a, b] = contexts;
	stage = "project";
	const pa = await requireData(
		await call(a, "/api/projects", "POST", {
			name: "P0-2 手动标注试用",
			description:
				"合成定位试样：几何与字段只用于功能验证，图片像素不能当作实测毫米值。",
		}),
		201,
	);
	const pb = await requireData(
		await call(b, "/api/projects", "POST", {
			name: "P0-2 权限对照 B",
			description: "仅用于隔离验证",
		}),
		201,
	);
	const share = await requireData(
		await call(a, `/api/projects/${pa.id}/share-links`, "POST", {}),
		201,
	);
	const g = await context();
	contexts.push(g);
	await requireData(
		await call(g, "/api/guest/session", "POST", {
			token: share.url.split("/").pop(),
		}),
	);
	await g.storageState({ path: "tmp/p0-2/guest.json" });
	async function upload(c, project, name, bytes, mime) {
		const base = `/api/projects/${project}/uploads`;
		const reservation = await requireData(
			await call(c, base, "POST", {
				filename: name,
				byteSize: bytes.length,
				declaredMime: mime,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			}),
			201,
		);
		const grant = await requireData(
			await call(c, `${base}/${reservation.id}/grant`, "POST", {}),
		);
		const transferred = await fetch(grant.signedUrl, {
			method: "PUT",
			headers: { "Content-Type": mime },
			body: bytes,
		});
		if (!transferred.ok) throw new Error("STORAGE_TRANSFER_FAILED");
		await requireData(
			await call(c, `${base}/${reservation.id}/complete`, "POST", {}),
			202,
		);
		for (let attempt = 0; attempt < 60; attempt++) {
			const status = await requireData(
				await call(c, `${base}/${reservation.id}`),
			);
			if (status.state === "ready") return reservation.id;
			if (status.state === "rejected")
				throw new Error(`PROCESSING_${status.errorCode}`);
			await new Promise((resolve) => setTimeout(resolve, 2000));
		}
		throw new Error("PROCESSING_TIMEOUT");
	}
	stage = "image";
	const svg = `<svg width="1600" height="1000" xmlns="http://www.w3.org/2000/svg"><rect width="1600" height="1000" fill="#f5f7fa"/><text x="80" y="80" font-size="32" fill="#202833">PartMeasure · Synthetic positioning fixture</text><rect x="230" y="180" width="1140" height="640" rx="28" fill="#d7dee5" stroke="#39475a" stroke-width="6"/><path d="M230 500H1370M800 180V820" stroke="#8898aa" stroke-dasharray="12 12" stroke-width="2"/>${[
		[400, 350],
		[1200, 350],
		[400, 650],
		[1200, 650],
	]
		.map(
			([x, y]) =>
				`<circle cx="${x}" cy="${y}" r="72" fill="white" stroke="#39475a" stroke-width="6"/><path d="M${x - 95} ${y}H${x + 95}M${x} ${y - 95}V${y + 95}" stroke="#8898aa" stroke-width="2"/>`,
		)
		.join(
			"",
		)}<rect x="650" y="425" width="300" height="150" rx="75" fill="white" stroke="#39475a" stroke-width="6"/><text x="80" y="940" font-size="24" fill="#536477">No physical dimensions implied · ${randomUUID()}</text></svg>`;
	const image = await upload(
		a,
		pa.id,
		"定位试样-横图.png",
		await sharp(Buffer.from(svg)).png().toBuffer(),
		"image/png",
	);
	stage = "exif-fixture";
	const exif = await upload(
		a,
		pa.id,
		"EXIF-方向6.jpg",
		await readFile("experiments/konva/public/fixtures/640x480-o6-source.jpg"),
		"image/jpeg",
	);
	stage = "attachment";
	const attachment = await upload(
		a,
		pa.id,
		"文件问题示例.step",
		Buffer.from(
			`ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('P0-2 fixture ${randomUUID()}'),'2;1');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;`,
		),
		"application/octet-stream",
	);
	await writeFile(
		"tmp/p0-2/fixture.json",
		JSON.stringify({
			projectA: pa.id,
			projectB: pb.id,
			image,
			exif,
			attachment,
			shareUrl: share.url,
		}),
	);
	await writeFile(
		"tmp/p0-2/manual-entry.txt",
		`Owner: http://127.0.0.1:3000/projects/${pa.id}\nGuest (secret; do not commit): ${share.url}\nPasswords: D:/PartMeasure/tmp/p0-1/test-passwords.txt\n`,
	);
	results.push({
		check: "normal-password-login-project-share-and-real-processed-fixtures",
		status: "PASS",
		files: 3,
	});
} catch (error) {
	results.push({
		check: stage,
		status: "FAIL",
		code: /^(HTTP_\d+_[A-Z_]+|PROCESSING_[A-Z_]+|STORAGE_TRANSFER_FAILED)$/.test(
			error.message,
		)
			? error.message
			: "FIXTURE_SETUP_FAILED",
	});
	process.exitCode = 1;
} finally {
	await Promise.all(contexts.map((c) => c.dispose()));
}
await writeFile(
	"docs/evidence/p0-2/setup.json",
	`${JSON.stringify({ checkedAt: new Date().toISOString(), synthetic: true, realAuthAndStorage: true, results }, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(results)}\n`);
