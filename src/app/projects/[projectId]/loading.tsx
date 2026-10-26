import { WorkspaceStatus } from "@/components/workspace-status";
export default function Loading() {
	return (
		<WorkspaceStatus
			title="正在打开项目…"
			message="正在读取项目资料与访问权限，请稍候。"
		/>
	);
}
