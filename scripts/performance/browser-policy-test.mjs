import assert from "node:assert/strict";
import { browserNetwork } from "../shared/browser-network.mjs";

assert.deepEqual(browserNetwork({ HTTPS_PROXY: "http://127.0.0.1:9" }), { args: ["--no-proxy-server"] });
assert.deepEqual(browserNetwork({ PM_NETWORK_MODE: "direct", HTTPS_PROXY: "http://127.0.0.1:9" }), { args: ["--no-proxy-server"] });
assert.throws(() => browserNetwork({ PM_NETWORK_MODE: "diagnostic-proxy" }));
assert.throws(() => browserNetwork({ PM_NETWORK_MODE: "diagnostic-proxy", HTTPS_PROXY: "http://user:password@127.0.0.1:9" }));
assert.deepEqual(browserNetwork({ PM_NETWORK_MODE: "diagnostic-proxy", HTTPS_PROXY: "http://127.0.0.1:9" }), { proxy: { server: "http://127.0.0.1:9/", bypass: "localhost,127.0.0.1" } });
console.log("PASS: browser launch options explicitly disable system proxy by default; diagnostic proxy is opt-in; no browser launched");
