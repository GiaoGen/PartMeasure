import type { AnnotationDraft } from "./annotations";
import { AppError } from "./policy";
export type MeasurementField =
	| "dimension"
	| "holeDepth"
	| "angleValue"
	| "arcLength"
	| "majorRadius";
export const lengthUnits = ["mm", "cm", "m", "in"] as const;
export function unitsForField(
	field?: MeasurementField | null,
): readonly string[] {
	return field === "angleValue" ? ["deg"] : lengthUnits;
}
export const displayUnit = (unit: string | null) =>
	unit === "deg" ? "°" : (unit ?? "");
export function validateMeasurementUnit(
	field: MeasurementField | null | undefined,
	unit: string,
	value: string,
) {
	if (
		!unitsForField(field).includes(unit) ||
		(field === "angleValue" && !(Number(value) > 0 && Number(value) < 360))
	)
		throw new AppError("INVALID_MEASUREMENT_UNIT", 422);
}
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
	if (item.geometry.type === "angle") return ["angleValue"];
	if (item.geometry.type === "ellipse")
		return [
			item.metadata.ellipseMeasure === "majorRadius"
				? "majorRadius"
				: "dimension",
		];
	if (item.geometry.type === "arc")
		return (item.metadata.arcQuantities ?? ["radius"]).map((q) =>
			q === "radius" ? "dimension" : q === "angle" ? "angleValue" : "arcLength",
		);
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
	if (field === "angleValue")
		return item.geometry.type === "arc" ? "圆心角" : "角度";
	if (field === "arcLength") return "弧长";
	if (field === "majorRadius") return "长半轴 a";
	if (field === "dimension" && item.geometry.type === "ellipse") return "孔径";
	if (field === "dimension" && item.geometry.type === "arc") return "半径";
	return field === "holeDepth"
		? "孔深"
		: item.geometry.type === "circle"
			? item.metadata.circleMeasure === "radius"
				? "半径"
				: "直径"
			: "尺寸";
}
export function confirmedMetadata(
	item: AnnotationDraft,
	field: MeasurementField,
	value: string,
	unit: string,
) {
	validateMeasurementUnit(field, unit, value);
	const metadata = { ...item.metadata, [field]: value };
	if (field === "angleValue") return metadata;
	const mm: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };
	for (const other of [
		"dimension",
		"holeDepth",
		"arcLength",
		"majorRadius",
	] as const) {
		if (other === field || !metadata[other] || metadata.unit === unit) continue;
		const converted =
			(Number(metadata[other]) * (mm[metadata.unit] ?? 1)) / (mm[unit] ?? 1);
		if (!Number.isFinite(converted) || converted < 0.000001 || converted >= 1e9)
			throw new AppError("INVALID_ENGINEERING_FIELDS", 422);
		metadata[other] = converted.toFixed(6).replace(/\.?0+$/, "");
	}
	metadata.unit = unit as typeof metadata.unit;
	return metadata;
}
