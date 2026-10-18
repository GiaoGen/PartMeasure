import { expect, it } from "vitest";
import { revisionFromHeaders } from "../../src/lib/revision";

it("separates business CAS from HTTP preconditions while accepting legacy clients", () => {
	expect(revisionFromHeaders(new Headers({ "X-PM-Revision": '"3"' }))).toBe(3);
	expect(revisionFromHeaders(new Headers({ "If-Match": '"2"' }))).toBe(2);
	expect(
		revisionFromHeaders(
			new Headers({ "X-PM-Revision": '"2"', "If-Match": '"2"' }),
		),
	).toBe(2);
});
it("rejects conflicting revision channels without choosing one silently", () => {
	expect(() =>
		revisionFromHeaders(
			new Headers({ "X-PM-Revision": '"2"', "If-Match": '"1"' }),
		),
	).toThrow("INVALID_INPUT");
});
it("requires an explicit positive bounded revision rather than wildcard or ETag lists", () => {
	for (const value of [
		null,
		"*",
		'W/"1"',
		'"1", "2"',
		'"0"',
		'"-1"',
		'"1.1"',
		'"1000000000"',
	])
		expect(() =>
			revisionFromHeaders(
				new Headers(value === null ? {} : { "X-PM-Revision": value }),
			),
		).toThrow("REVISION_REQUIRED");
});
