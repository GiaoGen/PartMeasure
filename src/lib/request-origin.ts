// Only configured/trusted runtime origins are accepted; request Host is never an allowlist.
export function writeOriginAllowed(
	req: Request,
	origins: string[],
	local = false,
) {
	const origin = req.headers.get("origin");
	if (!origin || req.headers.get("sec-fetch-site") === "cross-site") return false;
	if (origins.includes(origin)) return true;
	if (!local) return false;
	try {
		const actual = new URL(origin);
		if (actual.origin !== origin || actual.protocol !== "http:") return false;
		const loopback = new Set(["localhost", "127.0.0.1"]);
		return loopback.has(actual.hostname) && origins.some((value) => {
			const configured = new URL(value);
			return configured.protocol === actual.protocol &&
				configured.port === actual.port && loopback.has(configured.hostname);
		});
	} catch {
		return false;
	}
}
