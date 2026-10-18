import { readFile } from "node:fs/promises";
import {
	context,
	call,
	requireData,
	saveReport,
	safeCode,
} from "./helpers.mjs";
const f = JSON.parse(await readFile("tmp/p0-4/fixture.json", "utf8")),
	a = await context("A"),
	samples = [];
try {
	for (let n = 0; n < 12; n++) {
		const started = Date.now();
		try {
			requireData(await call(a, `/api/projects/${f.projectA}/deliveries`));
			samples.push({
				sample: n + 1,
				status: "PASS",
				elapsedMs: Date.now() - started,
			});
		} catch (e) {
			samples.push({
				sample: n + 1,
				status: "FAIL",
				code: safeCode(e),
				elapsedMs: Date.now() - started,
			});
		}
		await new Promise((r) => setTimeout(r, 3000));
	}
} finally {
	await a.dispose();
}
await saveReport("soak", samples, {
	limitedObservation: true,
	longTermStabilityProven: false,
});
console.log(
	JSON.stringify({
		pass: samples.filter((s) => s.status === "PASS").length,
		total: samples.length,
	}),
);
if (samples.some((s) => s.status === "FAIL")) process.exitCode = 1;
