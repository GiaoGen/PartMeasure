import { z } from "zod";
import { AppError } from "./policy";
import type { AnnotationDraft, CanonicalImage } from "./annotations";
import type { MeasurementField } from "./annotation-collaboration";

export const states = [
	"awaiting_response",
	"submitted",
	"confirmed",
	"remeasure_requested",
] as const;
export type IssueState = (typeof states)[number];
export const stateLabel: Record<IssueState, string> = {
	awaiting_response: "待补充",
	submitted: "已补充",
	confirmed: "已确认",
	remeasure_requested: "待重新补充",
};
export const methodLabel = {
	outside: "外测量爪",
	inside: "内测量爪",
	depth: "深度杆",
	other: "其他",
	unspecified: "不指定",
};
export const unitSchema = z.enum(["mm", "cm", "m", "in", "deg"]);
export const valueSchema = z
	.string()
	.max(24)
	.regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/)
	.refine((v) => Number(v) > 0);
export const measurementSchema = z
	.object({
		kind: z.literal("measurement"),
		fileId: z.uuid(),
		annotationRef: z
			.object({
				id: z.uuid(),
				revision: z.number().int().positive().max(10000),
			})
			.strict(),
		title: z.string().trim().min(1).max(120),
		targetInfo: z.string().trim().min(1).max(2000),
		description: z.string().max(4000),
		measurementMethod: z.enum([
			"outside",
			"inside",
			"depth",
			"other",
			"unspecified",
		]),
	})
	.strict();
const attachments = z
	.array(z.uuid())
	.max(10)
	.refine((ids) => new Set(ids).size === ids.length);
export const responseSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("numeric"),
			value: valueSchema,
			unit: unitSchema,
			body: z.string().max(4000),
			evidenceFileIds: attachments,
			guestLabel: z.string().trim().max(80),
		})
		.strict(),
	z
		.object({
			kind: z.literal("photo"),
			body: z.string().max(4000),
			evidenceFileIds: attachments.refine((ids) => ids.length > 0),
			guestLabel: z.string().trim().max(80),
		})
		.strict(),
	z
		.object({
			kind: z.literal("unable"),
			body: z.string().trim().min(1).max(4000),
			evidenceFileIds: attachments,
			guestLabel: z.string().trim().max(80),
		})
		.strict(),
	z
		.object({
			kind: z.literal("text"),
			body: z.string().trim().min(1).max(4000),
			evidenceFileIds: attachments,
			guestLabel: z.string().trim().max(80),
		})
		.strict(),
]);
export const reviewSchema = z
	.object({
		decision: z.enum(["confirm", "remeasure"]),
		responseId: z.uuid(),
		value: valueSchema.nullable(),
		unit: unitSchema.nullable(),
		source: z
			.enum(["customer_numeric", "owner_from_photo", "owner_manual", "comment"])
			.nullable(),
		note: z.string().max(4000),
	})
	.strict();
