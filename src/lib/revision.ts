import { AppError } from "./policy";
// Business CAS is separate from HTTP representation ETags handled by intermediaries.
export function revisionFromHeaders(headers: Headers) {
	const preferred = headers.get("x-pm-revision");
	const legacy = headers.get("if-match");
	if (preferred && legacy && preferred !== legacy)
		throw new AppError("INVALID_INPUT", 422);
	const value = preferred ?? legacy;
	if (!value || !/^"[1-9]\d{0,8}"$/.test(value))
		throw new AppError("REVISION_REQUIRED", 428);
	return Number(value.slice(1, -1));
}
