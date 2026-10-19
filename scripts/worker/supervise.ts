// Linux systemd entrypoint, no containers. A failed safety preflight never starts work.
import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { signatureHeader, loadedSignatureVersion } from "../../src/lib/worker-signatures";
const cleanupOnly = process.argv.includes("--cleanup-only");
const flags = ["--cleanup-only", "--backfill-only", "--once"].filter((flag) =>
	process.argv.includes(flag),
);
if (
	new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid").hostname !==
	"rvysclscetfqicpnzlra.supabase.co"
)
	throw Error("WRONG_ISOLATED_PROJECT");
if (process.env.CLAMD_HOST !== "127.0.0.1") throw Error("SCANNER_MUST_BE_LOOPBACK");
for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NODE_USE_ENV_PROXY"])
	delete process.env[name];
process.env.NODE_USE_ENV_PROXY = "0";
process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS ?? "")
	.replace(/(?<!\S)--use-env-proxy(?=\s|$)/g, "")
	.trim();
// Only the hosted unit with its cleanup.timer may opt out of standalone sweeps.
process.env.PM_WORKER_EXTERNAL_CLEANUP ??= "0";
async function health() {
	const folder = process.env.CLAMAV_DB_DIR;
	if (!folder) throw Error("SCANNER_SIGNATURES_NOT_CONFIGURED");
	let expected: number | undefined;
	for (const name of ["daily.cld", "daily.cvd"]) {
		try {
			const file = await open(path.join(folder, name), "r");
			const bytes = Buffer.alloc(512);
			try {
				await file.read(bytes, 0, 512, 0);
			} finally {
				await file.close();
			}
			const info = signatureHeader(bytes.toString());
			expected = Math.max(expected ?? 0, info.version);
		} catch {
			/* A stale sibling does not override a fresh updated daily database. */
		}
	}
	if (expected === undefined) throw Error("SCANNER_SIGNATURES_STALE");
	const reply = await new Promise<string>((resolve, reject) => {
		const socket = net.connect({
			host: "127.0.0.1",
			port: Number(process.env.CLAMD_PORT ?? 3310),
		});
		let data = "";
		socket.setTimeout(5000, () => socket.destroy(Error("SCANNER_UNAVAILABLE")));
		socket.once("connect", () => socket.write("zVERSION\0"));
		socket.on("data", (chunk) => {
			data += chunk.toString();
			if (data.includes("\0")) {
				socket.end();
				resolve(data);
			}
			if (data.length > 512) socket.destroy(Error("SCANNER_PROTOCOL"));
		});
		socket.once("error", () => reject(Error("SCANNER_UNAVAILABLE")));
		socket.once("end", () => resolve(data));
	});
	loadedSignatureVersion(reply, expected);
}
try {
	if (!cleanupOnly) await health();
	const child = spawn(
		process.execPath,
		["--conditions=react-server", "--import", "tsx", "scripts/p0-1/worker.ts", ...flags],
		{ env: process.env, stdio: "inherit" },
	);
	let failed = false,
		checking = false;
	const timer = cleanupOnly
		? undefined
		: setInterval(() => {
				if (checking) return;
				checking = true;
				void health()
					.catch(() => {
						failed = true;
						process.stderr.write("WORKER_SAFETY_PREFLIGHT_FAILED\n");
						child.kill("SIGKILL");
					})
					.finally(() => {
						checking = false;
					});
			}, 60000);
	const stop = () => child.kill("SIGTERM");
	process.on("SIGTERM", stop);
	process.on("SIGINT", stop);
	const exit = await new Promise<number>((resolve) => {
		child.once("error", () => resolve(1));
		child.once("exit", (code) => resolve(code ?? 1));
	});
	clearInterval(timer);
	process.removeListener("SIGTERM", stop);
	process.removeListener("SIGINT", stop);
	process.exitCode = failed ? 1 : exit;
} catch {
	process.stderr.write(
		"WORKER_SAFETY_PREFLIGHT_FAILED (configuration, signatures or scanner; details redacted)\n",
	);
	process.exitCode = 1;
}
