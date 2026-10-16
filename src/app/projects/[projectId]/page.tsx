import { notFound, redirect } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { AppError } from "@/lib/policy";
import { owner } from "@/lib/server/auth";
import { uuid } from "@/lib/server/http";
import { projectDetail } from "@/lib/server/service";
export const dynamic = "force-dynamic";
export default async function ProjectPage({
	params,
}: {
	params: Promise<{ projectId: string }>;
}) {
	const { projectId } = await params;
	if (!uuid.safeParse(projectId).success) notFound();
	let actor: Awaited<ReturnType<typeof owner>>;
	try {
		actor = await owner();
	} catch (e) {
		if (e instanceof AppError && e.status === 401) redirect("/login");
		return (
			<main className="page">
				<h1>认证暂不可用</h1>
				<a href="/projects">重试</a>
			</main>
		);
	}
	try {
		return <Workspace initial={await projectDetail(actor, projectId)} />;
	} catch (e) {
		if (e instanceof AppError && e.status === 404) notFound();
		return (
			<main className="page">
				<h1>项目加载失败</h1>
				<p>请稍后重试。</p>
				<a href={`/projects/${projectId}`}>重新加载</a>
			</main>
		);
	}
}
