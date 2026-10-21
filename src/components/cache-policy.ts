import type { ProjectUpdate } from "@/lib/project-events";
export function queryPolicy(url: string) {
	const parsed = new URL(url, "http://cache.invalid");
	const match = parsed.pathname.match(/^(\/api\/(?:guest\/)?projects\/[^/]+)(?:\/(.*))?$/);
	if (!match) {
		const list =
			parsed.pathname === "/api/projects" || parsed.pathname.startsWith("/api/project-folders");
		return { tags: [list ? "projects:list" : parsed.pathname], ttl: list ? 3000 : 0 };
	}
	const base = match[1] ?? parsed.pathname,
		parts = (match[2] ?? "").split("/"),
		tags = [base];
	if (!match[2]) tags.push(`${base}:project`);
	else if (parts[0] === "files")
		tags.push(parts[2] === "annotations" ? `${base}:annotations:${parts[1]}` : `${base}:files`);
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
	if (parts[0] === "files" && parts[2] === "issues") tags.push(`${base}:issues:file:${parts[1]}`, `${base}:issues:all`);
	if (parts[0] === "files" && parts[2] === "annotations") tags.push(`${base}:annotations:all`);
	return { tags, ttl: ["changes", "events", "uploads"].includes(parts[0] ?? "") ? 0 : 3000 };
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
	if (path.startsWith("/issues")) return [`${base}:issues:all`, `${base}:annotations:all`, `${base}:files`];
	if (path.startsWith("/annotations")) return [`${base}:annotations:all`, `${base}:files`, `${base}:issues:all`];
	if (path.startsWith("/share-links")) return [base];
	if (!path) return [`${base}:project`, "projects:list"];
	return policy.tags.slice(1);
}
