import { QueryCache } from "./query-cache";
import { eventTags, mutationTags, queryPolicy } from "./cache-policy";
import { clearSavedShares } from "./saved-share-links";
import type { ProjectUpdate } from "@/lib/project-events";

export class ApiError extends Error {
	constructor(
		public code: string,
		public status: number,
	) {
		super(message(code));
	}
}
const messages: Record<string, string> = {
	AUTH_NOT_CONFIGURED: "认证服务尚未配置。",
	AUTH_REQUIRED: "登录状态已变化，请重新进入项目。",
	DATABASE_NOT_CONFIGURED: "数据库连接尚未配置。",
	DEPENDENCY_UNAVAILABLE: "服务暂时不可用，请稍后重试。",
	INVALID_CREDENTIALS: "邮箱或密码不正确，或邮箱尚未确认。",
	OTP_INVALID_OR_EXPIRED: "验证码不正确或已过期。",
	REGISTRATION_UNAVAILABLE: "暂时无法注册。请检查邮箱、密码或稍后重试。",
	RATE_LIMITED: "操作较频繁，请稍后重试。",
	UNSUPPORTED_FORMAT: "不支持此格式。照片请使用 JPG、PNG 或 WebP，HEIC 请先转换。",
	FILE_TOO_LARGE: "文件超过此格式的大小上限。",
	QUOTA_EXCEEDED: "项目、账户或今日上传配额不足，请联系工程师。",
	DUPLICATE_FILE: "项目中已有相同文件，无需重复上传。",
	UPLOAD_CONCURRENCY_LIMIT: "当前处理队列已满，请等待已有文件完成后重试。",
	LINK_UNAVAILABLE: "链接已不可用，请向工程师索取新链接。",
	HISTORY_PROTECTED: "文件有关联历史，不能删除。",
	MIME_MISMATCH: "文件格式与声明不一致。",
	MAGIC_MISMATCH: "真实文件内容与扩展名不一致。",
	SCANNER_NOT_CONFIGURED: "文件已隔离保存，等待安全扫描服务。",
	SCAN_UNAVAILABLE: "安全扫描暂不可用，文件仍处于隔离状态。",
	UPLOAD_WINDOW_EXPIRED: "上传授权窗口已过期，请重新选择文件。",
	HASH_OR_SIZE_MISMATCH: "上传内容校验失败，请重新上传。",
	REVISION_CONFLICT: "项目已在别处更新，请刷新后重试。",
	REVISION_REQUIRED: "页面缺少资料修订，请保留输入并重新载入。",
	CSRF_INVALID: "页面安全凭据失效，请刷新。",
	FORBIDDEN: "当前访问方式没有此操作权限。",
	PROJECT_ARCHIVED: "项目已归档，只能查看和下载；请由工程师恢复后再操作。",
	EXPORT_LIMIT: "这张图的标注或说明超过单张导出上限（16MP／最长16384px／说明60000字），请减少本次内容或联系工程师。",
	EXPORT_BUSY: "上次图片处理仍在结束，请稍后重新生成。",
	FEEDBACK_STATE_CONFLICT: "本次接收记录已变化，请查看最新记录后再操作；留言输入已保留。",
	FEEDBACK_LIMIT: "本版本反馈已达上限；已有接收记录仍可撤销。",
	ORIGIN_MISMATCH: "访问地址与服务端配置不一致，请使用配置的站点地址；重新登录或清缓存无法解决。",
	FOLDER_NAME_EXISTS: "文件夹名称已存在，请换一个名称。",
	FOLDER_LIMIT_REACHED: "文件夹数量已达到上限。",
	PROCESSING_ACTIVE: "文件正在处理，请稍后查看；若中断，稍后可重试。",
	PROCESSING_BUSY: "正在处理另一份文件，请稍后重试，无需重新上传。",
	PROCESSING_EXPIRED: "上次文件处理已中断，可以继续处理，无需重新上传。",
	PROCESSING_INTERRUPTED: "文件处理暂时中断，请重试，无需重新上传。",
	UPLOAD_OBJECT_NOT_FOUND: "文件尚未传输完整，请重新选择同一文件继续。",
	FILE_REJECTED: "文件未通过格式或内容校验，请检查文件后重新选择。",
	NOT_FOUND: "内容不存在或无权访问。",
	IMAGE_NOT_READY: "图片尚未完成标准化处理，无法标注。",
	IMAGE_VERSION_CONFLICT: "图片版本已变化，请保留草稿并重新载入。",
	INVALID_GEOMETRY: "标注位置不合法，线或圆不能小于半个原图像素。",
	INVALID_ENGINEERING_FIELDS: "工程字段与标注类型不一致，请检查。",
	ANNOTATION_LIMIT: "这张图片已达到 200 个保留标注上限。",
	ANNOTATION_REVISION_LIMIT: "这个标注的修订数已达到上限，请联系工程师。",
	FILE_ISSUE_LIMIT: "这个文件的问题数已达到上限。",
	DATABASE_BUSY: "资料正在被其他操作更新，请稍后重试。",
	DATABASE_TIMEOUT: "读取资料超时，请稍后重试。",
	DATABASE_CAPACITY: "数据库连接暂时繁忙，请稍后重试。",
	DEPENDENCY_TIMEOUT: "服务连接超时，请重试。",
	CLOSED_MEASUREMENT: "该项已由工程师结束，输入已保留，请查看最新标注。",
	INVALID_MEASUREMENT_UNIT: "请使用对应字段的单位；角度需大于 0° 且小于 360°，不能与长度换算。",
	INVALID_STATE: "任务状态已变化，当前不能执行此操作，请重新载入。",
	INVALID_RESPONSE_KIND: "回复方式与任务类型不一致。",
	INVALID_REVIEW: "请核对审核决定、最终值与说明。",
	CONFIRMATION_SOURCE_REQUIRED: "人工录入或修正必须标明来源并填写说明。",
	PHOTO_EVIDENCE_REQUIRED: "请上传并选择至少一张处理完成的测量照片。",
	ATTACHMENT_UNAVAILABLE: "附件不可用，请选择本项目中处理完成且可共享的文件。",
	RESPONSE_CONFLICT: "最新回复已变化，请重新载入后审核。",
	RESPONSE_LIMIT: "该任务已达到100轮回复上限，请由工程师新建请求。",
	DELIVERY_FILE_UNAVAILABLE: "成果附件不可用，请选择本项目中处理完成的工程师成果文件。",
	DELIVERY_PUBLISHED: "这份成果已经发布，不能覆盖。请重新载入查看，或准备新的成果集合。",
	DELIVERY_FILES_REQUIRED: "请选择1～20个处理完成的成果附件，再发布。",
	DELIVERY_DRAFT_LIMIT: "当前已有5份交付草稿，请先完成已有草稿。",
};
export const message = (code: string) => messages[code] ?? "操作未完成，请重试或联系工程师。";
const queries = new QueryCache();
let identity = 0;
let csrfToken: string | null = null;
let csrfPending: Promise<string> | null = null;
let channel: BroadcastChannel | undefined;
let listening = false;
export type SessionClearReason = "identity" | "unload";
const sessionListeners = new Set<(reason: SessionClearReason) => void>();
const requests = new Set<AbortController>();
const projectListeners = new Set<(base: string, updates: ProjectUpdate[]) => void>();
const revalidationListeners = new Set<() => void>();
export function onApiRevalidate(listener: () => void) {
	revalidationListeners.add(listener);
	return () => { revalidationListeners.delete(listener); };
}
export type ReadOptions = {
	key?: string; revision?: number; cacheMs?: number; cacheVersion?: string;
	signal?: AbortSignal | undefined; refresh?: boolean;
};
const queryKey = (url: string, options: ReadOptions = {}) => `${identity}\n${url}\n${options.cacheVersion ?? ""}`;
export function apiSessionGuard() {
	const started = identity;
	return () => { if (identity !== started) throw new ApiError("AUTH_REQUIRED", 401); };
}
/** Batch members own the resource cache/fences; avoid a second retrying cache for their transport. */
export async function readApiTransport<T>(url: string, signal: AbortSignal): Promise<T> {
	listenForSessionChanges();
	const started = identity;
	const value = await request<T>(url, "GET", undefined, {}, started, signal);
	if (started !== identity) throw new ApiError("AUTH_REQUIRED", 401);
	return value;
}
export function readCached<T>(url: string, options: ReadOptions = {}): T | undefined {
	return (options.cacheMs ?? queryPolicy(url).ttl) > 0 ? queries.peek<T>(queryKey(url, options)) : undefined;
}
/** Reuse the same identity, invalidation fences and consumer cancellation for batched transport. */
export function readApiWith<T>(url: string, load: (signal: AbortSignal) => Promise<T>, options: ReadOptions = {}): Promise<T> {
	listenForSessionChanges();
	const started = identity;
	const policy = queryPolicy(url);
	return queries.read(queryKey(url, options), async signal => {
		const value = await load(signal);
		if (identity !== started) throw new ApiError("AUTH_REQUIRED", 401);
		policy.tags.splice(0, policy.tags.length, ...detailTags(url, value).tags);
		return value;
	}, options.cacheMs ?? policy.ttl, policy.tags, 1, options).then(value => {
		if (identity !== started) throw new ApiError("AUTH_REQUIRED", 401);
		return value;
	});
}
export function observeApiVersion(url: string, version: string) {
	const tag = queryPolicy(url).tags[1];
	queries.observeVersion(queryKey(url), version, tag ? [tag] : []);
}
function detailTags(url: string, value: unknown) {
	const policy = queryPolicy(url);
	if ((/\/issues\/[^/?]+(?:\/current|\/history-page)?(?:\?|$)/.test(url) || /\/files\/[^/?]+\/(?:interaction|collaboration)\?/.test(url)) && value && typeof value === "object") {
		type ResponseFiles = { attachments?: { id: string }[] };
		const detail = value as { responses?: ResponseFiles[]; items?: { type?: string; record?: ResponseFiles }[]; issues?: { items: { responses: ResponseFiles[] }[] } };
		const responses = detail.responses ?? detail.issues?.items.flatMap(item => item.responses) ?? detail.items?.flatMap(item => item.type === "response" && item.record ? [item.record] : []) ?? [];
		const ids = new Set(responses.flatMap(r => r.attachments?.map(f => f.id) ?? []));
		// Pending reads use the broad tag until their attachment identities are known.
		policy.tags = policy.tags.filter(tag => tag !== `${policy.tags[0]}:evidence:all`);
		if (ids.size > 200) policy.tags.push(`${policy.tags[0]}:evidence:all`);
		else for (const id of ids) policy.tags.push(`${policy.tags[0]}:evidence:${id}`);
	}
	return policy;
}
/** Only canonical server responses/deltas may seed shared state, never unsaved forms. */
export function rememberApi<T>(url: string, value: T) {
	const previous = readCached<T & { revision?: number }>(url);
	const revision = (value as { revision?: number } | null)?.revision;
	if (previous?.revision !== undefined && revision !== undefined && previous.revision > revision) return previous;
	const policy = detailTags(url, value);
	if (policy.tags[1]) queries.invalidate([policy.tags[1]]);
	queries.set(queryKey(url), value, policy.ttl, policy.tags);
	return value;
}
/** Seed another representation from an aggregate without invalidating sibling history/lists. */
export function seedApi<T>(url: string, value: T) {
	const previous = readCached<T & { revision?: number }>(url);
	const revision = (value as { revision?: number } | null)?.revision;
	if (previous?.revision !== undefined && revision !== undefined && previous.revision > revision) return previous;
	const policy = detailTags(url, value);
	queries.seed(queryKey(url), value, policy.ttl, policy.tags);
	return value;
}
export function onProjectCacheInvalidated(
	listener: (base: string, updates: ProjectUpdate[]) => void,
) {
	projectListeners.add(listener);
	return () => {
		projectListeners.delete(listener);
	};
}
export function invalidateProjectQueries(base: string, updates: ProjectUpdate[]) {
	const tags = eventTags(base, updates).filter(tag => {
		const event = updates.find(e => e.kind === "issue.changed" && tag === `${base}:issue:${e.entityId}`);
		if (event?.kind !== "issue.changed" || event.revision === null) return true;
		const cached = [readCached<{ revision: number }>(`${base}/issues/${event.entityId}`), readCached<{ revision: number }>(`${base}/issues/${event.entityId}/current`)].filter(v => v !== undefined);
		return !cached.length || cached.some(v => !Number.isSafeInteger(v.revision) || v.revision < (event.revision as number));
	});
	queries.invalidate(tags);
	for (const listener of projectListeners) listener(base, updates);
}
export function onApiSessionCleared(listener: (reason: SessionClearReason) => void) {
	sessionListeners.add(listener);
	return () => {
		sessionListeners.delete(listener);
	};
}
export const invalidateQueries = () => queries.clear();