export type ResponseInput = z.infer<typeof responseSchema>;
export type ReviewInput = z.infer<typeof reviewSchema>;
export function nextState(
	state: IssueState,
	action: "respond" | "confirm" | "remeasure",
): IssueState {
	if (
		action === "respond" &&
		(state === "awaiting_response" || state === "remeasure_requested")
	)
		return "submitted";
	if (state === "submitted" && action === "remeasure")
		return "remeasure_requested";
	throw new AppError("INVALID_STATE", 409);
}
export function validateResponse(
	kind: "comment" | "measurement",
	input: ResponseInput,
) {
	if (
		(kind === "comment" && input.kind !== "text") ||
		(kind === "measurement" && input.kind === "text")
	)
		throw new AppError("INVALID_RESPONSE_KIND", 422);
}
export function validateReview(
	kind: "comment" | "measurement",
	response: {
		kind: ResponseInput["kind"];
		value: string | null;
		unit: string | null;
	},
	input: ReviewInput,
) {
	if (input.decision === "remeasure") {
		if (
			!input.note.trim() ||
			input.source !== null ||
			input.value !== null ||
			input.unit !== null
		)
			throw new AppError("INVALID_REVIEW", 422);
		return;
	}
	if (kind === "comment") {
		if (
			input.source !== "comment" ||
			input.value !== null ||
			input.unit !== null
		)
			throw new AppError("INVALID_REVIEW", 422);
		return;
	}
	if (
		!input.value ||
		!input.unit ||
		input.source === "comment" ||
		input.source === null
	)
		throw new AppError("INVALID_REVIEW", 422);
	if (input.source === "customer_numeric") {
		if (
			response.kind !== "numeric" ||
			input.value !== response.value ||
			input.unit !== response.unit
		)
			throw new AppError("CONFIRMATION_SOURCE_REQUIRED", 422);
	} else if (
		!input.note.trim() ||
		(input.source === "owner_from_photo" && response.kind !== "photo")
	)
		throw new AppError("CONFIRMATION_SOURCE_REQUIRED", 422);
}
export type IssueSummary = {
	/** Display-only context, supplied by the paginated list without extra HTTP reads. */
	fileLabel?: string;
	annotationLabel?: string | null;
	annotationNumber?: number | null;
	closedAt?: string | null;
	closureNote?: string;
	measurementField?: MeasurementField | null;
	id: string;
	fileId: string;
	/** Always supplied by the current API; optional for older clients/fixtures. */
	annotationRef?: { id: string; revision: number } | null;
	kind: "measurement" | "comment";
	title: string;
	description: string;
	targetInfo: string;
	measurementMethod: keyof typeof methodLabel;
	state: IssueState;
	revision: number;
	latestResponseId: string | null;
	createdAt: string;
	updatedAt: string;
};
export type Evidence = {
	id: string;
	filename: string;
	mime: string;
	byteSize: string;
	previewVersion?: string;
	thumbnail?: { version: string } | null;
};
export type IssueResponse = {
	id: string;
	issueRevision: number;
	kind: ResponseInput["kind"];
	value: string | null;
	unit: string | null;
	body: string;
	authorType: "owner" | "guest";
	guestLabel: string;
	createdAt: string;
	attachments: Evidence[];
};
export type IssueReview = ReviewInput & {
	id: string;
	issueRevision: number;
	createdAt: string;
};
export type IssueDetail = IssueSummary & {
	file: Evidence;
	target: null | {
		annotationRef: { id: string; revision: number };
		annotation: AnnotationDraft;
		image: CanonicalImage;
	};
	responses: IssueResponse[];
	reviews: IssueReview[];
};

/** A current view contains only the latest reply/review, never a complete history. */
export type IssueCurrent = IssueDetail & {
	view: "current";
	historyCount: number;
};
export type IssueCurrentPage = {
	items: IssueCurrent[];
	nextCursor: string | null;
};
export type IssueHistoryEntry =
	| { type: "response"; record: IssueResponse }
	| { type: "review"; record: IssueReview };
export type IssueHistoryPage = {
	items: IssueHistoryEntry[];
	nextCursor: string | null;
};

/** Small authoritative delta, stored with the operation's existing idempotent result. */
export type IssueWriteResult = {
	issueId: string;
	state: IssueState;
	revision: number;
	updatedAt: string;
	response?: IssueResponse;
	review?: IssueReview;
};

export function applyIssueWrite<T extends IssueDetail>(
	issue: T,
	result: IssueWriteResult,
): T | null {
	if (result.issueId !== issue.id) return null;
	if (result.revision <= issue.revision) return issue;
	if (result.revision !== issue.revision + 1 || !result.updatedAt) return null;
	if (
		result.response?.issueRevision === issue.revision &&
		result.state === "submitted"
	) {
		return {
			...issue,
			...("historyCount" in issue ? { historyCount: Number(issue.historyCount) + 1 } : {}),
			state: result.state,
			revision: result.revision,
			updatedAt: result.updatedAt,
			latestResponseId: result.response.id,
			responses: "view" in issue && issue.view === "current" ? [result.response] : [
				...issue.responses.filter((r) => r.id !== result.response?.id),
				result.response,
			],
		};
	}
	if (
		result.review?.issueRevision === issue.revision &&
		result.review.responseId === issue.latestResponseId &&
		result.state ===
			(result.review.decision === "confirm"
				? "confirmed"
				: "remeasure_requested")
	) {
		return {
			...issue,
			...("historyCount" in issue ? { historyCount: Number(issue.historyCount) + 1 } : {}),
			state: result.state,
			revision: result.revision,
			updatedAt: result.updatedAt,
			reviews: "view" in issue && issue.view === "current" ? [result.review] : [
				...issue.reviews.filter((r) => r.id !== result.review?.id),
				result.review,
			],
		};
	}
	return null;
}
