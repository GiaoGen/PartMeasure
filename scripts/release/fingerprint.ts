import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";

export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function fileManifest(roots: string[]) {
	const files: string[] = [];
	function add(path: string) {
		if (statSync(path).isDirectory()) {
			for (const entry of readdirSync(path).sort()) add(`${path}/${entry}`);
		} else files.push(path);
	}
	for (const root of roots) add(root);
	return [...new Set(files)].sort().map(path => ({ path, sha256: sha256(readFileSync(path)) }));
}
/** Explicit deployable inputs only. Never include .env, private evidence, accounts or capability URLs. */
export function releaseSource() {
	const files = fileManifest(["src", "public", "package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs", "vercel.json", "scripts/build-cv.mjs", "scripts/release/fingerprint.ts"]);
	const digest = sha256(JSON.stringify(files));
	return { digest, buildId: `p3-05-${digest.slice(0, 20)}`, files };
}
