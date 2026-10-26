"use client";
import Link from "next/link";
import { ProductSurface, AppearanceControl } from "./product-surface";
import { ProductBrand } from "./product-brand";
import "./workspace.css";

/** No project records or cached identity are inferred while access is unresolved. */
export function WorkspaceStatus({
	guest = false,
	title,
	message,
	retry,
	retryable = false,
	homeLink = false,
}: {
	guest?: boolean;
	title: string;
	message: string;
	retry?: () => void;
	retryable?: boolean;
	homeLink?: boolean;
}) {
	return (
		<ProductSurface className="pm-workspace">
			<main className="workspace workspace-redesign">
				<header className="workspace-topbar">
					<div className="workspace-identity">
						<ProductBrand href="/projects" passive={guest} />
						<span className="muted">
							{guest ? "客户资料协作" : "项目工作台"}
						</span>
					</div>
					<AppearanceControl />
				</header>
				<nav className="workspace-section-tabs" aria-label="项目工作区">
					<button type="button" disabled>
						资料与补测
					</button>
					<button type="button" disabled>
						交付与版本
					</button>
				</nav>
				<section className="workspace-status">
					<h1 tabIndex={-1}>{title}</h1>
					<p role={retryable ? "alert" : "status"}>{message}</p>
					<div className="pm-hero-actions">
						{retryable ? (
							<button
								type="button"
								className="primary"
								onClick={() => (retry ? retry() : window.location.reload())}
							>
								重新加载
							</button>
						) : null}
						{!guest ? (
							<Link href="/projects" prefetch={false}>
								返回我的项目
							</Link>
						) : null}
						{homeLink ? (
							<Link href="/" prefetch={false}>
								返回首页
							</Link>
						) : null}
					</div>
				</section>
			</main>
		</ProductSurface>
	);
}
