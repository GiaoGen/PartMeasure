import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { PoolClient } from "pg";

type Stage = "auth" | "pool" | "sql" | "preflight" | "storage_sign" | "storage_fetch";
type Sample = { duration: number; count: number };
const context = new AsyncLocalStorage<Map<Stage, Sample>>();

/** Fixed labels only: never put paths, SQL, arguments, identities or URLs in timing. */
export async function timed<T>(stage: Stage, work: () => Promise<T>): Promise<T> {
	const samples = context.getStore();
	if (!samples) return work();
	const start = performance.now();
	try {
		return await work();
	} finally {
		const old = samples.get(stage) ?? { duration: 0, count: 0 };
		samples.set(stage, { duration: old.duration + performance.now() - start, count: old.count + 1 });
	}
}

export function observedClient(client: PoolClient): PoolClient {
	if (!context.getStore()) return client;
	return new Proxy(client, {
		get(target, property) {
			if (property === "query") {
				return (...args: unknown[]) => timed("sql", () => Reflect.apply(target.query, target, args));
			}
			return Reflect.get(target, property);
		},
	});
}

export async function withRequestTiming(work: () => Promise<Response>) {
	if (process.env.PM_SERVER_TIMING !== "1") return work();
	return context.run(new Map(), async () => {
		const start = performance.now();
		const result = await work();
		const metrics = [...(context.getStore() ?? [])].flatMap(([stage, sample]) => [
			`${stage};dur=${sample.duration.toFixed(1)}`,
			`${stage}_count;desc="${sample.count}"`,
		]);
		metrics.push(`app;dur=${(performance.now() - start).toFixed(1)}`);
		result.headers.set("Server-Timing", metrics.join(", "));
		return result;
	});
}
