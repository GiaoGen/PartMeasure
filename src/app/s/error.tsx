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
			guest
			title="共享项目暂时无法加载"
			message="请重试；如仍无法打开，请向工程师索取链接。"
			retryable
			retry={retry}
		/>
	);
}
