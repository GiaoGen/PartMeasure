import type { ProjectUpdate } from "@/lib/project-events";
export function queryPolicy(url: string) {
	const parsed = new URL(url, "http://cache.invalid");
	const match = parsed.pathname.match(/^(\/api\/(?:guest\/)?projects\/[^/]+)(?:\/(.*))?$/);
	if (!match) {
		const list =
			parsed.pathname === "/api/projects" || parsed.pathname.startsWith("/api/project-folders");
		return { tags: [list ? "projects:list" : parsed.pathname], ttl: list || parsed.pathname === "/api/upload-policy" ? 30000 : 0 };
	}
	const base = match[1] ?? parsed.pathname,
		parts = (match[2] ?? "").split("/"),
		tags = [base];
	if (!match[2]) tags.push(`${base}:project`);
	else if (parts[0] === "inbox") tags.push(`${base}:issues:all`, `${base}:issue-lists`, `${base}:evidence:all`);
	else if (parts[0] === "file-layers") {
		for (const id of parsed.searchParams.get("ids")?.split(",") ?? []) tags.push(`${base}:annotations:${id}`);
		tags.push(`${base}:annotations:all`);
	} else if (parts[0] === "issue-views") {
		for (const id of parsed.searchParams.get("ids")?.split(",") ?? []) tags.push(`${base}:issue:${id}`);
		tags.push(`${base}:issues:all`, `${base}:evidence:all`);
	}
	else if (parts[0] === "files")
		tags.push(parts[2] === "annotations" || parts[2] === "interaction" ? `${base}:annotations:${parts[1]}` : ["issues", "collaboration"].includes(parts[2] ?? "") ? `${base}:issues:file:${parts[1]}` : `${base}:files`);
	else if (parts[0] === "issues") {
		if (parts[1]) tags.push(`${base}:issue:${parts[1]}`);
		else
			tags.push(
				parsed.searchParams.has("fileId")
					? `${base}:issues:file:${parsed.searchParams.get("fileId")}`
					: `${base}:issues:list`,
			);
	} else tags.push(`${base}:${parts[0]}`);
	if (parts[0] === "issues") tags.push(`${base}:issues:all`);
	if ((parts[0] === "issues" && !parts[1]) || (parts[0] === "files" && parts[2] === "issues")) tags.push(`${base}:issue-lists`);
	if (parts[0] === "files" && parts[2] === "issues") tags.push(`${base}:issues:file:${parts[1]}`, `${base}:issues:all`);
	if (parts[0] === "files" && parts[2] === "annotations") tags.push(`${base}:annotations:all`);
	if (parts[0] === "files" && ["collaboration", "interaction"].includes(parts[2] ?? "")) tags.push(`${base}:issues:file:${parts[1]}`, `${base}:issues:all`, `${base}:issue-lists`, `${base}:evidence:all`, `${base}:annotations:${parts[1]}`, `${base}:annotations:all`);
	if (parts[0] === "issues" && ["current", "history-page"].includes(parts[2] ?? "")) tags.push(`${base}:evidence:all`);
	return { tags, ttl: ["changes", "events", "uploads"].includes(parts[0] ?? "") ? 0 : 30000 };
}
export function eventTags(base: string, updates: ProjectUpdate[]) {
	const tags = new Set<string>();
	for (const e of updates)
		switch (e.kind) {
			case "resync":
			case "access.changed":
				tags.add(base);
				tags.add("projects:list");
				break;
			case "project.changed":
				tags.add(`${base}:project`);
				tags.add("projects:list");
				break;
			case "file.changed":
				tags.add(`${base}:files`);
				tags.add(`${base}:uploads`);
				tags.add(`${base}:evidence:all`);
				if (e.fileId) tags.add(`${base}:evidence:${e.fileId}`);
				if (e.fileId && e.state !== "ready") {
					tags.add(`${base}:annotations:${e.fileId}`);
					tags.add(`${base}:issues:all`);
				}
				break;
			case "annotation.changed":
				tags.add(`${base}:files`);
				if (e.fileId) tags.add(`${base}:annotations:${e.fileId}`);
				break;
			case "issue.changed":
				if (e.fileId) tags.add(`${base}:annotations:${e.fileId}`);
				tags.add(`${base}:issue:${e.entityId}`);
				tags.add(`${base}:issues:list`);
				if (e.fileId) tags.add(`${base}:issues:file:${e.fileId}`);
				else tags.add(`${base}:issues:all`);
				break;
			case "delivery.changed":
				tags.add(`${base}:deliveries`);
				tags.add(`${base}:files`);
				break;
			case "upload.changed":
				tags.add(`${base}:uploads`);
				break;
		}
	return [...tags];
}
export function mutationTags(url: string) {
	const policy = queryPolicy(url),
		base = policy.tags[0];
	if (!base?.match(/^\/api\/(?:guest\/)?projects\//)) return policy.tags;
	const path = new URL(url, "http://cache.invalid").pathname.slice(base.length);
	if (path.startsWith("/issues/")) return [`${base}:issue:${path.split("/")[2]}`, `${base}:issue-lists`, `${base}:annotations:all`, `${base}:files`];
	if (path === "/issues") return [`${base}:issues:all`, `${base}:annotations:all`, `${base}:files`];
	if (path.startsWith("/annotations")) return [`${base}:annotations:all`, `${base}:files`, `${base}:issues:all`];
	if (path.startsWith("/share-links")) return [base];
	if (!path) return [`${base}:project`, "projects:list"];
	return policy.tags.slice(1);
}
