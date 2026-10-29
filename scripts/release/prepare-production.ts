// Builds an allowlisted public source copy with the verified production environment.
// No deployment, cloud mutation, dependency install or overwrite of the original .next.
import assert from "node:assert/strict";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { privateDirectory } from "../maintenance/private-directory";
import { releaseSource, sha256 } from "./fingerprint";

async function main() {
	const workspace = process.cwd(), privateRoot = path.resolve("tmp/p3-05/production");
	const state = JSON.parse(await readFile(path.join(privateRoot, "controller.json"), "utf8")); assert.equal(state.verified, true);
	const source = releaseSource(); assert.equal(source.digest, "cebeecad8acca20add7735a4a68756949faaa0207e8a97e50f5f4548907ec0f2"); assert.equal(source.files.length, 219);
	assert.equal((await readFile(".next/BUILD_ID", "utf8")).trim(), source.buildId);
	const buildRoot = path.resolve("tmp", `production-build-${randomUUID()}`); await privateDirectory(buildRoot);
	for (const input of source.files) {
		assert.ok(!/^\.|(^|\/)(?:tmp|node_modules|backups|\.git)(\/|$)/.test(input.path));
		const bytes = await readFile(input.path); assert.equal(sha256(bytes), input.sha256);
		await mkdir(path.dirname(path.join(buildRoot, input.path)), { recursive: true }); await writeFile(path.join(buildRoot, input.path), bytes, { flag: "wx", mode: 0o600 });
	}
	await symlink(path.resolve("node_modules"), path.join(buildRoot, "node_modules"), process.platform === "win32" ? "junction" : "dir");
	const environment = JSON.parse(await readFile(path.join(privateRoot, "environment.json"), "utf8"));
	assert.equal(environment.NEXT_PUBLIC_SUPABASE_URL, "https://qjiifweyhahowjdluqys.supabase.co");
	const env: NodeJS.ProcessEnv = { ...process.env, ...environment, NODE_ENV: "production", VERCEL_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" };
	delete env.VERCEL; delete env.VERCEL_URL; delete env.PM_EVENTS_LOCAL;
	state.productionBuildRoot = buildRoot; state.productionBuildPassed = false; await writeFile(path.join(privateRoot, "controller.json"), JSON.stringify(state), { mode: 0o600 });
	async function command(args: string[], phase: string) {
		console.log(JSON.stringify({ event: "production_build", phase }));
		const log = createWriteStream(path.join(buildRoot, `${phase}.log`), { flags: "wx", mode: 0o600 });
		try {
			const child = spawn(process.execPath, args, { cwd: buildRoot, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], signal: AbortSignal.timeout(10 * 60 * 1000) });
			child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
			const code = await new Promise<number | null>((resolve, reject) => { child.once("error", () => reject(Error("PRODUCTION_BUILD_PROCESS_FAILED"))); child.once("close", resolve); });
			assert.equal(code, 0, "PRODUCTION_BUILD_FAILED");
		} finally { log.end(); await finished(log); }
	}
	await command(["scripts/build-cv.mjs"], "cv");
	await command([path.join(workspace, "node_modules/next/dist/bin/next"), "build", "--webpack"], "next");
	assert.equal((await readFile(path.join(buildRoot, ".next/BUILD_ID"), "utf8")).trim(), source.buildId);
	for (const file of source.files) assert.equal(sha256(await readFile(path.join(buildRoot, file.path))), file.sha256, "ISOLATED_BUILD_CHANGED_PUBLIC_INPUT");
	assert.equal(releaseSource().digest, source.digest, "WORKSPACE_SOURCE_CHANGED_DURING_BUILD");
	const files = await Promise.all(source.files.map(async input => ({ file: input.path, data: (await readFile(input.path)).toString("base64"), encoding: "base64" })));
	await writeFile(path.join(privateRoot, "deploy-files.json"), JSON.stringify(files), { flag: "wx", mode: 0o600 });
	const providerConfig = { ...JSON.parse(await readFile("vercel.json", "utf8")), name: "partmeasure-production" };
	const hostedFiles = source.files.map(f => f.path === "vercel.json" ? { ...f, sha256: sha256(JSON.stringify(providerConfig)) } : f);
	const expectedHostedDigest = sha256(JSON.stringify(hostedFiles));
	state.productionBuildPassed = true; state.productionEnvironmentWritten = true; await writeFile(path.join(privateRoot, "controller.json"), JSON.stringify(state), { mode: 0o600 });
	const report = { preparedAt: new Date().toISOString(), status: "PREPARED_NOT_DEPLOYED_FINAL_APPROVAL_REQUIRED", applicationCommit: "8100204baec13d092eb3bbe58ef06e6e6af2d67e", worktreeHead: execFileSync("git", ["-c", "safe.directory=D:/PartMeasure", "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), sourceDigest: source.digest, buildId: source.buildId,
		projectName: "partmeasure-production", projectId: "prj_Tk3LzDCt2iLIfObnwVyPajjbiX61", teamId: "team_HdERlM3ZEizexkGrjPNJ8sZq", target: "production", origin: "https://partmeasure-production.vercel.app", supabaseRef: "qjiifweyhahowjdluqys",
		fileCount: files.length, packageSha256: sha256(JSON.stringify(files)), expectedHostedDigest, expectedHostedBuildId: `p3-05-${expectedHostedDigest.slice(0, 20)}`, expectedTransformation: "Only deterministic Vercel project-name injection and compact serialization in vercel.json; must compare actual build logs and health before acceptance.",
		productionConfiguredLocalBuild: "PASS in separate private directory; original .next retained", dependencyInstall: false, maximumNewDeployments: 1,
		excluded: "All .env, credentials, backup keys, docs, private fixtures, test users/files, node_modules and .git", sourceFiles: source.files, changesRequested: "None yet; deployment requires separate explicit final approval. No Git connection/push, domain/DNS, schema, email or resource changes." };
	await writeFile("docs/evidence/p3-05/production-deployment-scope.json", `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify({ status: report.status, productionConfiguredLocalBuild: "PASS", sourceDigest: source.digest, fileCount: files.length, expectedHostedBuildId: report.expectedHostedBuildId, deploymentCreated: false }));
}
main().catch(() => { console.error(JSON.stringify({ status: "NOT_PASSED", code: "PRODUCTION_BUILD_PREPARATION_FAILED", privateLogsOnly: true, deploymentCreated: false })); process.exitCode = 1; });
