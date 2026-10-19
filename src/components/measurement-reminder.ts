import type { Annotation } from "../lib/annotations";
import { measurementSchema, type methodLabel } from "../lib/issues";

type ReminderDraft = {
	fileId: string;
	annotationId: string;
	title: string;
	targetInfo: string;
	description: string;
	measurementMethod: keyof typeof methodLabel;
};

// Validate before saving, then bind the reminder to the committed revision.
// These are existing sequential requests, not an atomic publish operation.
export async function prepareMeasurementReminder(
	draft: ReminderDraft,
	prepare: () => Promise<Annotation | undefined>,
) {
	const { annotationId, ...fields } = draft;
	const validated = measurementSchema.safeParse({
		...fields,
		kind: "measurement",
		annotationRef: { id: annotationId, revision: 1 },
	});
	if (!validated.success) throw new Error("请填写名称、测量要求，并检查长度。");
	const head = await prepare();
	if (!head || head.deleted || head.id !== annotationId)
		throw new Error("标注保存未完成，请检查后重试。");
	return measurementSchema.parse({
		...validated.data,
		annotationRef: { id: head.id, revision: head.revision },
	});
}
