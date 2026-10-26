import { notFound, redirect } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { WorkspaceStatus } from "@/components/workspace-status";
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
			<WorkspaceStatus
				title="认证暂不可用"
				message="请重新加载，或返回项目列表重新进入。"
				retryable
			/>
		);
	}
	try {
		return <Workspace initial={await projectDetail(actor, projectId)} />;
	} catch (e) {
		if (e instanceof AppError && e.status === 404) notFound();
		return (
			<WorkspaceStatus
				title="项目加载失败"
				message="请稍后重新加载。当前地址中的资料定位会保留。"
				retryable
			/>
		);
	}
}
