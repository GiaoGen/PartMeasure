import type { IssueDetail, IssueSummary } from "../lib/issues";

// The existing list DTO omits annotationRef. Resolve only the current page,
// with bounded concurrency, and never infer an association from a title.
export async function resolveAnnotationReminders(
	items: IssueSummary[],
	fileId: string,
	annotationId: string,
	read: (id: string) => Promise<IssueDetail>,
	current: () => boolean = () => true,
) {
	const candidates = items.filter(
		(item) => item.kind === "measurement" && item.fileId === fileId,
	);
	const results = new Map<string, IssueDetail>();
	let cursor = 0,
		stopped = false;
	await Promise.all(
		Array.from({ length: Math.min(4, candidates.length) }, async () => {
			while (current() && !stopped) {
				const item = candidates[cursor++];
				if (!item) return;
				let detail: IssueDetail;
				try {
					detail = await read(item.id);
				} catch (error) {
					stopped = true;
					throw error;
				}
				if (
					current() &&
					detail.id === item.id &&
					detail.fileId === fileId &&
					detail.target?.annotationRef.id === annotationId
				)
					results.set(item.id, detail);
			}
		}),
	);
	return candidates.flatMap((item) => {
		const detail = results.get(item.id);
		return detail ? [detail] : [];
	});
}