function resetSessionData(reason: SessionClearReason = "identity") {
	identity++;
	for (const controller of requests) controller.abort();
	requests.clear();
	queries.clear();
	for (const listener of sessionListeners) listener(reason);
}
export function clearApiSession(preserveSavedShares = false, reason: SessionClearReason = "identity") {
	if (!preserveSavedShares) clearSavedShares();
	resetSessionData(reason);
	csrfToken = null;
	csrfPending = null;
}

function listenForSessionChanges() {
	if (listening || typeof window === "undefined") return;
	listening = true;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let last = 0;
	const revalidate = () => {
		if (document.hidden || Date.now() - last < 1000) return;
		clearTimeout(timer);
		timer = setTimeout(() => {
			if (document.hidden) return;
			last = Date.now();
			queries.markStale();
			for (const listener of revalidationListeners) listener();
		}, 180);
	};
	// BFCache is a suspended document, not logout. Restore its live connection and revalidate.
	window.addEventListener("pagehide", event => {
		clearTimeout(timer);
		if (!event.persisted) clearApiSession(true, "unload");
	});
	window.addEventListener("pageshow", event => { if (event.persisted) revalidate(); });
	window.addEventListener("focus", revalidate);
	window.addEventListener("online", revalidate);
	document.addEventListener("visibilitychange", revalidate);
	if (typeof BroadcastChannel !== "undefined") {
		channel = new BroadcastChannel("pm-session-invalidation");
		channel.onmessage = () => clearApiSession();
	}
}

