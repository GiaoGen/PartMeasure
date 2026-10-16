import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AppError } from "../policy";
import { digest, type Actor } from "./db";
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
			secure: process.env.APP_URL?.startsWith("https:") ?? false,
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
