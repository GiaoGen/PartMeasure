import { describe, expect, it, vi } from "vitest";
import { ActionLifetime } from "../../src/components/action-lifetime";
import { lockBodyScroll } from "../../src/components/body-scroll-lock";

describe("async UI ownership", () => {
	it("does not apply a late result from a closed view", async () => {
		const owner = new ActionLifetime(),
			valid = owner.capture(),
			apply = vi.fn();
		const completion = Promise.resolve().then(() => {
			if (valid()) apply();
		});
		owner.end();
		await completion;
		expect(apply).not.toHaveBeenCalled();
	});
	it("cancels a pending confirmation when navigation replaces its context", () => {
		const owner = new ActionLifetime(),
			cancel = vi.fn(),
			old = owner.capture();
		owner.signal.addEventListener("abort", cancel);
		owner.renew();
		expect(cancel).toHaveBeenCalledOnce();
		expect(old()).toBe(false);
		expect(owner.capture()()).toBe(true);
	});
	it("resumes a remounted effect without reviving its older callbacks", () => {
		const owner = new ActionLifetime(),
			old = owner.capture();
		owner.end();
		owner.resume();
		expect(old()).toBe(false);
		expect(owner.capture()()).toBe(true);
	});
});
function documentWith(overflow: string) {
	return { body: { style: { overflow } } } as unknown as Document;
}
describe("nested native dialog scroll ownership", () => {
	it("keeps the top modal locked when the dialog below it closes first", () => {
		const target = documentWith("auto"),
			bottom = lockBodyScroll(target),
			top = lockBodyScroll(target);
		bottom();
		expect(target.body.style.overflow).toBe("hidden");
		top();
		expect(target.body.style.overflow).toBe("auto");
	});
	it("restores the initial style when the top modal closes first", () => {
		const target = documentWith(""),
			bottom = lockBodyScroll(target),
			top = lockBodyScroll(target);
		top();
		expect(target.body.style.overflow).toBe("hidden");
		bottom();
		expect(target.body.style.overflow).toBe("");
	});
	it("makes releases idempotent and preserves an existing external lock", () => {
		const target = documentWith("hidden"),
			release = lockBodyScroll(target);
		release();
		release();
		expect(target.body.style.overflow).toBe("hidden");
		const next = lockBodyScroll(target);
		next();
		expect(target.body.style.overflow).toBe("hidden");
	});
});
