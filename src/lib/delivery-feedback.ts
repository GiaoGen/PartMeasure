import { z } from "zod";

export const feedbackInputSchema = z.object({
	kind: z.enum(["comment", "received", "accepted", "withdrawn"]),
	body: z.string().trim().max(4000).default(""),
	guestLabel: z.string().trim().max(80).default(""),
	targetId: z.uuid().optional(),
}).strict().superRefine((value, context) => {
	if (value.kind === "comment" && !value.body)
		context.addIssue({ code: "custom", path: ["body"], message: "请填写留言。" });
	if ((value.kind === "withdrawn") !== !!value.targetId)
		context.addIssue({ code: "custom", path: ["targetId"], message: "撤销需关联本次接收记录。" });
});
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;
export type DeliveryFeedback = {
	id: string;
	kind: FeedbackInput["kind"];
	body: string;
	guestLabel: string;
	authorType: "guest";
	createdAt: string;
	targetId: string | null;
	receiptState: "current" | "superseded" | "withdrawn" | null;
};
export type Receipt = { id: string; kind: "received" | "accepted"; createdAt: string };
export type FeedbackPage = {
	items: DeliveryFeedback[];
	nextCursor: string | null;
	total: number;
	receipts: { received: number; accepted: number };
	myReceipt: Receipt | null;
};
export const feedbackKindLabel = { comment: "留言", received: "已收到", accepted: "接受本版", withdrawn: "撤销接收记录" } as const;
