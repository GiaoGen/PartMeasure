"use client";
import Link from "next/link";
import { ProductBrand } from "./product-brand";
import { AppearanceControl, ProductSurface } from "./product-surface";
import "./projects.css";

export function ProjectEntryLoading({
	error = "",
	retry,
}: {
	error?: string;
	retry?: () => void;
}) {
	return (
		<ProductSurface className="pm-projects">
			<div className="projects-shell">
				<aside className="projects-sidebar">
					<div className="projects-sidebar-heading">
						<ProductBrand href="/projects" />
					</div>
					<p className="muted">{error ? "项目空间" : "正在准备项目空间…"}</p>
					<div className="projects-sidebar-footer">
						<AppearanceControl />
					</div>
				</aside>
				<main className="projects-main" aria-busy={!error}>
					<h1>我的项目</h1>
					{error ? (
						<section className="pm-notice error">
							<h2>暂时无法打开项目列表</h2>
							<p role="alert">{error}</p>
							<div className="pm-hero-actions">
								<button
									type="button"
									className="primary"
									onClick={() => (retry ? retry() : window.location.reload())}
								>
									重新加载
								</button>
								<Link href="/login" prefetch={false}>
									返回登录
								</Link>
								<Link href="/" prefetch={false}>
									返回首页
								</Link>
							</div>
						</section>
					) : (
						<>
							<p className="projects-result-count" role="status">
								正在读取项目…
							</p>
							<div className="projects-loading-lines" aria-hidden="true">
								<span />
								<span />
								<span />
							</div>
						</>
					)}
				</main>
			</div>
		</ProductSurface>
	);
}
