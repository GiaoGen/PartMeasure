import { randomBytes } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { appOrigin } from "./lib/server/origin";

export async function proxy(request: NextRequest) {
	const nonce = randomBytes(16).toString("base64");
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' ${supabaseUrl ?? ""} ${supabaseUrl?.replace(".supabase.co", ".storage.supabase.co") ?? ""}; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;
	const headers = new Headers(request.headers);
	headers.set("x-nonce", nonce);
	headers.set("Content-Security-Policy", csp);
	let response = NextResponse.next({ request: { headers } });
	if (
		!request.nextUrl.pathname.startsWith("/api/") &&
		supabaseUrl &&
		process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
		request.cookies.getAll().some((c) => c.name.startsWith("sb-"))
	) {
		const supabase = createServerClient(
			supabaseUrl,
			process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
			{
				cookieOptions: {
					httpOnly: true,
					sameSite: "lax",
					secure: appOrigin().startsWith("https:"),
					path: "/",
				},
				cookies: {
					getAll: () => request.cookies.getAll(),
					setAll: (values) => {
						for (const { name, value } of values)
							request.cookies.set(name, value);
						headers.set("cookie", request.cookies.toString());
						response = NextResponse.next({ request: { headers } });
						for (const { name, value, options } of values)
							response.cookies.set(name, value, options);
					},
				},
			},
		);
		try {
			await supabase.auth.getClaims();
		} catch {
			/* DAL will deny if authentication service is unavailable. */
		}
	}
	response.headers.set("Content-Security-Policy", csp);
	response.headers.set("Cache-Control", "private, no-store");
	response.headers.set("Referrer-Policy", "no-referrer");
	return response;
}
export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico|cv/).*)"],
};
