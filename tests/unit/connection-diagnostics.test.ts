import { describe, expect, it } from "vitest";
import { connectionFailure, connectionMode, connectionTarget, isolatedRef, signedUploadTarget } from "../../scripts/maintenance/connection-model";
import { AppError } from "../../src/lib/policy";

const env = {
	NEXT_PUBLIC_SUPABASE_URL: `https://${isolatedRef}.supabase.co`,
	APP_URL: "http://127.0.0.1:3000",
	DATABASE_URL: `postgresql://partmeasure_runtime.${isolatedRef}:test@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`,
	EVENT_DATABASE_URL: `postgresql://partmeasure_runtime.${isolatedRef}:test@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`,
};
describe("isolated connection checks (configuration and redaction only, no network)", () => {
	it("does no live work by default and requires both explicit API and apply for writes", () => {
		expect(connectionMode([])).toBe("configuration");
		expect(connectionMode(["--probe"])).toBe("probe");
		expect(connectionMode(["--api"])).toBe("read");
		expect(connectionMode(["--api", "--apply"])).toBe("write");
		for (const args of [["--apply"], ["--probe", "--api"], ["--api", "--api"], ["--target", "other"]])
			expect(() => connectionMode(args)).toThrow("INVALID_ARGUMENTS");
	});
	it("accepts only the existing restricted isolated poolers and local API origin", () => {
		expect(connectionTarget(env, true).root).toBe(env.APP_URL);
		for (const patch of [
			{ NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" },
			{ DATABASE_URL: env.DATABASE_URL.replace("partmeasure_runtime", "postgres") },
			{ DATABASE_URL: env.DATABASE_URL.replace(isolatedRef, "other") },
			{ DATABASE_URL: env.DATABASE_URL.replace(".pooler.supabase.com", ".pooler.supabase.com.example.org") },
			{ EVENT_DATABASE_URL: env.EVENT_DATABASE_URL.replace(":5432/", ":6543/") },
			{ NODE_TLS_REJECT_UNAUTHORIZED: "0" },
			{ APP_URL: "https://example.org" },
			{ APP_URL: `${env.APP_URL}/somewhere` },
		]) expect(() => connectionTarget({ ...env, ...patch }, true)).toThrow();
	});
	it("never returns arbitrary dependency messages or codes in evidence", () => {
		const error = Object.assign(Error("postgresql://private:secret@example.org and private /s/token"), { code: "PRIVATE_PASSWORD" });
		expect(connectionFailure(error)).toEqual({ kind: "unclassified", code: "DEPENDENCY_FAILED" });
		expect(connectionFailure(Object.assign(Error("redacted"), { code: "ENOTFOUND" })).kind).toBe("dns");
	});
	it("only uploads synthetic bytes to the original private quarantine origin", () => {
		const url = `https://${isolatedRef}.supabase.co/storage/v1/object/upload/sign/partmeasure-quarantine/synthetic?token=private`;
		expect(signedUploadTarget(url).protocol).toBe("https:");
		for (const invalid of [url.replace("https:", "http:"), url.replace(isolatedRef, "other"), url.replace("partmeasure-quarantine", "public"), url.replace(".co/", ".co.example.org/")])
			expect(() => signedUploadTarget(invalid)).toThrow();
	});
	it("distinguishes a local assertion failure from an actual HTTP rejection", () => {
		expect(connectionFailure(new AppError("PRIVATE_HASH_MISMATCH"))).not.toHaveProperty("httpStatus");
		expect(connectionFailure(new AppError("API_REQUEST_FAILED", 503))).toHaveProperty("httpStatus", 503);
	});
});
