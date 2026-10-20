// Exact configured secrets/capabilities only. Never print their values.
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
const needles = new Set();
const add = (v) => {
	if (typeof v === "string" && v.length >= 12) needles.add(v);
};
const password = (v) => {
	try {
		add(decodeURIComponent(new URL(v).password));
	} catch {}
};
for (const file of [".env.local", "tmp/performance-s34/events.env"]) {
	for (const line of (await readFile(file, "utf8")).split(/\r?\n/)) {
		const m = line.match(/^([^#=]+)=(.*)$/);
		if (!m || m[1].startsWith("NEXT_PUBLIC_")) continue;
		const v = m[2].replace(/^['"]|['"]$/g, "");
		if (/KEY|SECRET|DATABASE_URL/.test(m[1])) {
			add(v);
			password(v);
		}
	}
}
function collectSecrets(value, key = "") {
	if (typeof value === "string") {
		if (/password|shareUrl|secret|token/i.test(key)) {
			add(value);
			if (value.includes("/s/")) add(value.split("/s/")[1]);
		}
	} else if (value && typeof value === "object")
		for (const [k, v] of Object.entries(value)) collectSecrets(v, k);
}
for (const file of [
	"tmp/p0-1/test-accounts.json",
	"tmp/annotation-collaboration/fixture.json",
	"tmp/lightweight/fixture.json",
	"tmp/p0-1/business-fixtures.json",
	"tmp/p0-2/fixture.json",
	"tmp/p0-3/fixture.json",
	"tmp/p0-4/fixture.json",
	"tmp/performance-s34/fixture.json",
	"tmp/performance-s5/fixture.json",
]) {
	try {
		collectSecrets(JSON.parse(await readFile(file, "utf8")));
	} catch (e) {
		if (e.code !== "ENOENT") throw e;
	}
}
for (const name of ["secret-key.txt", "admin-database-url.txt"]) {
	const v = (await readFile(`tmp/p0-1/${name}`, "utf8")).trim();
	add(v);
	password(v);
}
const files = [
	...new Set(
		execFileSync(
			"git",
			["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
			{
				encoding: "utf8",
			},
		)
			.split("\0")
			.filter(Boolean),
	),
];
async function walk(dir) {
	for (const e of await readdir(dir, { withFileTypes: true })) {
		const p = `${dir}/${e.name}`;
		if (e.isDirectory()) await walk(p);
		else files.push(p);
	}
}
await walk(".next/static");
const flagged = [];
for (const file of files) {
	const bytes = await readFile(file).catch((e) => {
		if (e.code === "ENOENT") return null;
		throw e;
	});
	if (!bytes) continue;
	if (
		[...needles].some((v) => bytes.includes(Buffer.from(v))) ||
		/sb_secret_[A-Za-z0-9_-]{16,}/.test(bytes.toString())
	)
		flagged.push(file);
}
const report = {
	checkedAt: new Date().toISOString(),
	status: flagged.length ? "FAIL" : "PASS",
	filesScanned: files.length,
	flaggedFiles: flagged,
	scope:
		"Configured keys, DB/account passwords and known fixture capabilities; tracked/unignored sources and browser static bundle. Not history, screenshots or unknown secrets.",
};
await writeFile(
	"docs/evidence/annotation-collaboration/secret-audit.json",
	`${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report));
if (flagged.length) process.exitCode = 1;
