import { describe, expect, it } from "vitest";
import { dependencyHint } from "../../src/lib/server/dependency-hint";

describe("safe dependency classification", () => {
	it("reports fixed transport categories without echoing provider text", () => {
		expect(dependencyHint({ message: "Connection terminated unexpectedly; private context" })).toBe("connection_closed");
		expect(dependencyHint({ message: "The server does not support SSL connections" })).toBe("tls_negotiation");
		expect(dependencyHint({ message: "There was an error establishing an SSL connection" })).toBe("pg_ssl_request_rejected");
		expect(dependencyHint({ code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE", message: "certificate invalid" })).toBe("tls_validation");
		expect(dependencyHint({ code: "ENOTFOUND" })).toBe("dns");
		expect(dependencyHint({ code: "ECONNRESET" })).toBe("network_connection");
	});
	it("does not disclose unknown error details", () => {
		expect(dependencyHint({ message: "private provider information" })).toBe("unclassified");
		expect(dependencyHint(null)).toBe("unclassified");
	});
});