async function csrfCredential(): Promise<string> {
	if (csrfToken) return csrfToken;
	if (csrfPending) return csrfPending;
	const started = identity;
	const pending = (async () => {
		const res = await fetch("/api/csrf", {
			cache: "no-store",
			signal: AbortSignal.timeout(45000),
		});
		const json = await res.json();
		if (!res.ok || !/^[A-Za-z0-9_-]{43}$/.test(json.data?.token ?? ""))
			throw new ApiError("CSRF_INVALID", res.status >= 400 ? res.status : 503);
		if (started !== identity) throw new ApiError("AUTH_REQUIRED", 401);
		csrfToken = json.data.token;
		return csrfToken as string;
	})();
	csrfPending = pending;
	try {
		return await pending;
	} finally {
		if (csrfPending === pending) csrfPending = null;
	}
}

export async function api<T>(
	url: string,
	method = "GET",
	data?: unknown,
	options: ReadOptions = {},
): Promise<T> {
	listenForSessionChanges();
	const ownerAuthAction = /^\/api\/auth\/(login|logout|verify|register)$/.test(url);
	// Guest bootstrap replaces a project cookie in this tab. It must not log out an
	// engineer workspace in another tab merely because a share link was opened.
	if (ownerAuthAction) clearApiSession();
	else if (url === "/api/guest/session") clearApiSession(true);
	if (ownerAuthAction) channel?.postMessage("invalidate");
	const started = identity;
	if (method !== "GET") queries.invalidate(mutationTags(url));
	const policy = queryPolicy(url);
	const execute = async (signal?: AbortSignal) => {
		const value = await request<T>(url, method, data, options, started, signal);
		if (method === "GET") policy.tags.splice(0, policy.tags.length, ...detailTags(url, value).tags);
		return value;
	};
	const value = await (method === "GET"
		? queries.read(
				queryKey(url, options),
				execute,
				options.cacheMs ?? policy.ttl,
				policy.tags,
				1,
				options,
			)
		: execute());
	if (method === "GET" && started !== identity) throw new ApiError("AUTH_REQUIRED", 401);
	return value;
}

