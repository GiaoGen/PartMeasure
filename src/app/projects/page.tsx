import { redirect } from "next/navigation";
import { Projects } from "@/components/projects";
import { AppError } from "@/lib/policy";
import { owner } from "@/lib/server/auth";
import { listProjects } from "@/lib/server/service";
export const dynamic = "force-dynamic";
export default async function ProjectsPage() {
	let actor: Awaited<ReturnType<typeof owner>>;
	try {
		actor = await owner();
	} catch (e) {
		if (e instanceof AppError && e.status === 401) redirect("/login");
		return (
			<main className="page">
				<h1>服务暂时不可用</h1>
				<p>认证服务尚未就绪，请稍后重试。</p>
				<a href="/login">返回登录</a>
			</main>
		);
	}
	try {
		const data = await listProjects(actor, null);
		return (
			<Projects
				initial={data.items}
				initialCursor={data.nextCursor ?? null}
				initialError=""
			/>
		);
	} catch {
		return (
			<Projects
				initial={[]}
				initialCursor={null}
				initialError="数据库暂时不可用，请重试。"
			/>
		);
	}
}
