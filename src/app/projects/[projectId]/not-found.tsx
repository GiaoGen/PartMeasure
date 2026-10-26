import { WorkspaceStatus } from "@/components/workspace-status";
export default function NotFound() {
	return (
		<WorkspaceStatus
			title="项目暂不可用"
			message="请返回项目列表，重新选择可以访问的项目。"
		/>
	);
}
