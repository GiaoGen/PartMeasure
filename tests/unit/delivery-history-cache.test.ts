import { afterEach, describe, expect, it, vi } from "vitest";
import { api, clearApiSession, invalidateProjectQueries, readCached } from "../../src/components/api";

afterEach(() => { clearApiSession(); vi.unstubAllGlobals(); });
describe("delivery history shares existing cache and event invalidation", () => {
	it("invalidates summary pages and expanded versions on publication, within the matching project", async () => {
		const fetch = vi.fn(async () => Response.json({ data: { items: [] } }));
		vi.stubGlobal("fetch", fetch);
		const urls = ["/api/projects/P/deliveries", "/api/projects/P/deliveries?view=history&beforeVersion=3", "/api/projects/P/deliveries/D", "/api/projects/Q/deliveries?view=history&beforeVersion=3"];
		await Promise.all(urls.map(url => api(url)));
		invalidateProjectQueries("/api/projects/P", [{ kind: "delivery.changed", sequence: "1", entityId: "D", fileId: null, revision: 2, state: "published" }]);
		for (const url of urls.slice(0, 3)) expect(readCached(url)).toBeUndefined();
		expect(readCached(urls[3] as string)).toBeDefined();
		await api(urls[1] as string);
		expect(fetch).toHaveBeenCalledTimes(5);
	});
	it("shares repeat reads while isolating roles, pages and version boundaries", async () => {
		const fetch = vi.fn(async () => Response.json({ data: { items: [] } }));
		vi.stubGlobal("fetch", fetch);
		const url = "/api/projects/P/deliveries?view=history&beforeVersion=3";
		await Promise.all([api(url), api(url)]);
		await api(`${url}&cursor=older`);
		await api(url.replace("=3", "=4"));
		await api(url.replace("/api/projects", "/api/guest/projects"));
		expect(fetch).toHaveBeenCalledTimes(4);
		clearApiSession();
		expect(readCached(url)).toBeUndefined();
	});
});
