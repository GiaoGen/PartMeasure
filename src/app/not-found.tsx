"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProductEntry } from "@/components/product-entry";
import { WorkspaceStatus } from "@/components/workspace-status";
export default function NotFound() {
	const path = usePathname() ?? "";
	if (path.startsWith("/s/"))
		return (
			<WorkspaceStatus
				guest
				title="链接暂不可用"
				message="请检查地址，或向工程师索取新链接。"
			/>
		);
	if (path.startsWith("/projects/"))
		return (
			<WorkspaceStatus
				title="项目暂不可用"
				message="请返回项目列表，重新选择可以访问的项目。"
			/>
		);
	return (
		<ProductEntry>
			<p className="muted">404</p>
			<h1>找不到这个页面</h1>
			<p className="muted">请检查地址，或返回首页重新进入。</p>
			<div className="pm-hero-actions">
				<Link className="button primary" href="/" prefetch={false}>
					返回首页
				</Link>
				<Link href="/projects" prefetch={false}>
					我的项目
				</Link>
			</div>
		</ProductEntry>
	);
}
