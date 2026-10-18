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
	REVISION_REQUIRED: "页面缺少资料修订，请保留输入并重新载入。",
	CSRF_INVALID: "页面安全凭据失效，请刷新。",
	FORBIDDEN: "当前访问方式没有此操作权限。",
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
	INVALID_STATE: "任务状态已变化，当前不能执行此操作，请重新载入。",
	INVALID_RESPONSE_KIND: "回复方式与任务类型不一致。",
	INVALID_REVIEW: "请核对审核决定、最终值与说明。",
	CONFIRMATION_SOURCE_REQUIRED: "人工录入或修正必须标明来源并填写说明。",
	PHOTO_EVIDENCE_REQUIRED: "请上传并选择至少一张处理完成的测量照片。",
	ATTACHMENT_UNAVAILABLE: "附件不可用，请选择本项目中处理完成且可共享的文件。",
	RESPONSE_CONFLICT: "最新回复已变化，请重新载入后审核。",
	RESPONSE_LIMIT: "该任务已达到100轮回复上限，请由工程师新建请求。",
	DELIVERY_FILE_UNAVAILABLE:
		"成果附件不可用，请选择本项目中处理完成的工程师成果文件。",
	DELIVERY_PUBLISHED:
		"这份成果已经发布，不能覆盖。请重新载入查看，或准备新的成果集合。",
	DELIVERY_FILES_REQUIRED: "请选择1～20个处理完成的成果附件，再发布。",
	DELIVERY_DRAFT_LIMIT: "当前已有5份交付草稿，请先完成已有草稿。",
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
		headers["X-PM-Revision"] = `"${options.revision}"`;
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
