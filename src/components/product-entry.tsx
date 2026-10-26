import type { ReactNode } from "react";
import Link from "next/link";
import { ProductBrand } from "./product-brand";
import { ProductSurface, AppearanceControl } from "./product-surface";

export function ProductEntry({ children }: { children: ReactNode }) {
	return (
		<ProductSurface className="pm-entry">
			<a className="pm-skip" href="#entry-main">
				跳到主要内容
			</a>
			<header className="pm-entry-header">
				<ProductBrand />
				<nav aria-label="页面入口">
					<AppearanceControl />
					<Link href="/" prefetch={false}>
						返回首页
					</Link>
				</nav>
			</header>
			<main id="entry-main" tabIndex={-1} className="pm-auth-main">
				<section className="pm-auth-panel">{children}</section>
			</main>
		</ProductSurface>
	);
}
