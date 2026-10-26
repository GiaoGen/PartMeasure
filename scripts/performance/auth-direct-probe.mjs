// Explicit native HTTPS and Node fetch, no login credentials, no proxy configuration changes.
import https from "node:https";
import { lookup, Resolver } from "node:dns/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import tls from "node:tls";
const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid");
if (origin.hostname !== "rvysclscetfqicpnzlra.supabase.co") throw Error("ISOLATED_PROJECT_ONLY");
const errors = error => {
	const list = [];
	const visit = (value, depth = 0) => {
		if (!value || depth > 5) return;
		if (/^[A-Z0-9_]{2,60}$/.test(value.code ?? "")) list.push(value.code);
		if (/^[A-Za-z]{2,50}$/.test(value.name ?? "")) list.push(value.name);
		visit(value.cause, depth + 1);
		for (const child of value.errors ?? []) visit(child, depth + 1);
	};
	visit(error); return [...new Set(list)];
};
const results = [];
const resolver = new Resolver({ timeout: 2000, tries: 1 });
async function dns(name, action) {
	const start = performance.now();
	try { const values = await action(); results.push({ name, ms: Math.round(performance.now() - start), values }); }
	catch (error) { results.push({ name, errors: errors(error) }); }
}
await Promise.all([
	dns("os_lookup", () => lookup(origin.hostname, { all: true })),
	dns("resolver_a", () => resolver.resolve4(origin.hostname)),
	dns("resolver_aaaa", () => resolver.resolve6(origin.hostname)),
]);
const headers = { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "" };
function native(family, path = "/auth/v1/settings", label = `native_https_family_${family}`) {
	const start = performance.now(), phases = {};
	return new Promise(resolve => {
		const agent = new https.Agent({ family, rejectUnauthorized: true });
		const request = https.get(new URL(path, origin), { agent, headers }, response => {
			phases.headersMs = Math.round(performance.now() - start);
			response.resume();
			response.once("end", () => finish({ httpStatus: response.statusCode }));
			response.once("error", error => finish({ errors: errors(error) }));
		});
		let done = false;
		const timer = setTimeout(() => request.destroy(Object.assign(Error(), { code: "PROBE_TIMEOUT" })), 12000);
		const finish = extra => {
			if (done) return; done = true; clearTimeout(timer); agent.destroy();
			resolve({ name: label, ms: Math.round(performance.now() - start), phases, ...extra });
		};
		request.once("socket", socket => {
			socket.once("lookup", () => { phases.dnsMs = Math.round(performance.now() - start); });
			socket.once("connect", () => { phases.tcpMs = Math.round(performance.now() - start); });
			socket.once("secureConnect", () => { phases.tlsMs = Math.round(performance.now() - start); });
		});
		request.once("error", error => finish({ errors: errors(error) }));
	});
}
async function nodeFetch() {
	const start = performance.now();
	try {
		const response = await fetch(new URL("/auth/v1/settings", origin), { headers, signal: AbortSignal.timeout(15000) });
		await response.arrayBuffer();
		return { name: "node_fetch", httpStatus: response.status, ms: Math.round(performance.now() - start) };
	} catch (error) { return { name: "node_fetch", ms: Math.round(performance.now() - start), errors: errors(error) }; }
}
async function databaseTls() {
	if (!process.env.DATABASE_URL) return { name: "database_tls", skipped: "NOT_CONFIGURED" };
	const url = new URL(process.env.DATABASE_URL);
	if (!decodeURIComponent(url.username).endsWith(".rvysclscetfqicpnzlra")) throw Error("ISOLATED_DATABASE_ONLY");
	const ca = process.env.DATABASE_CA_PEM || (process.env.DATABASE_CA_FILE ? await readFile(process.env.DATABASE_CA_FILE, "utf8") : undefined);
	const start = performance.now(), phases = {};
	return new Promise(resolve => {
		let secured, done = false;
		const socket = net.connect({ host: url.hostname, port: Number(url.port || 5432) });
		const timer = setTimeout(() => finish({ errors: ["PROBE_TIMEOUT"] }), 12000);
		const finish = extra => {
			if (done) return; done = true; clearTimeout(timer); secured?.destroy(); socket.destroy();
			resolve({ name: "database_tls_no_credentials", ms: Math.round(performance.now() - start), phases, ...extra });
		};
		socket.once("connect", () => {
			phases.tcpMs = Math.round(performance.now() - start);
			const packet = Buffer.alloc(8); packet.writeInt32BE(8, 0); packet.writeInt32BE(80877103, 4); socket.write(packet);
		});
		socket.once("data", bytes => {
			if (bytes[0] !== 83) { finish({ errors: ["PG_TLS_NEGOTIATION_FAILED"] }); return; }
			secured = tls.connect({ socket, servername: url.hostname, rejectUnauthorized: true, ...(ca ? { ca } : {}) });
			secured.once("secureConnect", () => finish({ status: "TLS_VERIFIED" }));
			secured.once("error", error => finish({ errors: errors(error) }));
		});
		socket.once("error", error => finish({ errors: errors(error) }));
		socket.once("end", () => finish({ errors: ["CONNECTION_CLOSED"] }));
	});
}
console.log("Checking Auth, Storage and database TLS; no login or business writes...");
results.push(...await Promise.all([native(0), native(4), nodeFetch(), native(0, "/storage/v1/bucket", "storage_https_without_user"), databaseTls()]));
const fakeIpObserved = results.some(result => result.values?.some(value => /^198\.(18|19)\./.test(typeof value === "string" ? value : value.address)));
const report = { checkedAt: new Date().toISOString(), projectRef: "rvysclscetfqicpnzlra", scope: "Direct process/native HTTPS; no login, no business writes. OS VPN/TUN/routes not changed or certified absent.", userDeclaredTunOff: process.env.PM_DIAG_TUN_OFF === "1", fakeIpObserved, resolverServers: resolver.getServers(), nodeEnvProxyEnabled: process.env.NODE_USE_ENV_PROXY === "1", results };
await mkdir("docs/evidence/auth-direct", { recursive: true });
const reportPath = `docs/evidence/auth-direct/probe-${Date.now()}.json`;
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
console.log(`Report: ${reportPath}`);
if (fakeIpObserved) console.log("Fake-IP detected: this run cannot demonstrate a normal mainland direct DNS path.");
