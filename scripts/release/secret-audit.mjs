// Exact local-secret comparison. Outputs paths/counts only; never prints a secret.
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
const needles = new Set();
const add = value => { if (typeof value === "string" && value.length >= 12) needles.add(value); };
function password(raw) { try { const v = decodeURIComponent(new URL(raw).password); add(v); if (v.startsWith("[") && v.endsWith("]")) add(v.slice(1, -1)); } catch {} }
for (const line of (await readFile(".env.local", "utf8")).split(/\r?\n/)) {
	const m = line.match(/^([^#=]+)=(.*)$/); if (!m || m[1].startsWith("NEXT_PUBLIC_")) continue;
	if (/KEY|SECRET|DATABASE_URL/.test(m[1]) && !/_(FILE|PATH|DIRECTORY|BIN)$/.test(m[1])) { const value = m[2].replace(/^['"]|['"]$/g, ""); add(value); password(value); }
}
for (const file of ["secret-key.txt", "admin-database-url.txt"]) { const value = (await readFile(`tmp/p0-1/${file}`, "utf8")).trim(); add(value); password(value); }
for (const account of Object.values(JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8")))) add(account.password);
// Include the newly generated complete real backup key without logging it.
const backupScope = JSON.parse(await readFile("docs/evidence/p3-05/recovery-backup-scope.json", "utf8"));
const backupState = JSON.parse(await readFile(`tmp/fix-e/${backupScope.run}/state.json`, "utf8"));
add((await readFile(backupState.environment.PM_BACKUP_KEY_FILE, "utf8")).trim());
for (const file of ["target-database-password.txt", "service-key.txt", "database-url.txt", "apply/runtime-database-url.txt"]) {
	try {
		const value = (await readFile(`tmp/p3-05/recovery-cloud-8a60a0b7/${file}`, "utf8")).trim(); add(value);
		// The target URI may deliberately retain the connector's documented
		// placeholder; the actual generated password is scanned from its own file.
		let template = false;
		if (file === "database-url.txt") { try { template = ["[YOUR-PASSWORD]", "[YOUR_PASSWORD]", "YOUR_PASSWORD"].includes(decodeURIComponent(new URL(value).password)); } catch {} }
		if (!template) password(value);
	}
	catch (error) { if (error.code !== "ENOENT") throw error; }
}
for (const dir of await readdir("tmp/p3-05/recovery-cloud-8a60a0b7", { withFileTypes: true })) {
	if (!dir.isDirectory() || !/^apply-[a-f0-9]+$/.test(dir.name)) continue;
	try { const value = (await readFile(`tmp/p3-05/recovery-cloud-8a60a0b7/${dir.name}/runtime-database-url.txt`, "utf8")).trim(); add(value); password(value); }
	catch (error) { if (error.code !== "ENOENT") throw error; }
}
// Production preparation uses fresh credentials and an independent backup key.
for (const file of ["target-database-password.txt", "runtime-password.txt", "maintenance-password.txt", "service-key.txt", "database-url.txt", "source-session-url.txt"]) {
	try {
		const value = (await readFile(`tmp/p3-05/production/${file}`, "utf8")).trim(); add(value);
		let template = false;
		if (file.endsWith("url.txt")) { try { template = ["[YOUR-PASSWORD]", "[YOUR_PASSWORD]", "YOUR_PASSWORD"].includes(decodeURIComponent(new URL(value).password)); } catch {} }
		if (!template) password(value);
	} catch (error) { if (error.code !== "ENOENT") throw error; }
}
for (const file of ["tmp/maintenance-keys/production-v1/backup.backup-key", "tmp/p3-05/production/from-phone.backup-key"]) {
	try { add((await readFile(file, "utf8")).trim()); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
for (const file of ["environment.json", "maintenance-environment.json"]) {
	try {
		for (const [name, value] of Object.entries(JSON.parse(await readFile(`tmp/p3-05/production/${file}`, "utf8"))))
			if (!name.startsWith("NEXT_PUBLIC_") && /^(?:SUPABASE_SECRET_KEY|DATABASE_URL|EVENT_DATABASE_URL|WORKER_DATABASE_URL)$/.test(name)) { add(value); password(value); }
	} catch (error) { if (error.code !== "ENOENT") throw error; }
}
function collect(value, path = "") {
	if (!value || typeof value !== "object") return;
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === "string" && ((/cookies/.test(path) && (key === "value" || /^(pm_|sb-)/.test(key))) || /password|^token$|^secret$|shareUrl/i.test(key) || /\/s\/[A-Za-z0-9_-]{43}(?:$|[?#])/.test(entry))) { add(entry); if (entry.includes("/s/")) add(entry.split("/s/").at(-1)); }
		else collect(entry, `${path}/${key}`);
	}
}
for (const file of ["tmp/p0-4/fixture.json", "tmp/fix-c/3acb7520-5d8e-4c9e-9a10-e8450c5798bf/state.json", "tmp/p3-05/c82d9295-c010-4fd9-8a7d-e58c0c6d7cef/state.json", "tmp/p3-05/d700b91c-ea96-4114-8fad-d5f14f1b25b0/state.json", "tmp/p3-05/6f9372ed-0b29-460e-9740-dbc22fbd528e/state.json"]) collect(JSON.parse(await readFile(file, "utf8")));
const files = new Set(execFileSync("git", ["-c", "safe.directory=D:/PartMeasure", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean));
async function walk(dir) { for (const entry of await readdir(dir, { withFileTypes: true })) { const path = `${dir}/${entry.name}`; if (entry.isDirectory()) await walk(path); else files.add(path); } }
await walk("public"); await walk(".next/static");
let productionStaticScanned = false;
try {
	const state = JSON.parse(await readFile("tmp/p3-05/production/controller.json", "utf8"));
	if (state.productionBuildPassed) {
		const root = path.resolve(state.productionBuildRoot);
		if (path.dirname(root).toLowerCase() !== path.resolve("tmp").toLowerCase() || !/^production-build-[a-f0-9-]{36}$/.test(path.basename(root))) throw Error("UNAPPROVED_PRODUCTION_BUILD_SCAN_PATH");
		await walk(path.join(root, ".next/static").replaceAll("\\", "/")); productionStaticScanned = true;
	}
} catch (error) { if (error.code !== "ENOENT") throw error; }
const flagged = [];
for (const file of files) { const bytes = await readFile(file); if ([...needles].some(v => bytes.includes(Buffer.from(v))) || /sb_secret_[A-Za-z0-9_-]{16,}/.test(bytes.toString("utf8"))) flagged.push(file); }
const report = { checkedAt: new Date().toISOString(), status: flagged.length ? "FAIL" : "PASS", filesScanned: files.size, flaggedFiles: flagged, productionStaticScanned, scope: "Exact configured server keys, database/account passwords, known share URLs/tokens and Auth/Guest cookies, including new production credentials/key; tracked/unignored source/evidence plus all public assets and browser static bundles, including isolated production-configured build when available. No pixel OCR or historic Git scan." };
await writeFile("docs/evidence/p3-05/secret-audit.json", `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify(report)); if (flagged.length) process.exitCode = 1;
