import { readFile, writeFile } from "node:fs/promises";
import { context, call } from "./helpers.mjs";
const fixture = JSON.parse(await readFile("tmp/p0-2/fixture.json", "utf8")),
	a = await context("A"),
	results = [];
try {
	for (const [kind, file] of [
		["image", fixture.image],
		["attachment", fixture.attachment],
	]) {
		const r = await call(
			a,
			`/api/projects/${fixture.projectA}/files/${file}`,
			"DELETE",
		);
		results.push({
			check: `history-protection-${kind}`,
			status:
				r.status === 409 && r.code === "HISTORY_PROTECTED" ? "PASS" : "FAIL",
			http: r.status,
			code: r.code,
		});
	}
} finally {
	await a.dispose();
}
await writeFile(
	"docs/evidence/p0-2/history-targeted.json",
	`${JSON.stringify({ checkedAt: new Date().toISOString(), realService: true, results }, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(results)}\n`);
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
