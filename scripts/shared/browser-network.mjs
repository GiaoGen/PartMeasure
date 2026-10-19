// Configuration only; importing this module never starts a browser.
export function browserNetwork(env = process.env) {
	if (env.PM_NETWORK_MODE !== "diagnostic-proxy") return { args: ["--no-proxy-server"] };
	const url = new URL(env.HTTPS_PROXY ?? "");
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw Error("EXPLICIT_PROXY_REQUIRED");
	return { proxy: { server: url.href, bypass: "localhost,127.0.0.1" } };
}
