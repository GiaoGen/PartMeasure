type StorageFailure = { statusCode?: string | number; name?: string; message?: string; originalError?: { name?: string; code?: string; cause?: { code?: string } } };
type Result<T> = { data: T | null; error: unknown };
export function storageFailureMeta(raw: unknown) {
	const e = (raw ?? {}) as StorageFailure;
	const status = Number(e.statusCode);
	const cause = e.originalError?.cause?.code ?? e.originalError?.code;
	return { httpStatus: Number.isInteger(status) && status >= 400 && status < 600 ? status : undefined,
		errorKind: ["StorageApiError", "StorageUnknownError", "TimeoutError", "AbortError"].includes(e.name ?? "") ? e.name : "STORAGE_ERROR",
		transportCode: typeof cause === "string" && ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"].includes(cause) ? cause : undefined,
		timeout: /timeout|timed out|abort/i.test(`${e.message ?? ""} ${e.originalError?.name ?? ""}`) };
}
function missing(raw: unknown) {
	const e = raw as StorageFailure;
	return [400, 404].includes(Number(e?.statusCode)) && /not.?found|NoSuchKey/i.test(e?.message ?? "");
}
/** A failed response does not prove a failed write. Confirm existence before any retry. */
export async function uploadOrConfirm(options: {
	write: () => Promise<Result<unknown>>;
	inspect: () => Promise<Result<{ size?: number }>>;
	expectedBytes: number;
	onFailure: (value: ReturnType<typeof storageFailureMeta> & { attempt: number }) => void;
}) {
	for (let attempt = 1; attempt <= 2; attempt++) {
		let result: Result<unknown>;
		try { result = await options.write(); } catch (error) { result = { data: null, error }; }
		if (!result.error) return { attempts: attempt, ambiguousCommitConfirmed: false };
		const meta = storageFailureMeta(result.error); options.onFailure({ ...meta, attempt });
		let state: Result<{ size?: number }>;
		try { state = await options.inspect(); } catch (error) { state = { data: null, error }; }
		if (!state.error && state.data) {
			if (Number(state.data.size) !== options.expectedBytes) throw Error("EXISTING_OBJECT_SIZE_MISMATCH_NO_OVERWRITE");
			return { attempts: attempt, ambiguousCommitConfirmed: true };
		}
		const transient = meta.httpStatus === undefined || meta.httpStatus >= 500 || meta.httpStatus === 429;
		if (attempt === 1 && transient && missing(state.error)) continue;
		const failure = Object.assign(Error("UPLOAD_UNCONFIRMED_NO_BLIND_RETRY"), { storage: meta, inspection: storageFailureMeta(state.error) }); throw failure;
	}
	throw Error("UPLOAD_ATTEMPT_LIMIT");
}
