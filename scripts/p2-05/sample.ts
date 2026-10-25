// Exact application producer with synthetic same-origin HTTP data, no browser/cloud.
import { mkdir, writeFile } from "node:fs/promises";
import { sampleZipPackage } from "../../tests/fixtures/zip-package";
import { generateZipPackage } from "../../src/components/generate-zip-package";
const fixture = await sampleZipPackage(),
	{ snapshot } = fixture;
const previousFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
	const url = String(input);
	if (url.includes("zip-snapshot?")) return Response.json({ data: snapshot });
	if (url.includes("zip-access?"))
		return Response.json({ data: { files: snapshot.files } });
	const file = snapshot.files.find(
		(file) =>
			url.includes(file.id) &&
			(url.includes("original=1")
				? file.variant === "original"
				: file.variant !== "original"),
	);
	if (!file) throw Error("LOCAL_FIXTURE_FILE");
	const bytes = fixture.bytes.get(file.path);
	if (!bytes) throw Error("LOCAL_FIXTURE_BYTES");
	const range = new Headers(options?.headers).get("range");
	if (range !== `bytes=0-${bytes.length - 1}`)
		throw Error("LOCAL_FIXTURE_RANGE");
	return new Response(bytes, {
		status: 206,
		headers: { "content-range": `bytes 0-${bytes.length - 1}/${bytes.length}` },
	});
};
try {
	const result = await generateZipPackage(
		"/api/projects/P",
		snapshot.selection,
		new AbortController().signal,
		() => {},
	);
	try {
		await mkdir("output/zip", { recursive: true });
		await writeFile(
			"output/zip/p2-05-synthetic-package.zip",
			new Uint8Array(await result.blob.arrayBuffer()),
		);
		console.log(JSON.stringify({ bytes: result.blob.size }));
	} finally {
		result.release();
	}
} finally {
	globalThis.fetch = previousFetch;
}
