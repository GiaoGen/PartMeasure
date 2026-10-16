import "server-only";
import { createClient } from "@supabase/supabase-js";
import { AppError } from "../policy";
export const quarantine = "partmeasure-quarantine",
	privateBucket = "partmeasure-private";
export function storage() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
		key = process.env.SUPABASE_SECRET_KEY;
	if (!url || !key) throw new AppError("STORAGE_NOT_CONFIGURED", 503);
	return createClient(url, key, {
		auth: { persistSession: false, autoRefreshToken: false },
	}).storage;
}
export async function uploadGrant(path: string) {
	const { data, error } = await storage()
		.from(quarantine)
		.createSignedUploadUrl(path, { upsert: false });
	if (error || !data) throw new AppError("STORAGE_UNAVAILABLE", 503);
	return { signedUrl: data.signedUrl, token: data.token, path: data.path };
}
