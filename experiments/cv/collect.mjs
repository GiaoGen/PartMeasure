// Bounded, reproducible collection of public photographs for a local experiment.
// No private project data is read or uploaded. Originals remain under ignored tmp/.
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const started = Date.parse("2026-10-23T04:55:20Z");
const deadline = started + 30 * 60_000;
const destination = new URL("../../tmp/p1-03/", import.meta.url);
const mirror = "zhaolutuan/0422";
const categories = ["bracket_black", "bracket_brown", "bracket_white", "connector", "metal_plate", "tubes"];
const MAX_CANDIDATES = 45;
let bytes = 0;
const sha256 = data => createHash("sha256").update(data).digest("hex");
async function get(url, maxBytes = 2 * 1024 * 1024) {
	if (Date.now() >= deadline) throw Error("COLLECTION_TIME_LIMIT_STOP");
	const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(20000, deadline - Date.now())) });
	if (!response.ok) throw Error(`HTTP ${response.status}`);
	const chunks = [];
	let size = 0;
	for await (const chunk of response.body) {
		size += chunk.length;
		bytes += chunk.length;
		if (size > maxBytes || bytes > 128 * 1024 * 1024) throw Error("COLLECTION_BYTE_LIMIT_STOP");
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}
await mkdir(new URL("originals/", destination), { recursive: true });
await mkdir(new URL("canonical/", destination), { recursive: true });
const info = JSON.parse((await get(`https://huggingface.co/api/datasets/${mirror}?expand[]=sha`, 65536)).toString());
const revision = info.sha;
if (!/^[a-f0-9]{40}$/.test(revision ?? "")) throw Error("MIRROR_REVISION_MISSING");
const licenseUrl = "https://raw.githubusercontent.com/stepanje/MPDD/main/LICENSE";
const license = await get(licenseUrl);
if (!license.toString().startsWith("Attribution-NonCommercial-ShareAlike 4.0")) throw Error("LICENSE_CHANGED_STOP");
await writeFile(new URL("MPDD-LICENSE.txt", destination), license);
const selection = [];
for (const category of categories) {
	const directory = JSON.parse((await get(`https://huggingface.co/api/datasets/${mirror}/tree/${revision}/MPDD/${category}/good?limit=30`)).toString());
	const images = directory.filter(item => item.type === "file" && /\.png$/i.test(item.path)).sort((a, b) => a.path.localeCompare(b.path));
	if (images.length < 6) throw Error(`INSUFFICIENT_CATEGORY_STOP:${category}`);
	const offsets = Array.from({ length: 6 }, (_, index) => Math.floor(index * (images.length - 1) / 5));
	for (const index of offsets) selection.push({ category, sourcePath: images[index].path });
}
if (selection.length > MAX_CANDIDATES) throw Error("CANDIDATE_LIMIT_STOP");
const manifest = {
	status: "awaiting-visual-review",
	collectionStartedAt: new Date(started).toISOString(),
	deadline: new Date(deadline).toISOString(),
	maxCandidates: MAX_CANDIDATES,
	selectedCandidateCount: selection.length,
	selection: "Six evenly spaced filenames in the first bounded directory page of each category; no algorithm-performance-based filtering.",
	originalSource: "https://github.com/stepanje/MPDD",
	authors: "Stepan Jezek, Martin Jonak, Radim Burget, Pavel Dvorak, Milos Skotak (ICUMT 2021)",
	license: "CC-BY-NC-SA-4.0",
	licenseUrl,
	licenseSha256: sha256(license),
	usage: "Local non-commercial experiment only; no raw photos included in application, public assets or Git commits.",
	mirror: `https://huggingface.co/datasets/${mirror}`,
	mirrorRevision: revision,
	provenanceLimit: "Mirror provenance is recorded; original-author per-file hashes are not available for byte-for-byte verification.",
	items: [],
};
await writeFile(new URL("manifest.json", destination), JSON.stringify(manifest, null, 2));
for (let i = 0; i < selection.length; i++) {
	const selected = selection[i];
	const id = `${selected.category}-${String(i % 6 + 1).padStart(2, "0")}`;
	const sourceUrl = `https://huggingface.co/datasets/${mirror}/resolve/${revision}/${selected.sourcePath}`;
	const original = await get(sourceUrl, 8 * 1024 * 1024);
	const originalPath = `originals/${id}.png`;
	const canonicalPath = `canonical/${id}.png`;
	const metadata = await sharp(original, { limitInputPixels: 40_000_000 }).metadata();
	const { data, info: dimensions } = await sharp(original, { limitInputPixels: 40_000_000 }).autoOrient().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
	await writeFile(new URL(originalPath, destination), original);
	await writeFile(new URL(canonicalPath, destination), data);
	manifest.items.push({ id, ...selected, sourceUrl, originalPath, canonicalPath, originalSha256: sha256(original), canonicalSha256: sha256(data), sourceWidth: metadata.width, sourceHeight: metadata.height, width: dimensions.width, height: dimensions.height });
	await writeFile(new URL("manifest.json", destination), JSON.stringify({ ...manifest, transferredBytes: bytes }, null, 2));
	process.stdout.write(`${i + 1}/${selection.length} ${id}\n`);
}
const rows = 6, cols = 6, width = 230, height = 250;
const composites = [];
for (let i = 0; i < manifest.items.length; i++) {
	const item = manifest.items[i];
	const thumbnail = await sharp(fileURLToPath(new URL(item.canonicalPath, destination))).resize(width, height - 26, { fit: "contain", background: "#f5f7fa" }).png().toBuffer();
	composites.push({ input: thumbnail, left: (i % cols) * width, top: Math.floor(i / cols) * height });
	const label = `<svg width="${width}" height="26"><rect width="100%" height="100%" fill="white"/><text x="6" y="18" font-family="Arial" font-size="13">${item.id}</text></svg>`;
	composites.push({ input: Buffer.from(label), left: (i % cols) * width, top: Math.floor(i / cols) * height + height - 26 });
}
await sharp({ create: { width: cols * width, height: rows * height, channels: 3, background: "#fff" } }).composite(composites).png().toFile(fileURLToPath(new URL("contact-sheet.png", destination)));
manifest.completedAt = new Date().toISOString();
manifest.transferredBytes = bytes;
manifest.uniqueOriginalHashes = new Set(manifest.items.map(item => item.originalSha256)).size;
await writeFile(new URL("manifest.json", destination), JSON.stringify(manifest, null, 2));
process.stdout.write(`Review ${manifest.items.length} candidates, ${manifest.uniqueOriginalHashes} unique hashes; ${(bytes / 1024 / 1024).toFixed(1)} MiB transferred.\n`);
