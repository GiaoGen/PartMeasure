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
	DATABASE_NOT_CONFIGURED: "数据库连接尚未配置。",
	DEPENDENCY_UNAVAILABLE: "服务暂时不可用，请稍后重试。",
	INVALID_CREDENTIALS: "邮箱或密码不正确，或邮箱尚未确认。",
	OTP_INVALID_OR_EXPIRED: "验证码不正确或已过期。",
	REGISTRATION_UNAVAILABLE: "暂时无法注册。请检查邮箱、密码或稍后重试。",
	RATE_LIMITED: "操作较频繁，请稍后重试。",
	UNSUPPORTED_FORMAT:
		"不支持此格式。照片请使用 JPG、PNG 或 WebP，HEIC 请先转换。",
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
	CSRF_INVALID: "页面安全凭据失效，请刷新。",
	FORBIDDEN: "当前访问方式没有此操作权限。",
	NOT_FOUND: "内容不存在或无权访问。",
};
export const message = (code: string) =>
	messages[code] ?? "操作未完成，请重试或联系工程师。";
export async function api<T>(
	url: string,
	method = "GET",
	data?: unknown,
	options: { key?: string; revision?: number } = {},
): Promise<T> {
	const headers: Record<string, string> = {};
	if (method !== "GET") {
		const tokenResponse = await fetch("/api/csrf", {
			cache: "no-store",
			signal: AbortSignal.timeout(45000),
		});
		const token = await tokenResponse.json();
		headers["x-csrf-token"] = token.data.token;
		headers["Idempotency-Key"] = options.key ?? crypto.randomUUID();
		if (data !== undefined) headers["Content-Type"] = "application/json";
	}
	if (options.revision !== undefined)
		headers["If-Match"] = `"${options.revision}"`;
	const init: RequestInit = {
		method,
		headers,
		cache: "no-store",
		signal: AbortSignal.timeout(45000),
	};
	if (data !== undefined) init.body = JSON.stringify(data);
	const res = await fetch(url, init);
	const result = await res.json();
	if (!res.ok)
		throw new ApiError(
			result.error?.code ?? "DEPENDENCY_UNAVAILABLE",
			res.status,
		);
	return result.data as T;
}
