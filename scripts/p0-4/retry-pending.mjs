// Only retry the independent failed owner-material fixture through the normal API.
import { readFile } from "node:fs/promises";
import { context, call, requireData } from "./helpers.mjs";
const f = JSON.parse(await readFile("tmp/p0-4/fixture.json", "utf8")),
	a = await context("A");
let retried = 0;
try {
	const base = `/api/projects/${f.projectA}`;
	for (const r of requireData(await call(a, `${base}/uploads`)).items) {
		if (r.errorCode === "PG_42501") {
			requireData(
				await call(a, `${base}/uploads/${r.id}/retry`, "POST", {}),
				202,
			);
			retried++;
		}
	}
} finally {
	await a.dispose();
}
console.log({ retried });
