import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AppError } from "../policy";
import { digest, type Actor } from "./db";
import { appOrigin } from "./origin";
export function authConfig() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
		key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
	if (!url || !key) throw new AppError("AUTH_NOT_CONFIGURED", 503);
	return { url, key };
}
export async function authClient() {
	const { url, key } = authConfig();
	const jar = await cookies();
	return createServerClient(url, key, {
		cookieOptions: {
			httpOnly: true,
			sameSite: "lax",
			secure: appOrigin().startsWith("https:"),
			path: "/",
		},
		cookies: {
			getAll: () => jar.getAll(),
			setAll: (values) => {
				try {
					for (const { name, value, options } of values)
						jar.set(name, value, options);
				} catch {
					/* Server render: proxy refreshes cookies. */
				}
			},
		},
	});
}
export async function owner(): Promise<Actor & { kind: "owner" }> {
	const client = await authClient();
	const { data, error } = await client.auth.getUser();
	if (error) {
		const transient =
			error.name === "AuthRetryableFetchError" ||
			(error.status !== undefined &&
				(error.status >= 500 || error.status === 0));
		const known = [
			"session_not_found",
			"refresh_token_already_used",
			"refresh_token_not_found",
			"bad_jwt",
			"user_not_found",
		];
		console.warn(
			JSON.stringify({
				event: "auth_verification_failed",
				kind: transient ? "transient" : "invalid",
				code: known.includes(error.code ?? "") ? error.code : "OTHER",
				status: error.status,
			}),
		);
		if (transient) throw new AppError("DEPENDENCY_UNAVAILABLE", 503);
	}
	if (error || !data.user || !data.user.email_confirmed_at)
		throw new AppError("AUTH_REQUIRED", 401);
	return { kind: "owner", id: data.user.id };
}
export async function guest(
	projectId: string,
): Promise<Actor & { kind: "guest" }> {
	const value = (await cookies()).get(`pm_guest_${projectId}`)?.value;
	if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value))
		throw new AppError("LINK_UNAVAILABLE", 401);
	return { kind: "guest", hash: digest(value) };
}
