// Only reviewed application roots. Never bundle local configuration, worker credentials or fixtures.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const audit = JSON.parse(
	readFileSync("docs/evidence/performance-s34/secret-audit.json", "utf8"),
);
if (audit.status !== "PASS" || Date.now() - Date.parse(audit.checkedAt) > 300000)
	throw Error("RECENT_SECRET_AUDIT_REQUIRED");
const roots = [
		"src",
		"package.json",
		"package-lock.json",
		"next.config.ts",
		"tsconfig.json",
		"postcss.config.mjs",
		"next-env.d.ts",
		"vercel.json",
	],
	files = [];
function add(p) {
	if (statSync(p).isDirectory()) for (const n of readdirSync(p)) add(`${p}/${n}`);
	else files.push({ file: p, data: readFileSync(p).toString("base64"), encoding: "base64" });
}
for (const root of roots) add(root);
writeFileSync("tmp/performance-s34/deploy-files.json", JSON.stringify(files));
writeFileSync(
	"docs/evidence/performance-s34/deploy-manifest.json",
	JSON.stringify(
		{
			preparedAt: new Date().toISOString(),
			project: "prj_rf7HXAsGzV6khGK5hxPkadCKhhAC",
			target: "staging",
			region: "hnd1",
			files: files.map((f) => ({
				path: f.file,
				sha256: createHash("sha256").update(Buffer.from(f.data, "base64")).digest("hex"),
			})),
			excludes: [".env*", "tmp", "docs", ".git", "worker configuration"],
			secretAudit: "secret-audit.json",
			status: "PREPARED_NOT_DEPLOYED",
		},
		null,
		2,
	),
);
console.log(JSON.stringify({ files: files.length, bytes: JSON.stringify(files).length }));
