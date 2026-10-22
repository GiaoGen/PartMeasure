import "server-only";
import { authClient, guest } from "./auth";
import { digest, rate, transaction, type Actor } from "./db";
import { AppError } from "../policy";
import { projectChanges } from "./project-changes";
import { SessionNotifications } from "./session-notifications";
import { uuid } from "./http";
import { dependencyHint } from "./dependency-hint";
import { timed } from "./timing";

const notifications = new SessionNotifications("pm_project_events");
let streams = 0;
export async function projectStream(req: Request, project: string, isGuest: boolean) {
	if (!uuid.safeParse(project).success) throw new AppError("NOT_FOUND", 404);
	if (req.headers.get("sec-fetch-site") === "cross-site") throw new AppError("FORBIDDEN", 403);
	const url = new URL(req.url);
	if (url.searchParams.getAll("cursor").length > 1 || url.searchParams.get("cursor") === "")
		throw new AppError("CURSOR_INVALID", 422);
	const client = isGuest ? null : await authClient();
	let actor: Actor | undefined;
	const validateOwner = async () => {
		if (!client) return;
		const { data, error } = await timed("auth", () => client.auth.getUser());
		if (error && (error.name === "AuthRetryableFetchError" || (error.status !== undefined && (error.status >= 500 || error.status === 0))))
			throw new AppError("DEPENDENCY_UNAVAILABLE", 503);
		if (
			error ||
			!data.user?.email_confirmed_at ||
			(actor && actor.kind === "owner" && data.user.id !== actor.id)
		)
			throw new AppError("AUTH_REQUIRED", 401);
		actor = { kind: "owner", id: data.user.id };
	};
	if (isGuest) actor = await guest(project);
	else await validateOwner();
	if (!actor) throw new AppError("AUTH_REQUIRED", 401);
	const identity = actor;
	await transaction(identity, (db) =>
		rate(db, `events:${identity.kind === "owner" ? identity.id : digest(identity.hash)}`, 30),
	);
	let cursor = req.headers.get("last-event-id") || url.searchParams.get("cursor");
	if (streams >= 24) throw new AppError("UPDATES_CAPACITY", 503);
	streams++;
	let close = () => {
		closed = true;
	};
	let unsubscribe: (() => void) | undefined;
	let queued = false,
		busy = false,
		closed = false,
		initializing = true;
	let enqueue: ((event: string, value: unknown, id?: string) => void) | undefined;
	try {
		unsubscribe = await notifications.subscribe({
			change: (value) => {
				if (value === project) {
					queued = true;
					void drain();
				}
			},
			dropped: () => close(),
		});
		if (closed || req.signal.aborted) throw new AppError("UPDATES_UNAVAILABLE", 503);
	} catch (e) {
		streams--;
		unsubscribe?.();
		throw e;
	}
	async function drain() {
		if (busy || closed || initializing || !enqueue) return;
		busy = true;
		try {
			do {
				queued = false;
				await validateOwner();
				if (closed) return;
				await projectChanges(identity, project, cursor, (changes) => {
					if (closed) return;
					enqueue?.("changes", changes, changes.cursor);
					cursor = changes.cursor;
				});
			} while (queued && !closed);
		} catch (e) {
			if (e instanceof AppError && [401, 403, 404].includes(e.status))
				enqueue?.("unavailable", { reason: "access_lost" });
			else console.warn(JSON.stringify({ event: "updates_refresh_failed", code: e instanceof AppError ? e.code : "DEPENDENCY_UNAVAILABLE", hint: dependencyHint(e) }));
			close();
		} finally {
			busy = false;
		}
	}
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			const heartbeat = setInterval(() => {
				if (!closed && !initializing) {
					if ((controller.desiredSize ?? 0) <= 0) close();
					else controller.enqueue(encoder.encode(": heartbeat\n\n"));
				}
			}, 15000);
			const lease = setTimeout(() => {
				enqueue?.("rotate", {});
				close();
			}, 240000);
			close = () => {
				if (closed) return;
				closed = true;
				streams--;
				clearInterval(heartbeat);
				clearTimeout(lease);
				unsubscribe?.();
				req.signal.removeEventListener("abort", close);
				try {
					controller.close();
				} catch {
					/* Already cancelled. */
				}
			};
			enqueue = (event, value, id) => {
				if (closed) return;
				if ((controller.desiredSize ?? 0) <= 0) {
					close();
					return;
				}
				controller.enqueue(
					encoder.encode(
						`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(value)}\n\n`,
					),
				);
			};
			req.signal.addEventListener("abort", close, { once: true });
			if (req.signal.aborted) close();
		},
		pull() {
			if (queued && !initializing) void drain();
		},
		cancel() {
			close();
		},
	});
	try {
		// Subscribe first, then take ONE snapshot. Its initial bytes are enqueued
		// inside project/link locks before releasing them; denied requests still
		// return normal HTTP errors because the Response is not returned yet.
		await projectChanges(identity, project, cursor, (changes) => {
			if (closed) return;
			enqueue?.("changes", changes, changes.cursor);
			cursor = changes.cursor;
		});
		if (closed) throw new AppError("UPDATES_UNAVAILABLE", 503);
		initializing = false;
	} catch (error) {
		close();
		throw error;
	}
	return new Response(body, {
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "private, no-store, no-transform",
			"X-Accel-Buffering": "no",
			Vary: "Cookie",
		},
	});
}
