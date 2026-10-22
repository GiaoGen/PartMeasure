export type ImageAccess = {
	namespace: string;
	items: { id: string; images: { variant: number | null; version: string; bytes: number }[] }[];
};
