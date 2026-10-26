import Link from "next/link";
import { ProductBrand } from "@/components/product-brand";
import { ProductPreview } from "@/components/product-preview";
import {
	AppearanceControl,
	ProductSurface,
} from "@/components/product-surface";
export default function Page() {
	return (
		<ProductSurface className="pm-home">
			<a className="pm-skip" href="#home-main">
				跳到主要内容
			</a>
			<header className="pm-entry-header">
				<ProductBrand />
				<nav aria-label="产品入口">
					<AppearanceControl />
					<Link className="button primary" href="/login" prefetch={false}>
						工程师登录
					</Link>
				</nav>
			</header>
			<main id="home-main" tabIndex={-1} className="pm-home-main">
				<section className="pm-hero" aria-labelledby="home-title">
					<div>
						<p className="pm-eyebrow">工程资料协作</p>
						<h1 id="home-title">
							把零件资料，
							<br />
							交接清楚。
						</h1>
						<p className="pm-hero-description">
							照片、标注、补测与成果版本，放在同一个项目里。
							<br />
							工程师指出测哪里，客户打开链接即可上传和回复。
						</p>
						<div className="pm-hero-actions">
							<Link
								className="button primary"
								href="/projects"
								prefetch={false}
							>
								进入工程师工作台
							</Link>
						</div>
						<p className="muted">客户无需注册，请使用工程师分享的项目链接。</p>
					</div>
					<ProductPreview />
				</section>
				<section className="pm-home-steps" aria-labelledby="steps-title">
					<h2 id="steps-title">一个项目，完成三步交接</h2>
					<ol>
						{[
							["01", "整理资料", "双方上传照片、CAD 与附件。"],
							["02", "定位补测", "标清位置，客户填写或拍照回复。"],
							["03", "交付留档", "按版本发布，下载图片、报告与资料包。"],
						].map(([number, title, description]) => (
							<li key={number}>
								<span className="pm-step-number">{number}</span>
								<div>
									<h3>{title}</h3>
									<p>{description}</p>
								</div>
							</li>
						))}
					</ol>
				</section>
				<footer className="pm-home-footer">PartMeasure · 工程资料协作</footer>
			</main>
		</ProductSurface>
	);
}
