/** Identity only. No private object keys, original hashes, signatures or revision/history data. */
export type FileMetadata = {
	id: string;
	filename: string;
	mime: string;
	extension: string;
	byteSize: number;
	uploaderType: "owner" | "guest";
	createdAt: string;
};
