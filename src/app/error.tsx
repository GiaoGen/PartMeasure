"use client";
import { usePathname } from "next/navigation";
import { ProductEntryError } from "@/components/product-entry-error";
import { WorkspaceStatus } from "@/components/workspace-status";
export default function ErrorPage({
	retry,
}: {
	error: unknown;
	retry: () => void;
}) {
	const path = usePathname() ?? "";
	if (path.startsWith("/s/"))
		return (
			<WorkspaceStatus
				guest
				title="共享项目暂时无法加载"
				message="请重新加载；如仍无法打开，请联系工程师。"
				retryable
				retry={retry}
			/>
		);
	if (path.startsWith("/projects/"))
		return (
			<WorkspaceStatus
				title="项目暂时无法加载"
				message="请重新加载，或返回项目列表。"
				retryable
				retry={retry}
			/>
		);
	return <ProductEntryError retry={retry} />;
}
