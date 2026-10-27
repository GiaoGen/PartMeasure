import { AppError } from "../../src/lib/policy";
import { dependencyHint } from "../../src/lib/server/dependency-hint";

export const isolatedRef = "rvysclscetfqicpnzlra";
type Environment = Record<string, string | undefined>;

/** No host/role fallback, proxy changes or credentials in returned evidence. */
export function connectionTarget(env: Environment, api = false) {
	const origin = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid");
	if (origin.origin !== `https://${isolatedRef}.supabase.co` || origin.username || origin.password)
		throw new AppError("ISOLATED_PROJECT_ONLY");
	if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new AppError("TLS_DOWNGRADE_REFUSED");
	for (const name of ["DATABASE_URL", "EVENT_DATABASE_URL"]) {
		const url = new URL(env[name] ?? "http://invalid");
		if (!["postgres:", "postgresql:"].includes(url.protocol) ||
			decodeURIComponent(url.username) !== `partmeasure_runtime.${isolatedRef}` ||
			!/^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) ||
			url.pathname !== "/postgres" || !url.password ||
			url.port !== (name === "DATABASE_URL" ? "6543" : "5432"))
			throw new AppError("ISOLATED_RUNTIME_POOLERS_REQUIRED");
	}
	const root = new URL(env.APP_URL ?? "http://invalid");
	if (api && (root.origin !== "http://127.0.0.1:3000" || root.href !== `${root.origin}/`))
		throw new AppError("CURRENT_LOOPBACK_ORIGIN_REQUIRED");
	return { origin, root: root.origin };
}

export function connectionMode(args: string[]) {
	if (new Set(args).size !== args.length || args.some(x => !["--probe", "--api", "--apply"].includes(x)) ||
		(args.includes("--apply") && !args.includes("--api")) ||
		(args.includes("--probe") && args.includes("--api")))
		throw new AppError("INVALID_ARGUMENTS");
	return args.includes("--apply") ? "write" : args.includes("--api") ? "read" : args.includes("--probe") ? "probe" : "configuration";
}

/** Fixed error classifications only; provider messages/codes may contain credentials. */
export function connectionFailure(error: unknown) {
	const e = error as { code?: string; cause?: { code?: string } } | null;
	const transport = [e?.code, e?.cause?.code].find(code => code !== undefined &&
		["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "ERR_TLS_CERT_ALTNAME_INVALID", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"].includes(code));
	return {
		kind: error instanceof AppError ? "check_failed" : dependencyHint(error),
		code: error instanceof AppError ? error.code : "DEPENDENCY_FAILED",
		...(transport ? { transportCode: transport } : {}),
		...(error instanceof AppError && ["API_REQUEST_FAILED", "AUTH_SETTINGS_FAILED", "PRIVATE_DOWNLOAD_FAILED"].includes(error.code) ? { httpStatus: error.status } : {}),
	};
}

export function signedUploadTarget(raw: string) {
	const url = new URL(raw);
	if (url.origin !== `https://${isolatedRef}.supabase.co` || url.username || url.password ||
		!url.pathname.startsWith("/storage/v1/object/upload/sign/partmeasure-quarantine/"))
		throw new AppError("UNEXPECTED_SIGNED_UPLOAD_ORIGIN");
	return url;
}
