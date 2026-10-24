import { type AnnotationDraft, type CanonicalImage, type Geometry, emptyMetadata, sameContent, validateAnnotation } from "../annotations";

export type CvDraftTicket = { id: string; imageId: string; imageHash: string; version: number; geometry: Geometry };
export function cvDraftUpdate(ticket: CvDraftTicket, output: Geometry, context: {
	image: CanonicalImage; current: AnnotationDraft | undefined; selected: string | null; version: number; saved: boolean; editable: boolean;
}): AnnotationDraft | null {
	const { image, current } = context;
	if (!context.editable || context.saved || context.selected !== ticket.id || context.version !== ticket.version || image.id !== ticket.imageId || image.imageHash !== ticket.imageHash || current?.id !== ticket.id || !sameContent(current.geometry, ticket.geometry) || output.type !== ticket.geometry.type) return null;
	try { validateAnnotation(output, emptyMetadata(), image.width, image.height); } catch { return null; }
	return sameContent(current.geometry, output) ? null : { ...current, geometry: output };
}
