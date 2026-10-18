// Prepare named manual tasks using the normal app, never admin-created business rows.
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import assert from "node:assert/strict";
import { context, call, requireData, saveReport } from "./helpers.mjs";
const f = JSON.parse(await readFile("tmp/p0-4/browser-fixture.json", "utf8")),
	a = await context("A");
const O = `/api/projects/${f.projectA}`;
const created = [];
let cookieFlagsVerified = false,
	guestRestoreVerified = false;
try {
	const files = requireData(await call(a, `${O}/files`)).items;
	const image = files.find((x) => x.mime === "image/webp");
	if (!image) throw Error("IMAGE_REQUIRED");
	const doc = requireData(await call(a, `${O}/files/${image.id}/annotations`));
	const ann = doc.items.find((x) => !x.deletedAt);
	if (!ann) throw Error("ANNOTATION_REQUIRED");
	const existing = requireData(await call(a, `${O}/issues`)).items;
	for (const label of [
		"人工 · 数值回复",
		"人工 · 仅照片与人工确认",
		"人工 · 无法测量与重测",
	]) {
		if (existing.some((x) => x.title === label)) {
			created.push({ title: label, status: "EXISTING" });
			continue;
		}
		requireData(
			await call(a, `${O}/issues`, "POST", {
				kind: "measurement",
				fileId: image.id,
				annotationRef: { id: ann.id, revision: ann.revision },
				title: label,
				targetInfo: "测量标记孔位的内径，合成演示不代表真实尺寸",
				description: "可填数值、仅上传测量照片或说明无法测量；请按标题试用。",
				measurementMethod: "inside",
			}),
			201,
		);
		created.push({ title: label, status: "CREATED" });
	}
	await sharp({
		create: { width: 1000, height: 650, channels: 3, background: "#e7ecf1" },
	})
		.composite([
			{
				input: Buffer.from(
					`<svg width="1000" height="650"><text x="40" y="80" font-size="28">SYNTHETIC MANUAL EVIDENCE ${Date.now()}</text><path d="M150 180V460H340M760 180V460H590" stroke="#39475a" fill="none" stroke-width="15"/></svg>`,
				),
			},
		])
		.png()
		.toFile("tmp/p0-4/manual-evidence.png");
	await sharp("tmp/p0-4/manual-evidence.png")
		.resize({ width: 800 })
		.png()
		.toFile("tmp/p0-4/manual-evidence-2.png");
	await writeFile(
		"tmp/p0-4/manual-entry.txt",
		`Engineer: ${f.root}/projects/${f.projectA}\nGuest (secret, never commit): ${f.shareUrl}\nCredentials: tmp/p0-1/test-passwords.txt\nSample upload: tmp/p0-4/manual-evidence.png\nDelivery sample: tmp/p0-4/large-delivery.step\nHTTPS: ${f.root.startsWith("https:") ? "verified staging; physical phone and mainland network still pending" : "pending; localhost cannot validate physical-phone/mobile-network access"}\n`,
	);
	if (f.root.startsWith("https:")) {
		const ownerCookies = (await a.storageState()).cookies.filter(
			(c) => c.name.startsWith("sb-") && c.name.includes("auth-token"),
		);
		assert.ok(ownerCookies.length > 0);
		assert.ok(
			ownerCookies.every((c) => c.secure && c.httpOnly && c.sameSite === "Lax"),
		);
		const fresh = await context();
		try {
			requireData(
				await call(fresh, "/api/guest/session", "POST", {
					token: f.shareUrl.split("/").pop(),
				}),
			);
			const guestCookie = (await fresh.storageState()).cookies.find(
				(c) => c.name === `pm_guest_${f.projectA}`,
			);
			assert.ok(
				guestCookie?.secure &&
					guestCookie.httpOnly &&
					guestCookie.sameSite === "Lax",
			);
			assert.equal(
				requireData(
					await call(fresh, `/api/guest/projects/${f.projectA}/deliveries`),
				).published.id,
				f.delivery,
			);
			cookieFlagsVerified = true;
			guestRestoreVerified = true;
		} finally {
			await fresh.dispose();
		}
	}
} finally {
	await a.dispose();
}
await saveReport("manual-fixtures", created, {
	containsSecrets: false,
	physicalPhone: false,
	cookieFlagsVerified,
	guestRestoreVerified,
});
console.log({ tasks: created.length });
