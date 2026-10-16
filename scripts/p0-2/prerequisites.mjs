import { readFile, writeFile, mkdir } from "node:fs/promises";
import { request } from "@playwright/test";
const root = "http://127.0.0.1:3000",
	results = [],
	contexts = [];
await mkdir("tmp/p0-2", { recursive: true });
await mkdir("docs/evidence/p0-2", { recursive: true });
const accounts = JSON.parse(
	await readFile("tmp/p0-1/test-accounts.json", "utf8"),
);
const fixture = JSON.parse(
	await readFile("tmp/p0-1/business-fixtures.json", "utf8"),
);
async function post(c, path, data) {
	const csrf = await (await c.get("/api/csrf")).json();
	return c.post(path, {
		data,
		headers: { origin: root, "x-csrf-token": csrf.data.token },
	});
}
try {
	for (const actor of ["A", "B"]) {
		const c = await request.newContext({ baseURL: root, timeout: 60000 });
		contexts.push(c);
		const r = await post(c, "/api/auth/login", accounts[actor]);
		results.push({
			check: `${actor}-real-password-login`,
			status: r.ok() ? "PASS" : "FAIL",
			http: r.status(),
		});
		if (!r.ok()) throw new Error("AUTH_PREREQUISITE");
		await c.storageState({ path: `tmp/p0-2/owner-${actor}.json` });
	}
	const [a, b] = contexts;
	for (const [check, c, path, expected] of [
		["owner-project", a, `/api/projects/${fixture.projectA}`, 200],
		["other-owner-denied", b, `/api/projects/${fixture.projectA}`, 404],
		[
			"owner-private-image",
			a,
			`/api/projects/${fixture.projectA}/files/${fixture.ownerFile}/preview`,
			200,
		],
	]) {
		const r = await c.get(path);
		results.push({
			check,
			status: r.status() === expected ? "PASS" : "FAIL",
			http: r.status(),
		});
	}
	const g = await request.newContext({ baseURL: root, timeout: 60000 });
	contexts.push(g);
	const r = await post(g, "/api/guest/session", {
		token: fixture.shareUrl.split("/").pop(),
	});
	results.push({
		check: "guest-capability-bootstrap",
		status: r.ok() ? "PASS" : "FAIL",
		http: r.status(),
	});
	for (const [check, path] of [
		["guest-project", `/api/guest/projects/${fixture.projectA}`],
		[
			"guest-private-image",
			`/api/guest/projects/${fixture.projectA}/files/${fixture.ownerFile}/preview`,
		],
	]) {
		const r = await g.get(path);
		results.push({ check, status: r.ok() ? "PASS" : "FAIL", http: r.status() });
	}
	await g.storageState({ path: "tmp/p0-2/guest.json" });
} catch {
	results.push({ check: "prerequisite-run", status: "FAIL" });
} finally {
	await Promise.all(contexts.map((c) => c.dispose()));
}
await writeFile(
	"docs/evidence/p0-2/prerequisites.json",
	`${JSON.stringify({ checkedAt: new Date().toISOString(), projectRef: "rvysclscetfqicpnzlra", otp: "USER_DEFERRED_NOT_TESTED", results }, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(results)}\n`);
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
