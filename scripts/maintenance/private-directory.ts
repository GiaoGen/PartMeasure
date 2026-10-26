import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

export async function privateDirectory(directory: string) {
	await mkdir(directory, { recursive: false, mode: 0o700 });
	await restrictDirectory(directory);
}
export async function restrictDirectory(directory: string) {
	if (process.platform !== "win32") {
		const { chmod } = await import("node:fs/promises"); await chmod(directory, 0o700); return;
	}
	// Node's mode bits do not restrict inherited Windows ACLs. Apply a DACL only
	// to this dedicated maintenance directory; never change its workspace parent.
	const identity = spawnSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { windowsHide: true, encoding: "utf8", timeout: 5000, maxBuffer: 8192 });
	const sid = identity.status === 0 ? identity.stdout.match(/S-1-[0-9-]+/)?.[0] : undefined;
	if (!sid) throw Error("PRIVATE_DIRECTORY_IDENTITY_FAILED");
	const changed = spawnSync("icacls.exe", [path.resolve(directory), "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F", "/Q"], { windowsHide: true, timeout: 5000, stdio: "ignore" });
	if (changed.status !== 0) throw Error("PRIVATE_DIRECTORY_PERMISSIONS_FAILED");
}
