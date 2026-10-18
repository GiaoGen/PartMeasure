import { z } from "zod";
export const deliveryDraftSchema = z
	.object({
		description: z.string().max(4000),
		fileIds: z
			.array(z.uuid())
			.max(20)
			.refine((ids) => new Set(ids).size === ids.length),
	})
	.strict();
export type DeliveryDraftInput = z.infer<typeof deliveryDraftSchema>;
export type DeliveryFile = {
	id: string;
	filename: string;
	mime: string;
	byteSize: string;
};
export type Delivery = {
	id: string;
	description: string;
	state: "draft" | "published";
	revision: number;
	versionNo: number | null;
	createdAt: string;
	publishedAt: string | null;
	files: DeliveryFile[];
};
export const versionLabel = (n: number) => `V${String(n).padStart(3, "0")}`;
