import { ProductEntry } from "@/components/product-entry";
export default function Loading() {
	return (
		<ProductEntry>
			<h1>正在加载…</h1>
			<p className="muted" role="status">
				正在准备页面，请稍候。
			</p>
		</ProductEntry>
	);
}
