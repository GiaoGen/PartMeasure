import { WorkspaceStatus } from "@/components/workspace-status";
export default function Loading() {
	return (
		<WorkspaceStatus
			guest
			title="正在打开共享项目…"
			message="正在准备客户协作页面，请稍候。"
		/>
	);
}
