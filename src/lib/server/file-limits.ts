import "server-only";
import { MiB } from "../policy";
// A higher per-bucket limit cannot override Supabase Free's global 50 MB cap.
export function effectiveFileLimit() {
	const value = Number(process.env.STORAGE_MAX_FILE_BYTES ?? 50 * MiB);
	return Number.isSafeInteger(value) && value > 0
		? Math.min(value, 100 * MiB)
		: 50 * MiB;
}
