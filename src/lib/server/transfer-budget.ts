import "server-only";
import { AppError } from "../policy";

/** In-flight resources only. Durable request throttles remain database-backed. */
export class TransferBudget {
	private active = 0;
	private actors = new Map<string, number>();
	constructor(private total = 24, private perActor = 8) {}
	acquire(actor: string) {
		const count = this.actors.get(actor) ?? 0;
		if (this.active >= this.total || count >= this.perActor) throw new AppError("TRANSFER_BUSY", 429);
		this.active++;
		this.actors.set(actor, count + 1);
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.active--;
			const next = (this.actors.get(actor) ?? 1) - 1;
			if (next) this.actors.set(actor, next);
			else this.actors.delete(actor);
		};
	}
}
