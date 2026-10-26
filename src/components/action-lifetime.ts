/** A UI operation may finish on the server after its view closes; its old UI callback must not run. */
export class ActionLifetime {
	private controller = new AbortController();
	get signal() {
		return this.controller.signal;
	}
	capture() {
		const signal = this.signal;
		return () => !signal.aborted;
	}
	renew() {
		this.controller.abort();
		this.controller = new AbortController();
	}
	end() {
		this.controller.abort();
	}
	resume() {
		if (this.signal.aborted) this.controller = new AbortController();
	}
}
