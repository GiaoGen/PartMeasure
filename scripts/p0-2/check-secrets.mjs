// Reports filenames only; never prints configured values. Screenshots need separate visual review.
import { execFileSync } from "node:child_process";
import { readFile, writeFile, readdir } from "node:fs/promises";
const needles = new Set(),
	add = (v) => {
		if (typeof v === "string" && v.length >= 12) needles.add(v);
	};
const parseUrl = (v) => {
	try {
		const pass = decodeURIComponent(new URL(v).password);
		add(pass);
		if (pass.startsWith("[") && pass.endsWith("]")) add(pass.slice(1, -1));
	} catch {}
};
for (const file of [".env.local", "tmp/p0-1/generated-env.local"])
	for (const line of (await readFile(file, "utf8")).split(/\r?\n/)) {
		const m = line.match(/^([^#=]+)=(.*)$/);
		if (!m || m[1].startsWith("NEXT_PUBLIC_")) continue;
		const value = m[2].replace(/^['"]|['"]$/g, "");
		if (/KEY|SECRET|DATABASE_URL/.test(m[1])) {
			add(value);
			if (m[1].includes("DATABASE_URL")) parseUrl(value);
		}
	}
for (const file of ["secret-key.txt", "admin-database-url.txt"]) {
	const v = (await readFile(`tmp/p0-1/${file}`, "utf8")).trim();
	add(v);
	parseUrl(v);
}
for (const account of Object.values(
	JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8")),
))
	add(account.password);
for (const file of [
	"tmp/p0-1/business-fixtures.json",
	"tmp/p0-2/fixture.json",
]) {
	const f = JSON.parse(await readFile(file, "utf8"));
	add(f.shareUrl);
	add(f.shareUrl?.split("/").pop());
}
const files = [
	...new Set(
		execFileSync(
			"git",
			[
				"-c",
				"safe.directory=D:/PartMeasure",
				"ls-files",
				"--cached",
				"--others",
				"--exclude-standard",
				"-z",
			],
			{ encoding: "utf8" },
		)
			.split("\0")
			.filter(Boolean),
	),
];
async function collect(dir) {
	for (const f of await readdir(dir, { withFileTypes: true })) {
		const p = `${dir}/${f.name}`;
		if (f.isDirectory()) await collect(p);
		else files.push(p);
	}
}
await collect(".next/static");
const flagged = [];
for (const file of files) {
	const bytes = await readFile(file);
	if (
		[...needles].some((v) => bytes.includes(Buffer.from(v))) ||
		/sb_secret_[A-Za-z0-9_-]{16,}/.test(bytes.toString("utf8"))
	)
		flagged.push(file);
}
const report = {
	checkedAt: new Date().toISOString(),
	status: flagged.length ? "FAIL" : "PASS",
	filesScanned: files.length,
	flaggedFiles: flagged,
	scope:
		"Exact configured keys/database passwords/account passwords/current P0-1 and P0-2 share capability; sb_secret pattern; tracked and unignored files plus browser static bundle. Not historical scanning or pixel OCR.",
};
await writeFile(
	"docs/evidence/p0-2/secret-audit.json",
	`${JSON.stringify(report, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(report)}\n`);
if (flagged.length) process.exitCode = 1;
