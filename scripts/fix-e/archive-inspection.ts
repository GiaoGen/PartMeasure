// Offline verification of the real pg_dump archive. Never connects to a database.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { backupKey } from "../maintenance/encrypted-file";
import { authenticatedBackup } from "../maintenance/restore";
import { postgresTool } from "../maintenance/postgres-tools";

async function main() {
	const [run] = process.argv.slice(2); assert.equal(process.argv.length, 3);
	assert.match(run as string, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
	const state = JSON.parse(await readFile(`tmp/fix-e/${run}/state.json`, "utf8"));
	assert.equal(state.run, run); assert.equal(state.backupAttempt, "complete");
	const signal = AbortSignal.timeout(120000);
	const result = await authenticatedBackup({ directory: state.environment.PM_BACKUP_SET, workspace: path.resolve("tmp/backups", `archive-check-${randomUUID()}`), key: await backupKey(state.environment.PM_BACKUP_KEY_FILE), signal }, async ({ manifest, staging }) => {
		const tool = postgresTool(state.environment.PM_POSTGRES_BIN, "pg_restore", ["--list", path.join(staging, manifest.database.file)], process.env, signal);
		let output = "";
		try {
			for await (const chunk of tool.output) { output += String(chunk); if (Buffer.byteLength(output) > 2*1024*1024) throw Error("ARCHIVE_INDEX_LIMIT"); }
			await tool.done;
		} catch (error) { tool.stop(); throw error; }
		const lines = output.split(/\r?\n/), tables = lines.filter(line => /^\d+;\s+\d+\s+\d+\s+TABLE\s+pm\s+/.test(line));
		const data = lines.filter(line => /^\d+;\s+\d+\s+\d+\s+TABLE DATA\s+pm\s+/.test(line));
		assert.equal(tables.length, Object.keys(manifest.tables).length); assert.equal(data.length, tables.length);
		for (const name of ["users", "identities"]) assert.ok(lines.some(line => new RegExp(`TABLE DATA\\s+auth\\s+${name}\\s+`).test(line)));
		for (const name of ["sessions", "refresh_tokens", "one_time_tokens", "flow_state", "mfa_challenges", "saml_relay_states"])
			assert.ok(!lines.some(line => new RegExp(`TABLE DATA\\s+auth\\s+${name}\\s+`).test(line)));
		return { businessTables: tables.length, businessDataTables: data.length, authUsersAndIdentitiesIncluded: true, activeAuthCapabilityTableDataExcluded: true,
			archiveReadableByPgRestore: true, objectsAuthenticated: manifest.objects.length, plaintextBytesAuthenticated: manifest.database.bytes+manifest.objects.reduce((n,v)=>n+v.bytes,0), cloudRestorePerformed: false };
	});
	await writeFile(`docs/evidence/fix-e/${run}-archive.json`, `${JSON.stringify({ checkedAt: new Date().toISOString(), status: "PASS", scope: "Offline full-artifact authentication and pg_restore archive inventory. Not actual DB application, target compatibility, new login or cloud Storage restoration.", ...result }, null, 2)}\n`);
	console.log(JSON.stringify(result));
}
main().catch(() => { console.error("BACKUP_ARCHIVE_INSPECTION_FAILED (details redacted)"); process.exitCode = 1; });
