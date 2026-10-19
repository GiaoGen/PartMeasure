export const projectEventKinds = [
	"project.changed",
	"access.changed",
	"file.changed",
	"annotation.changed",
	"issue.changed",
	"delivery.changed",
	"upload.changed",
] as const;
export type ProjectEvent = {
	sequence: string;
	kind: (typeof projectEventKinds)[number];
	entityId: string;
	fileId: string | null;
	revision: number | null;
	state: string | null;
};
export type ProjectChanges = {
	cursor: string;
	sequence: string;
	reset: boolean;
	events: ProjectEvent[];
};
export type ProjectUpdate = ProjectEvent | { kind: "resync" };

/** Notifications request authoritative reads; a bounded burst needs only the latest entity hint. */
export function mergeProjectUpdates(pending: ProjectUpdate[], incoming: ProjectUpdate[]) {
	const all = [...pending, ...incoming];
	if (all.some((e) => e.kind === "resync")) return [{ kind: "resync" }] as ProjectUpdate[];
	const latest = new Map<string, ProjectUpdate>();
	for (const event of all)
		if (event.kind !== "resync") latest.set(`${event.kind}:${event.entityId}`, event);
	return latest.size > 100 ? ([{ kind: "resync" }] as ProjectUpdate[]) : [...latest.values()];
}

/** Pure reducer: replay is harmless; a gap requires an authoritative resync. */
export function acceptChanges(previous: string | null, changes: ProjectChanges) {
	if (
		typeof changes?.sequence !== "string" ||
		!/^\d{1,19}$/.test(changes.sequence) ||
		BigInt(changes.sequence) > 9223372036854775807n ||
		typeof changes.cursor !== "string" ||
		!/^[A-Za-z0-9_-]{1,200}$/.test(changes.cursor) ||
		typeof changes.reset !== "boolean" ||
		!Array.isArray(changes.events) ||
		changes.events.length > 100
	)
		throw Error("INVALID_EVENT_BATCH");
	if (previous !== null && BigInt(changes.sequence) < BigInt(previous))
		return { sequence: previous, updates: [] as ProjectUpdate[] };
	if (changes.reset || previous === null)
		return { sequence: changes.sequence, updates: [{ kind: "resync" }] as ProjectUpdate[] };
	let sequence = BigInt(previous);
	const updates: ProjectUpdate[] = [];
	for (const event of changes.events) {
		if (
			!/^\d{1,19}$/.test(event.sequence) ||
			!projectEventKinds.includes(event.kind) ||
			typeof event.entityId !== "string" ||
			!/^[0-9a-f-]{36}$/i.test(event.entityId) ||
			(event.fileId !== null && !/^[0-9a-f-]{36}$/i.test(event.fileId)) ||
			(event.revision !== null &&
				(!Number.isSafeInteger(event.revision) || event.revision < 1)) ||
			(event.state !== null && (typeof event.state !== "string" || event.state.length > 64))
		)
			throw Error("INVALID_EVENT_BATCH");
		const next = BigInt(event.sequence);
		if (next <= sequence) continue;
		if (next !== sequence + 1n)
			return { sequence: changes.sequence, updates: [{ kind: "resync" }] as ProjectUpdate[] };
		sequence = next;
		updates.push(event);
	}
	if (sequence !== BigInt(changes.sequence))
		return { sequence: changes.sequence, updates: [{ kind: "resync" }] as ProjectUpdate[] };
	return { sequence: changes.sequence, updates };
}
