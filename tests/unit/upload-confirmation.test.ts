import { expect, it } from "vitest";
import { uploadOrConfirm } from "../../scripts/maintenance/upload-confirmation";
it("confirms an ambiguous committed write without uploading again", async () => {
	let writes = 0; const r = await uploadOrConfirm({ expectedBytes: 123, write: async () => { writes++; return { data: null, error: { name: "StorageUnknownError", message: "timeout" } }; }, inspect: async () => ({ data: { size: 123 }, error: null }), onFailure() {} });
	expect(writes).toBe(1); expect(r.ambiguousCommitConfirmed).toBe(true);
});
it("permits one retry only after a transient failure and confirmed absence", async () => {
	let writes = 0; const r = await uploadOrConfirm({ expectedBytes: 123, write: async () => ++writes === 1 ? { data: null, error: { statusCode: "503" } } : { data: {}, error: null }, inspect: async () => ({ data: null, error: { statusCode: "404", message: "Object not found" } }), onFailure() {} });
	expect(writes).toBe(2); expect(r.attempts).toBe(2);
});
it("does not retry an uncertain 503 inspection, a permission denial, or overwrite a size mismatch", async () => {
	for (const [writeError, inspection, reason] of [
		[{ statusCode: "503" }, { data: null, error: { statusCode: "503" } }, "UPLOAD_UNCONFIRMED_NO_BLIND_RETRY"],
		[{ statusCode: "403" }, { data: null, error: { statusCode: "404", message: "Object not found" } }, "UPLOAD_UNCONFIRMED_NO_BLIND_RETRY"],
		[{ statusCode: "409" }, { data: { size: 12 }, error: null }, "EXISTING_OBJECT_SIZE_MISMATCH_NO_OVERWRITE"],
	] as const) {
		let writes = 0; await expect(uploadOrConfirm({ expectedBytes: 123, write: async () => { writes++; return { data: null, error: writeError }; }, inspect: async () => inspection, onFailure() {} })).rejects.toThrow(reason); expect(writes).toBe(1);
	}
});
