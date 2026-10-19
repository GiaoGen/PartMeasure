// Explicit native HTTPS agents bypass HTTP proxy environment variables. No browser/DDL.
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { lookup } from "node:dns/promises";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import pg from "pg";

const project = "rvysclscetfqicpnzlra";
const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
if (url.hostname !== `${project}.supabase.co`) throw Error("WRONG_TEST_PROJECT");
const label = process.argv[2] ?? "before";
if (!["before", "after"].includes(label)) throw Error("INVALID_LABEL");
const report = {
	checkedAt: new Date().toISOString(),
	networkMode: "native-direct-https-and-pg",
	mainlandPhoneValidated: false,
	vpnTunState: "not-controlled-or-verified",
	results: [],
};
const safeCode = (error) => {
	if (/^[A-Z0-9_]{2,50}$/.test(error?.code ?? "")) return error.code;
	for (const cause of [error?.cause, ...(error?.errors ?? [])]) {
		if (/^[A-Z0-9_]{2,50}$/.test(cause?.code ?? "")) return cause.code;
	}
	const message = String(error?.message ?? "").toLowerCase();
	if (message.includes("timeout")) return "CONNECT_TIMEOUT";
	if (message.includes("terminated") || message.includes("ended unexpectedly")) return "CONNECTION_TERMINATED";
	if (message.includes("password") || message.includes("sasl")) return "AUTHENTICATION_FAILED";
	if (message.includes("certificate")) return "CERTIFICATE_VALIDATION_FAILED";
	if (message.includes("does not support ssl")) return "PG_SSL_NEGOTIATION_REJECTED";
	return "REQUEST_FAILED";
};
const round = (n) => Math.round(n * 10) / 10;
const agent = new https.Agent({ keepAlive: true, maxSockets: 2, rejectUnauthorized: true });
async function probePgTls(host, port, ca) {
	const start = performance.now();
	return new Promise(resolve => {
		let secured, settled = false;
		const socket = net.connect({ host, port });
		const finish = (result) => {
			if (settled) return; settled = true; clearTimeout(deadline);
			secured?.destroy(); socket.destroy();
			resolve({ name: "pg_starttls_no_credentials", elapsedMs: round(performance.now() - start), ...result });
		};
		const deadline = setTimeout(() => finish({ error: "PROBE_TIMEOUT" }), 10000);
		socket.once("connect", () => { const packet = Buffer.alloc(8); packet.writeInt32BE(8, 0); packet.writeInt32BE(80877103, 4); socket.write(packet); });
		socket.once("data", bytes => {
			if (bytes[0] !== 83) { finish({ error: bytes[0] === 78 ? "PG_SSL_NEGOTIATION_REJECTED" : "PG_UNEXPECTED_NEGOTIATION_RESPONSE" }); return; }
			secured = tls.connect({ socket, servername: host, ca, rejectUnauthorized: true });
			secured.once("secureConnect", () => finish({ status: "TLS_VERIFIED" }));
			secured.once("error", e => finish({ error: safeCode(e) }));
		});
		socket.once("error", e => finish({ error: safeCode(e) }));
		socket.once("end", () => finish({ error: "CONNECTION_TERMINATED" }));
	});
}
async function probe(name, target, headers = {}) {
	const start = performance.now();
	const phases = {};
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			clearTimeout(deadline);
			resolve({ name, ...result, elapsedMs: round(performance.now() - start), phases });
		};
		const req = https.get(target, { agent, headers }, (response) => {
			phases.headersMs = round(performance.now() - start);
			let bytes = 0;
			response.on("data", (chunk) => { bytes += chunk.length; });
			response.on("end", () => finish({ httpStatus: response.statusCode, bytes, reusedConnection: req.reusedSocket }));
			response.on("error", (e) => finish({ error: safeCode(e) }));
		});
		const deadline = setTimeout(() => { req.destroy(Object.assign(Error(), { code: "PROBE_TIMEOUT" })); }, 12000);
		req.on("socket", (socket) => {
			socket.once("lookup", () => { phases.dnsMs = round(performance.now() - start); });
			socket.once("connect", () => { phases.tcpMs = round(performance.now() - start); });
			socket.once("secureConnect", () => { phases.tlsMs = round(performance.now() - start); });
		});
		req.on("error", (e) => finish({ error: safeCode(e) }));
	});
}
try {
	const start = performance.now();
	try {
		const addresses = await lookup(url.hostname, { all: true });
		report.results.push({ name: "supabase_dns", elapsedMs: round(performance.now() - start), families: [...new Set(addresses.map((a) => a.family))] });
	} catch (e) { report.results.push({ name: "supabase_dns", error: safeCode(e) }); }
	for (let sample = 1; sample <= 2; sample++) {
		for (const [name, path] of [["auth_settings", "/auth/v1/settings"], ["rest_schema", "/rest/v1/"], ["storage_listing_without_user", "/storage/v1/bucket"]]) {
			report.results.push({ sample, ...await probe(name, new URL(path, url), { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }) });
		}
	}
	const storageOrigin = new URL(url.href.replace(".supabase.co", ".storage.supabase.co"));
	report.results.push(await probe("storage_dedicated_origin", new URL("/storage/v1/bucket", storageOrigin), { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }));
	report.results.push(await probe("tus_signed_route_without_upload_credential", new URL("/storage/v1/upload/resumable/sign", storageOrigin)));
	// Deployment transport only: this does not validate business functionality or its current source.
	report.results.push(await probe("existing_staging_login", "https://partmeasure-staging-em72unjso-messup-s-projects.vercel.app/login"));
	const dbUrl = new URL(process.env.DATABASE_URL);
	if (!decodeURIComponent(dbUrl.username).endsWith(`.${project}`) || !decodeURIComponent(dbUrl.username).startsWith("partmeasure_runtime")) throw Error("WRONG_RUNTIME_PROJECT");
	dbUrl.searchParams.delete("sslmode");
	const ca = process.env.DATABASE_CA_PEM || await readFile(process.env.DATABASE_CA_FILE, "utf8");
	report.results.push(await probePgTls(dbUrl.hostname, Number(dbUrl.port || 5432), ca));
	const pgDnsStart = performance.now();
	try {
		const addresses = await lookup(dbUrl.hostname, { all: true });
		report.results.push({ name: "pg_dns", elapsedMs: round(performance.now() - pgDnsStart), families: [...new Set(addresses.map(a => a.family))] });
	} catch (e) { report.results.push({ name: "pg_dns", error: safeCode(e) }); }
	const db = new pg.Client({ connectionString: dbUrl.href, ssl: { rejectUnauthorized: true, ca }, connectionTimeoutMillis: 10000, query_timeout: 10000 });
	try {
		let start = performance.now();
		await db.connect();
		report.results.push({ name: "pg_connect", elapsedMs: round(performance.now() - start) });
		for (let sample = 1; sample <= 3; sample++) {
			start = performance.now();
			await db.query("select 1");
			report.results.push({ name: "pg_select_1", sample, elapsedMs: round(performance.now() - start) });
		}
	} catch (e) { report.results.push({ name: "pg", error: safeCode(e), errorType: /^[A-Za-z]+$/.test(e?.name ?? "") ? e.name : "Error" }); }
	finally { await db.end().catch(() => {}); }
} finally {
	agent.destroy();
	await mkdir("docs/evidence/performance-s12", { recursive: true });
	await writeFile(`docs/evidence/performance-s12/transport-${label}.json`, `${JSON.stringify(report, null, 2)}\n`);
	await writeFile(`docs/evidence/performance-s12/transport-${label}-${Date.now()}.json`, `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report));
}
