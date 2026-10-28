import { describe, expect, it } from "vitest";
import { cloudTargetAllowed, decodeCopyField, recoveryInsert } from "../../scripts/maintenance/cloud-recovery-model";

describe("cloud recovery isolation and lossless data", () => {
	const target = "abcdefghijklmnopqrst";
	const uri = (ref = target) => new URL(`postgresql://postgres.${ref}:private@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`);
	it("refuses source, mismatched target, transaction pooler and relaxed TLS", () => {
		expect(cloudTargetAllowed(uri(), target)).toBe(true);
		expect(cloudTargetAllowed(uri("rvysclscetfqicpnzlra"), "rvysclscetfqicpnzlra")).toBe(false);
		expect(cloudTargetAllowed(uri(), "bcdefghijklmnopqrstu")).toBe(false);
		for (const mutation of [(u: URL) => { u.port = "6543"; }, (u: URL) => { u.search = "sslmode=require"; }, (u: URL) => { u.hostname = "other.example"; }, (u: URL) => { u.username = "partmeasure_runtime"; }]) {
			const u = uri(); mutation(u); expect(cloudTargetAllowed(u, target)).toBe(false);
		}
	});
	it("preserves null, literal backslash-N, escaped controls, JSON and UTF8 octets", () => {
		expect(decodeCopyField("\\N")).toBe(null);
		expect(decodeCopyField("\\\\N")).toBe("\\N");
		expect(decodeCopyField("a\\tb\\nc\\r\\\\")).toBe("a\tb\nc\r\\");
		expect(decodeCopyField("\\303\\251")).toBe("é");
		expect(decodeCopyField("\\xE4\\xB8\\xAD")).toBe("中");
		expect(decodeCopyField('{"text":"a\\\\n中"}')).toBe('{"text":"a\\n中"}');
	});
	it("binds content as parameters and refuses managed Auth tables or identifier injection", () => {
		const hostile = "'); drop schema pm cascade; --";
		const q = recoveryInsert("pm", "projects", ["id", "name"], [["one", hostile]]);
		expect(q.text).not.toContain(hostile); expect(q.values).toEqual(["one", hostile]);
		expect(recoveryInsert("pm", "file_assets", ["sha256"], [["hash"]]).text).toContain('"sha256"');
		expect(() => recoveryInsert("auth", "sessions", ["id"], [["old"]])).toThrow("UNAPPROVED_RECOVERY_TABLE");
		expect(() => recoveryInsert("auth", "mfa_amr_claims", ["id"], [["old"]])).toThrow("UNAPPROVED_RECOVERY_TABLE");
		expect(() => recoveryInsert("pm", "projects;drop", ["id"], [["one"]])).toThrow("UNSAFE_RECOVERY_IDENTIFIER");
	});
});
