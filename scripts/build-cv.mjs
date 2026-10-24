import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const destination = new URL("public/cv/", root);
const vendor = await readFile(new URL("node_modules/@techstark/opencv-js/dist/opencv.js", root));
const sha256 = createHash("sha256").update(vendor).digest("hex");
if (sha256 !== "bd0c3e6448043de04f6a64a12cb7b759f78c3ab8f7c35c9f2e0f71c88bb17103") throw Error("CV_VENDOR_HASH_MISMATCH");
await mkdir(destination, { recursive: true });
await writeFile(new URL("opencv-4.12.0-bd0c3e644804.js", destination), vendor);
await writeFile(new URL("LICENSE.txt", destination), await readFile(new URL("node_modules/@techstark/opencv-js/LICENSE", root)));
await build({ entryPoints: [fileURLToPath(new URL("src/lib/cv/worker.ts", root))], outfile: fileURLToPath(new URL("worker-v1.js", destination)), bundle: true, minify: true, platform: "browser", format: "iife", target: "es2022", legalComments: "inline" });
process.stdout.write(`CV assets prepared (OpenCV.js ${vendor.length} bytes); loaded only on explicit editor assistance.\n`);
