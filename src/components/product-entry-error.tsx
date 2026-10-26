"use client";
import Link from "next/link";
import { ProductEntry } from "./product-entry";

export function ProductEntryError({ retry }: { retry: () => void }) {
	return (
		<ProductEntry>
			<h1>页面暂时无法加载</h1>
			<p className="muted" role="alert">
				请重试，或返回首页重新进入。
			</p>
			<div className="pm-hero-actions">
				<button type="button" className="primary" onClick={retry}>
					重新加载
				</button>
				<Link href="/" prefetch={false}>
					返回首页
				</Link>
				<Link href="/projects" prefetch={false}>
					我的项目
				</Link>
			</div>
		</ProductEntry>
	);
}
