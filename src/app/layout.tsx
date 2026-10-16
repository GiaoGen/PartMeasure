import type { Metadata } from "next";
import "./globals.css";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "PartMeasure · 工程资料协作",
	robots: { index: false, follow: false },
};

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="zh-CN">
			<body>{children}</body>
		</html>
	);
}
