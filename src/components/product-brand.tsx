import Link from "next/link";

export function ProductBrand({
	href = "/",
	onNavigate,
	passive = false,
}: {
	href?: string;
	onNavigate?: (event: { preventDefault: () => void }) => void;
	passive?: boolean;
}) {
	const content = (
		<>
			<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
				<rect width="26" height="26" rx="5" fill="currentColor" />
				<path
					d="M7 20V7h7a4 4 0 0 1 0 8H7"
					fill="none"
					stroke="#fff"
					strokeWidth="2"
					strokeLinejoin="round"
				/>
			</svg>
			<span>PartMeasure</span>
		</>
	);
	if (passive) return <span className="pm-brand">{content}</span>;
	return (
		<Link
			className="pm-brand"
			href={href}
			prefetch={false}
			{...(onNavigate ? { onNavigate } : {})}
			aria-label={
				href.split("?")[0] === "/projects"
					? "PartMeasure · 我的项目"
					: "PartMeasure · 首页"
			}
		>
			{content}
		</Link>
	);
}
