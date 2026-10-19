/** Only fixed classifications may leave the server; never return dependency messages. */
export function dependencyHint(error: unknown) {
	const e = error as { code?: string; message?: string; cause?: { code?: string } } | null;
	const code = e?.code ?? e?.cause?.code ?? "";
	const message = String(e?.message ?? "").toLowerCase();
	if (["ECONNREFUSED", "ECONNRESET", "EPIPE", "ENETUNREACH", "EHOSTUNREACH"].includes(code)) return "network_connection";
	if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return "dns";
	if (message.includes("does not support ssl")) return "tls_negotiation";
	if (message.includes("establishing an ssl connection")) return "pg_ssl_request_rejected";
	if (message.includes("certificate") || code.includes("CERT") || code.includes("SSL")) return "tls_validation";
	if (message.includes("timeout") || code === "ETIMEDOUT") return "timeout";
	if (message.includes("terminated") || message.includes("closed") || message.includes("ended unexpectedly")) return "connection_closed";
	if (code === "28P01" || message.includes("sasl")) return "database_authentication";
	if (code === "53300") return "database_capacity";
	return "unclassified";
}
