// Offline inventory only. No database, Auth, Storage or deployment requests.
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import nextEnv from "@next/env";
import { fileManifest, releaseSource, sha256 } from "./fingerprint";

nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const git = (...args: string[]) => execFileSync("git", ["-c", `safe.directory=${process.cwd().replaceAll("\\", "/")}`, ...args], { encoding: "utf8", windowsHide: true }).trim();
const source = releaseSource();
const migrations = fileManifest(["supabase/migrations"]);
const validation = fileManifest(["tests", "scripts/release", "playwright.config.ts", "vitest.config.ts", "biome.json", ".env.example"]);
const configured = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
	/^(NEXT_PUBLIC_SUPABASE_|SUPABASE_|DATABASE_|EVENT_DATABASE_|WORKER_|APP_URL$|PM_|VERCEL|NODE_EXTRA_CA_CERTS$|NODE_USE_ENV_PROXY$|NODE_TLS_REJECT_UNAUTHORIZED$)/.test(key),
).sort(([a], [b]) => a.localeCompare(b)));
let buildId: string | null = null;
try { buildId = (await readFile(".next/BUILD_ID", "utf8")).trim(); } catch { /* Not built yet. */ }
const evidence = {
	recordedAt: new Date().toISOString(), baseline: git("rev-parse", "96c1b82"), head: git("rev-parse", "HEAD"),
	gitStatus: git("status", "--porcelain=v1"), node: process.versions.node, npm: execFileSync("cmd.exe", ["/d", "/s", "/c", "npm --version"], { encoding: "utf8", windowsHide: true }).trim(),
	source, validation: { digest: sha256(JSON.stringify(validation)), files: validation },
	lockSha256: sha256(await readFile("package-lock.json")), migrations: { digest: sha256(JSON.stringify(migrations)), files: migrations },
	build: { id: buildId, matchesSource: buildId === source.buildId },
	environment: {
		kind: "local production build/runtime; remote state must be verified separately",
		configuredKeys: Object.keys(configured), configurationSha256: sha256(JSON.stringify(configured)),
		appOrigin: new URL(process.env.APP_URL ?? "http://invalid").origin,
		supabaseOrigin: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid").origin,
		strictTls: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
		caSha256: process.env.DATABASE_CA_FILE ? sha256(await readFile(process.env.DATABASE_CA_FILE)) : null,
		networkSettingsChanged: false, proxyTunAbsenceCertified: false,
	},
};
await mkdir("docs/evidence/p3-05", { recursive: true });
const path = `docs/evidence/p3-05/candidate-${source.digest.slice(0, 20)}.json`;
await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ path, head: evidence.head, sourceDigest: source.digest, build: evidence.build, migrationCount: migrations.length }));
