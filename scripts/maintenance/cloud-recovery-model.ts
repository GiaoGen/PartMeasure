import { AppError } from "../../src/lib/policy";

export const recoverySourceRef = "rvysclscetfqicpnzlra";
export const cloudAuthTables = ["users", "identities"] as const;
export const discardedAuthTables = ["schema_migrations", "audit_log_entries", "mfa_amr_claims", "sessions", "refresh_tokens", "one_time_tokens", "flow_state", "mfa_challenges", "saml_relay_states", "webauthn_challenges", "oauth_client_states"];
export const userTokenColumns = ["confirmation_token", "recovery_token", "email_change_token_new", "email_change_token_current", "phone_change_token", "reauthentication_token", "email_change", "phone_change"];

export function cloudTargetAllowed(url: URL, targetRef: string) {
	return /^[a-z]{20}$/.test(targetRef) && targetRef !== recoverySourceRef &&
		["postgres:", "postgresql:"].includes(url.protocol) && !url.hash &&
		[...url.searchParams.keys()].every(k => k === "sslmode") &&
		(!url.searchParams.has("sslmode") || url.searchParams.get("sslmode") === "verify-full") &&
		url.port === "5432" && url.pathname === "/postgres" && Boolean(url.password) &&
		((decodeURIComponent(url.username) === `postgres.${targetRef}` && /^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname)) ||
		(url.username === "postgres" && url.hostname === `db.${targetRef}.supabase.co`));
}
export function recoveryIdentifier(value: string) {
	if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new AppError("UNSAFE_RECOVERY_IDENTIFIER", 422);
	return `"${value}"`;
}
/** COPY's text format is not TSV/CSV: escapes and null must survive exactly. */
export function decodeCopyField(raw: string): string | null {
	if (raw === "\\N") return null;
	const pieces: Buffer[] = []; let start = 0;
	for (let i = 0; i < raw.length; i++) {
		if (raw[i] !== "\\") continue;
		pieces.push(Buffer.from(raw.slice(start, i), "utf8")); i++;
		const next = raw[i]; if (next === undefined) throw new AppError("MALFORMED_COPY_ESCAPE", 422);
		const simple: Record<string, number> = { b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92 };
		if (Object.hasOwn(simple, next)) pieces.push(Buffer.from([simple[next] ?? 0]));
		else if (/[0-7]/.test(next)) {
			const match = raw.slice(i).match(/^[0-7]{1,3}/)?.[0]; if (!match) throw Error("MALFORMED_COPY_ESCAPE");
			pieces.push(Buffer.from([Number.parseInt(match, 8)])); i += match.length - 1;
		} else if (next === "x" && /^[a-f0-9]/i.test(raw[i + 1] ?? "")) {
			const match = raw.slice(i + 1).match(/^[a-f0-9]{1,2}/i)?.[0]; if (!match) throw Error("MALFORMED_COPY_ESCAPE");
			pieces.push(Buffer.from([Number.parseInt(match, 16)])); i += match.length;
		} else pieces.push(Buffer.from(next, "utf8"));
		start = i + 1;
	}
	pieces.push(Buffer.from(raw.slice(start), "utf8")); return Buffer.concat(pieces).toString("utf8");
}
export function recoveryInsert(schema: string, table: string, columns: string[], rows: (string | null)[][]) {
	if (!rows.length || rows.length > 50 || !columns.length || columns.length > 100 || rows.some(r => r.length !== columns.length)) throw Error("INVALID_RECOVERY_BATCH");
	if (!["pm", "supabase_migrations"].includes(schema) && !(schema === "auth" && cloudAuthTables.some(t => t === table))) throw Error("UNAPPROVED_RECOVERY_TABLE");
	const values = rows.flat();
	return { text: `insert into ${recoveryIdentifier(schema)}.${recoveryIdentifier(table)} (${columns.map(recoveryIdentifier).join(",")}) overriding system value values ${rows.map((_, row) => `(${columns.map((_, col) => `$${row * columns.length + col + 1}`).join(",")})`).join(",")}`, values };
}
