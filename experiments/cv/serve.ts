import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const directory = new URL("../../tmp/p1-03/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8")) as { items: { id: string; canonicalPath: string }[] };
const probes = JSON.parse(await readFile(new URL("probes.json", import.meta.url), "utf8")) as { items: { imageId: string }[] };
const files = new Map<string, { url: URL; type: string }>([
	["/", { url: new URL("results/report.html", directory), type: "text/html; charset=utf-8" }],
	["/manual.html", { url: new URL("workbench.html", import.meta.url), type: "text/html; charset=utf-8" }],
	["/gallery.html", { url: new URL("results/gallery.html", directory), type: "text/html; charset=utf-8" }],
	["/opencv.js", { url: new URL("node_modules/@techstark/opencv-js/dist/opencv.js", import.meta.url), type: "text/javascript" }],
]);
for (const id of ["line", "angle", "circle", "ellipse", "fallback", "wrong-edge"]) files.set(`/examples/${id}.png`, { url: new URL(`results/examples/${id}.png`, directory), type: "image/png" });
for (const engine of ["baseline", "edge"]) files.set(`/contact-${engine}.png`, { url: new URL(`results/contact-${engine}.png`, directory), type: "image/png" });
for (const sample of manifest.items) {
	files.set(`/images/${sample.id}.png`, { url: new URL(sample.canonicalPath, directory), type: "image/png" });
	files.set(`/features/${sample.id}.json`, { url: new URL(`edge-drawing/${sample.id}.json`, directory), type: "application/json" });
	for (const engine of ["baseline", "edge"]) {
		const names = [`${engine}-${sample.id}`, ...probes.items.filter(p => p.imageId === sample.id).map((_, i) => `${engine}-${sample.id}-probe-${i + 1}`)];
		for (const name of names) files.set(`/overlays/${name}.png`, { url: new URL(`results/overlays/${name}.png`, directory), type: "image/png" });
	}
}
const bundles = new Map<string, Uint8Array>();
for (const entry of ["browser", "worker"]) {
	const result = await build({ entryPoints: [new URL(`${entry}.ts`, import.meta.url).pathname.replace(/^\/([A-Z]:)/i, "$1")], bundle: true, write: false, platform: "browser", format: "iife", target: "es2022" });
	if (!result.outputFiles[0]) throw Error("BUNDLE_MISSING");
	bundles.set(`/${entry}.js`, result.outputFiles[0].contents);
}
createServer(async (request, response) => {
	// Loopback only, fixed allowlist, read-only. No arbitrary filesystem paths,
	// uploaded photos, production credentials, CORS or write API.
	if (request.headers.host !== "127.0.0.1:3103" && request.headers.host !== "localhost:3103") { response.writeHead(403).end(); return; }
	if (request.method !== "GET") { response.writeHead(405).end(); return; }
	const path = new URL(request.url ?? "/", "http://127.0.0.1:3103").pathname;
	response.setHeader("X-Content-Type-Options", "nosniff");
	response.setHeader("Cache-Control", "no-store");
	// This pinned Emscripten artifact uses new Function for embind. Permit it
	// only in the independent worker, never widen the production app's CSP.
	const scripts = path === "/worker.js" ? "'self' 'unsafe-eval' 'wasm-unsafe-eval'" : "'self'";
	response.setHeader("Content-Security-Policy", `default-src 'self'; script-src ${scripts}; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'`);
	try {
		if (path === "/manifest.json") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(manifest)); return; }
		const bundle = bundles.get(path);
		if (bundle) { response.setHeader("Content-Type", "text/javascript"); response.end(bundle); return; }
		const file = files.get(path);
		if (!file) { response.writeHead(404).end(); return; }
		response.setHeader("Content-Type", file.type);
		response.end(await readFile(file.url));
	} catch { response.writeHead(404).end("Local experiment file missing. Run batch extraction first."); }
}).listen(3103, "127.0.0.1", () => process.stdout.write("P1-03 conclusions: http://127.0.0.1:3103 — optional workbench /manual.html; no browser opened.\n"));
