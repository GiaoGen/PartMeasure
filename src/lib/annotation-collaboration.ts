import type { AnnotationDraft } from "./annotations";
export type MeasurementField = "dimension" | "holeDepth";
export function annotationStatus(item: AnnotationDraft) {
	if (item.collaboration?.pending) return "待补充";
	if (item.collaboration?.submitted) return "待确认";
	if (item.collaboration) return "";
	return requiredMeasurements(item).some((field) => !item.metadata[field])
		? "尺寸待完善"
		: "";
}
export function requiredMeasurements(
	item: AnnotationDraft,
): MeasurementField[] {
	if (item.geometry.type === "text" || item.metadata.measurementMode === "none")
		return [];
	const result: MeasurementField[] = [];
	if (
		item.geometry.type === "line" ||
		item.geometry.type === "circle" ||
		item.metadata.measurementMode === "required"
	)
		result.push("dimension");
	if (item.geometry.type === "circle" && item.metadata.requireHoleDepth)
		result.push("holeDepth");
	return result;
}
export function measurementFieldLabel(
	item: AnnotationDraft,
	field: MeasurementField,
) {
	return field === "holeDepth"
		? "孔深"
		: item.geometry.type === "circle"
			? item.metadata.circleMeasure === "radius"
				? "半径"
				: "直径"
			: "尺寸";
}
