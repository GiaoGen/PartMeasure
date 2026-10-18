import "server-only";
import { AppError } from "../policy";
// Preview hostname comes from Vercel's trusted runtime, never a request Host header.
export function appOrigin() {
	if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) {
		const host = process.env.VERCEL_URL;
		if (!/^[a-z0-9.-]+\.vercel\.app$/i.test(host))
			throw new AppError("ORIGIN_NOT_CONFIGURED", 503);
		return `https://${host}`;
	}
	if (!process.env.APP_URL) throw new AppError("ORIGIN_NOT_CONFIGURED", 503);
	return new URL(process.env.APP_URL).origin;
}
