import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'P0-0 isolated Konva experiment', robots: { index:false, follow:false } };
export default function Layout({children}:Readonly<{children:React.ReactNode}>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
