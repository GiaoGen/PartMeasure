"use client";
import { WorkspaceStatus } from "@/components/workspace-status";
export default function ErrorPage({
	retry,
}: {
	error: unknown;
	retry: () => void;
}) {
	return (
		<WorkspaceStatus
			title="项目暂时无法加载"
			message="请重新加载，或返回项目列表后再进入。"
			retryable
			retry={retry}
		/>
	);
}
