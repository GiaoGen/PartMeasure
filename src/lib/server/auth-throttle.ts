import "server-only";
import { AppError } from "../policy";
import { appOrigin } from "./origin";
import { digest, rate, transaction } from "./db";

const localBuckets = new Map<string, { hits: number; expires: number }>();
const windowSeconds = 600;

/** Local development must not need the business database before reaching Auth. */
export async function throttleAuth(kind: "auth" | "verify", email: string) {
	const limits: [string, number][] = [
		[`${kind}:global`, 100],
		[`${kind}:${digest(email.toLowerCase())}`, kind === "auth" ? 5 : 10],
	];
	const local = process.env.NODE_ENV === "development" && !process.env.VERCEL && !process.env.VERCEL_ENV
		&& ["localhost", "127.0.0.1", "[::1]"].includes(new URL(appOrigin()).hostname);
	if (!local) {
		for (const [key, max] of limits) await transaction(null, db => rate(db, key, max, windowSeconds));
		return;
	}
	const now = Date.now();
	for (const [key, bucket] of localBuckets) if (bucket.expires <= now) localBuckets.delete(key);
	for (const [key, max] of limits) {
		const bucket = localBuckets.get(key) ?? { hits: 0, expires: now + windowSeconds * 1000 };
		if (bucket.hits >= max) throw new AppError("RATE_LIMITED", 429);
		localBuckets.set(key, { ...bucket, hits: bucket.hits + 1 });
	}
}
