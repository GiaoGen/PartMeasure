// Offline allowlisted source package. This command never calls Vercel or changes settings.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { releaseSource, sha256 } from "./fingerprint";
const source = releaseSource();
if ((await readFile(".next/BUILD_ID", "utf8")).trim() !== source.buildId) throw Error("BUILD_SOURCE_MISMATCH");
const files = [];
for (const file of source.files) {
	if (/^\.|(^|\/)(?:tmp|node_modules|backups|\.git)(\/|$)/.test(file.path)) throw Error("PRIVATE_PATH_REFUSED");
	const bytes = await readFile(file.path);
	if (sha256(bytes) !== file.sha256) throw Error("SOURCE_CHANGED");
	files.push({ file: file.path, data: bytes.toString("base64"), encoding: "base64" });
}
await mkdir("tmp/p3-05/preview", { recursive: true });
await writeFile("tmp/p3-05/preview/deploy-files.json", JSON.stringify(files));
const scope = {
	preparedAt: new Date().toISOString(), sourceDigest: source.digest, buildId: source.buildId,
	projectName: "partmeasure-staging", projectId: "prj_rf7HXAsGzV6khGK5hxPkadCKhhAC", target: "preview",
	fileCount: files.length, packageSha256: sha256(JSON.stringify(files)),
	include: "Explicit public application/build inputs only; fingerprint helper included for next.config import",
	exclude: "All .env/credentials/accounts/Guest cookies/capability links/private downloads/backups/.git/docs/test fixtures",
	requiredReadChecksBeforeDeploy: ["Confirm live project/team/environment ownership", "Verify Preview env points only at isolated rvysclscetfqicpnzlra and strict TLS", "No production assignment, new project, DNS/domain or migration changes"],
	maximumNewDeployments: 1, requestedConfigChanges: [],
	status: "PREPARED_NOT_DEPLOYED_NOT_YET_AUTHORIZED",
};
await writeFile("docs/evidence/p3-05/preview-scope.json", `${JSON.stringify(scope, null, 2)}\n`);
console.log(JSON.stringify(scope));
