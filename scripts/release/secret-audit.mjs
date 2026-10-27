// Exact local-secret comparison. Outputs paths/counts only; never prints a secret.
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
const needles = new Set();
const add = value => { if (typeof value === "string" && value.length >= 12) needles.add(value); };
function password(raw) { try { const v = decodeURIComponent(new URL(raw).password); add(v); if (v.startsWith("[") && v.endsWith("]")) add(v.slice(1, -1)); } catch {} }
for (const line of (await readFile(".env.local", "utf8")).split(/\r?\n/)) {
	const m = line.match(/^([^#=]+)=(.*)$/); if (!m || m[1].startsWith("NEXT_PUBLIC_")) continue;
	if (/KEY|SECRET|DATABASE_URL/.test(m[1]) && !/_(FILE|PATH|DIRECTORY|BIN)$/.test(m[1])) { const value = m[2].replace(/^['"]|['"]$/g, ""); add(value); password(value); }
}
for (const file of ["secret-key.txt", "admin-database-url.txt"]) { const value = (await readFile(`tmp/p0-1/${file}`, "utf8")).trim(); add(value); password(value); }
for (const account of Object.values(JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8")))) add(account.password);
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
const flagged = [];
for (const file of files) { const bytes = await readFile(file); if ([...needles].some(v => bytes.includes(Buffer.from(v))) || /sb_secret_[A-Za-z0-9_-]{16,}/.test(bytes.toString("utf8"))) flagged.push(file); }
const report = { checkedAt: new Date().toISOString(), status: flagged.length ? "FAIL" : "PASS", filesScanned: files.size, flaggedFiles: flagged, scope: "Exact configured server keys, database/account passwords, known share URLs/tokens and Auth/Guest cookies; tracked/unignored source/evidence plus all public assets and browser static bundles. No pixel OCR or historic Git scan." };
await writeFile("docs/evidence/p3-05/secret-audit.json", `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify(report)); if (flagged.length) process.exitCode = 1;
