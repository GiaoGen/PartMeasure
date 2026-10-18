// Reuse the established exact-secret scan without changing prior-stage evidence.
import { readFile, writeFile } from "node:fs/promises";
const extra = [
	"tmp/p0-3/fixture.json",
	"tmp/p0-4/fixture.json",
	"tmp/p0-4/browser-fixture.json",
	"tmp/p0-4/local-api-fixture.json",
	"tmp/p0-4/local-browser-fixture.json",
];
let source = await readFile("scripts/p0-2/check-secrets.mjs", "utf8");
source = source
	.replace(
		'"tmp/p0-2/fixture.json",',
		`"tmp/p0-2/fixture.json",\n${extra.map((p) => `${JSON.stringify(p)},`).join("\n")}`,
	)
	.replace(
		'"docs/evidence/p0-2/secret-audit.json"',
		'"docs/evidence/p0-4/secret-audit.json"',
	)
	.replace(
		"current P0-1 and P0-2 share capability",
		"current P0-1 through P0-4 local/HTTPS share capabilities",
	);
const path = "tmp/p0-4/secret-scanner.mjs";
await writeFile(path, source);
await import(`../../${path}`);
