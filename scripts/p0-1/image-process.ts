// Historical experiment entry: shares the request processor's normalization code.
import { normalizeImage } from "../../src/lib/image-normalization";
const [source, target, mode] = process.argv.slice(2);
if (!source || !target) process.exit(2);
const timer = setInterval(() => { if (process.memoryUsage().rss > 1024 * 1024 * 1024) process.exit(3); }, 100);
try { process.stdout.write(JSON.stringify(await normalizeImage(source, target, mode))); }
catch { process.exitCode = 1; }
finally { clearInterval(timer); }
