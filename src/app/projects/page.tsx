import { redirect } from "next/navigation";
import { Projects } from "@/components/projects";
import { EntryShell } from "@/components/entry-shell";
import { AppError } from "@/lib/policy";
import { owner } from "@/lib/server/auth";
import { listProjects } from "@/lib/server/service";
import { listFolders } from "@/lib/server/folder-service";
export const dynamic = "force-dynamic";
export default async function ProjectsPage() {
	let actor: Awaited<ReturnType<typeof owner>>;
	try {
		actor = await owner();
	} catch (e) {
		if (e instanceof AppError && e.status === 401) redirect("/login");
		return (
			<EntryShell
				eyebrow="项目访问"
				title="稍后继续你的项目。"
				description="资料、测量与交付，集中在同一个工作台。"
			>
				<h1>服务暂时不可用</h1>
				<p>认证服务尚未就绪，请稍后重试。</p>
				<a className="button primary" href="/login">
					返回登录
				</a>
			</EntryShell>
		);
	}
	const [projects, folders] = await Promise.allSettled([
		listProjects(actor, null), listFolders(actor),
	]);
	return <Projects
		initial={projects.status === "fulfilled" ? projects.value.items : []}
		initialCursor={projects.status === "fulfilled" ? projects.value.nextCursor ?? null : null}
		initialError={projects.status === "fulfilled" ? "" : "数据库暂时不可用，请重试。"}
		initialFolders={folders.status === "fulfilled" ? folders.value.items : []}
		initialFolderError={folders.status === "fulfilled" ? "" : "文件夹加载失败，请重试。"}
	/>;
}