async function request<T>(
	url: string,
	method: string,
	data: unknown,
	options: { key?: string; revision?: number },
	started: number,
	readSignal?: AbortSignal,
): Promise<T> {
	if (started !== identity) throw new ApiError("AUTH_REQUIRED", 401);
	const headers: Record<string, string> = {};
	if (method !== "GET") {
		headers["x-csrf-token"] = await csrfCredential();
		headers["Idempotency-Key"] = options.key ?? crypto.randomUUID();
		if (data !== undefined) headers["Content-Type"] = "application/json";
	}
	if (options.revision !== undefined) headers["X-PM-Revision"] = `"${options.revision}"`;
	if (started !== identity) throw new ApiError("AUTH_REQUIRED", 401);
	const controller = new AbortController();
	requests.add(controller);
	const init: RequestInit = {
		method,
		headers,
		cache: "no-store",
		signal: AbortSignal.any([controller.signal, ...(readSignal ? [readSignal] : []), AbortSignal.timeout(/\/uploads\/[^/]+\/(complete|retry)$/.test(url) ? 75000 : 45000)]),
	};
	if (data !== undefined) init.body = JSON.stringify(data);
	try {
		let res = await fetch(url, init);
		let result = await res.json();
		// CSRF rejects before the business handler. Retry only that explicit error, once,
		// retaining the exact operation body and idempotency key; never retry unknown writes.
		if (
			method !== "GET" &&
			res.status === 403 &&
			result.error?.code === "CSRF_INVALID" &&
			started === identity
		) {
			csrfToken = null;
			headers["x-csrf-token"] = await csrfCredential();
			res = await fetch(url, init);
			result = await res.json();
		}
		if (started !== identity) throw new ApiError("AUTH_REQUIRED", 401);
		if (res.status === 401) clearApiSession();
		if (!res.ok) throw new ApiError(result.error?.code ?? "DEPENDENCY_UNAVAILABLE", res.status);
		if (method !== "GET") queries.invalidate(mutationTags(url));
		// Cookie changes are now committed: fence other tabs' requests that started
		// between the preflight notification and the successful auth response too.
		if (/^\/api\/auth\/(login|logout|verify)$/.test(url)) {
			resetSessionData();
			channel?.postMessage("invalidate");
		}
		return result.data as T;
	} catch (e) {
		if (started !== identity && !(e instanceof ApiError && e.status === 401))
			throw new ApiError("AUTH_REQUIRED", 401);
		throw e;
	} finally {
		requests.delete(controller);
	}
}
