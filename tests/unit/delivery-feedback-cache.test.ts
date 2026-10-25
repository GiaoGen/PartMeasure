import { afterEach, expect, it, vi } from "vitest";
import { api, clearApiSession, invalidateProjectQueries, readCached } from "../../src/components/api";
afterEach(() => { clearApiSession(); vi.unstubAllGlobals(); });
it("invalidates version feedback on existing delivery events and preserves role/project isolation", async () => {
	vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { items: [] } })));
	const url = "/api/projects/P/deliveries/D/feedback";
	await api(url); await api(`${url}?cursor=older`); await api(url.replace("/P/", "/Q/"));
	invalidateProjectQueries("/api/projects/P", [{ kind: "delivery.changed", entityId: "D", fileId: null, sequence: "1", revision: null, state: "feedback" }]);
	expect(readCached(url)).toBeUndefined(); expect(readCached(`${url}?cursor=older`)).toBeUndefined();
	expect(readCached(url.replace("/P/", "/Q/"))).toBeDefined();
});
