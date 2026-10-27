// Pre-auth PostgreSQL SSLRequest diagnosis. No credentials, TLS bypass, SQL or network changes.
import net from "node:net";
import nextEnv from "@next/env";
import { writeFile } from "node:fs/promises";
import { connectionTarget, connectionFailure } from "../maintenance/connection-model";
nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} }); connectionTarget(process.env);
const results: object[] = [];
for (const name of ["DATABASE_URL", "EVENT_DATABASE_URL"] as const) {
	const url = new URL(process.env[name] ?? "http://invalid");
	const start = performance.now();
	try {
		const result = await new Promise<object>((resolve, reject) => {
			const socket = net.connect({ host: url.hostname, port: Number(url.port) });
			let buffer = Buffer.alloc(0);
			const end = (result: object) => { socket.destroy(); resolve(result); };
			socket.setTimeout(12000, () => { socket.destroy(); reject(new Error("SSL_REQUEST_TIMEOUT")); });
			socket.once("error", reject);
			socket.once("connect", () => { const request = Buffer.alloc(8); request.writeInt32BE(8, 0); request.writeInt32BE(80877103, 4); socket.write(request); });
			socket.on("data", part => {
				buffer = Buffer.concat([buffer, part]);
				if (buffer.length > 8192) return end({ classification: "unexpected_oversized_pre_auth_response" });
				if (buffer[0] === 83) return end({ classification: "SSL_SUPPORTED", bytes: buffer.length });
				if (buffer[0] === 78) return end({ classification: "SSL_NOT_SUPPORTED" });
				if (buffer[0] === 69) {
					if (buffer.length < 5 || buffer.length < 1 + buffer.readInt32BE(1)) return;
					const fields = buffer.subarray(5).toString("utf8").split("\0");
					const code = fields.find(f => f.startsWith("C"))?.slice(1);
					const message = fields.find(f => f.startsWith("M"))?.slice(1).toLowerCase() ?? "";
					return end({ classification: "POSTGRES_ERROR_BEFORE_TLS", sqlState: code && /^[0-9A-Z]{5}$/.test(code) ? code : "UNKNOWN",
						reason: /max|capacity|too many|limit|pool size/.test(message) ? "capacity" : /not found|tenant/.test(message) ? "routing_or_tenant" : /shutdown|not available|unavailable/.test(message) ? "availability" : "unclassified" });
				}
				end({ classification: "NON_POSTGRES_PRE_AUTH_RESPONSE", firstByte: buffer[0] });
			});
			socket.once("end", () => end({ classification: "PEER_CLOSED", bytes: buffer.length }));
		});
		results.push({ endpoint: name, milliseconds: Math.round(performance.now() - start), ...result });
	} catch (error) { results.push({ endpoint: name, milliseconds: Math.round(performance.now() - start), ...connectionFailure(error) }); }
}
const evidence = { checkedAt: new Date().toISOString(), scope: "One pre-auth SSLRequest per configured runtime/session port; no credentials/SQL; does not certify TLS handshake or ongoing reliability", results };
await writeFile("docs/evidence/p3-05/ssl-request.json", `${JSON.stringify(evidence, null, 2)}\n`); console.log(JSON.stringify(evidence));
