import { redirect } from "next/navigation";
import { Projects } from "@/components/projects";
import { ProjectEntryLoading } from "@/components/project-entry-loading";
import { parseProjectList } from "@/components/project-list-navigation";
import { AppError } from "@/lib/policy";
import { owner } from "@/lib/server/auth";
import { listProjects } from "@/lib/server/service";
import { listFolders } from "@/lib/server/folder-service";
export const dynamic = "force-dynamic";
// The URL remains /projects; list-only boundaries do not wrap the workspace.
export default async function ProjectsPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const raw = await searchParams;
	const params = new URLSearchParams();
	for (const key of ["folderId", "q", "status"]) {
		const value = raw[key];
		if (typeof value === "string") params.set(key, value);
	}
	const filters = parseProjectList(params);
	let actor: Awaited<ReturnType<typeof owner>>;
	try {
		actor = await owner();
	} catch (e) {
		if (e instanceof AppError && e.status === 401) redirect("/login");
		return <ProjectEntryLoading error="认证服务暂时无法连接，请稍后重试。" />;
	}
	const [projects, folders] = await Promise.allSettled([
		listProjects(actor, null, {
			...filters,
			folderId: filters.folderId || null,
		}),
		listFolders(actor),
	]);
	return (
		<Projects
			initial={projects.status === "fulfilled" ? projects.value.items : []}
			initialCursor={
				projects.status === "fulfilled"
					? (projects.value.nextCursor ?? null)
					: null
			}
			initialError={
				projects.status === "fulfilled" ? "" : "数据库暂时不可用，请重试。"
			}
			initialFolders={folders.status === "fulfilled" ? folders.value.items : []}
			initialFolderError={
				folders.status === "fulfilled" ? "" : "文件夹加载失败，请重试。"
			}
			initialFilters={filters}
			initialCount={
				projects.status === "fulfilled"
					? projects.value.counts.searchMatchCount
					: null
			}
		/>
	);
}
