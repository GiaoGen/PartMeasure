import "server-only";
import pg from "pg";
import { readFileSync } from "node:fs";
import { AppError } from "../policy";
import { dependencyHint } from "./dependency-hint";

type Subscriber = { change: (payload: string) => void; dropped: () => void };
export class SessionNotifications {
	private subscribers = new Set<Subscriber>();
	private client: pg.Client | null = null;
	private opening: Promise<void> | null = null;
	constructor(
		private channel: "pm_project_events" | "pm_file_jobs",
		private worker = false,
	) {}
	async subscribe(subscriber: Subscriber) {
		this.subscribers.add(subscriber);
		try {
			await this.open();
		} catch (error) {
			this.subscribers.delete(subscriber);
			if (error instanceof AppError) {
				console.warn(JSON.stringify({ event: "updates_subscription_failed", code: error.code }));
				throw error;
			}
			throw new AppError("UPDATES_UNAVAILABLE", 503);
		}
		return () => {
			this.subscribers.delete(subscriber);
			if (!this.subscribers.size) this.stop();
		};
	}
	private open() {
		if (this.opening) return this.opening;
		const value = process.env[this.worker ? "WORKER_EVENT_DATABASE_URL" : "EVENT_DATABASE_URL"];
		if (!value) throw new AppError("UPDATES_NOT_CONFIGURED", 503);
		const url = new URL(value);
		const role = this.worker ? "partmeasure_worker" : "partmeasure_runtime";
		const project = new URL(
			process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid",
		).hostname.split(".")[0];
		const local =
			process.env.PM_EVENTS_LOCAL === "disposable-native-pg" && url.hostname === "127.0.0.1";
		const user = decodeURIComponent(url.username);
		if (
			url.port === "6543" ||
			!(local
				? user === role
				: user === `${role}.${project}` ||
					(user === role && url.hostname === `db.${project}.supabase.co`))
		)
			throw new AppError("UNSAFE_EVENT_CONNECTION", 503);
		url.searchParams.delete("sslmode");
		const ca =
			process.env.DATABASE_CA_PEM ||
			(process.env.DATABASE_CA_FILE
				? readFileSync(process.env.DATABASE_CA_FILE, "utf8")
				: undefined);
		const client = new pg.Client({
			connectionString: url.href,
			ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
			connectionTimeoutMillis: 10000,
			query_timeout: 10000,
		});
		this.client = client;
		const drop = () => {
			if (this.client !== client) return;
			this.client = null;
			this.opening = null;
			for (const subscriber of [...this.subscribers]) subscriber.dropped();
			void client.end().catch(() => {});
		};
		client.on("error", drop);
		client.on("end", drop);
		client.on("notification", (message) => {
			if (message.channel === this.channel)
				for (const subscriber of [...this.subscribers])
					subscriber.change(message.payload ?? "");
		});
		this.opening = (async () => {
			try {
				await client.connect();
				if ((await client.query("select current_user as role")).rows[0]?.role !== role)
					throw Error("UNSAFE_ROLE");
				await client.query(`listen ${this.channel}`);
			} catch (error) {
				console.warn(JSON.stringify({ event: "updates_subscription_failed", hint: dependencyHint(error), code: error instanceof AppError ? error.code : "UPDATES_UNAVAILABLE" }));
				drop();
				throw error;
			}
		})();
		return this.opening;
	}
	stop() {
		const client = this.client;
		this.client = null;
		this.opening = null;
		if (client) void client.end().catch(() => {});
	}
}
