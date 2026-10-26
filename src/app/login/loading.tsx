import { ProductEntry } from "@/components/product-entry";
export default function Loading() {
	return (
		<ProductEntry>
			<h1>工程师登录</h1>
			<p className="muted" role="status">
				正在准备登录表单…
			</p>
		</ProductEntry>
	);
}
