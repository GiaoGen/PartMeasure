"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { privateImage } from "./private-image-cache";
import type { Evidence } from "@/lib/issues";
/** Same bounded byte cache as the canvas; offscreen history releases its lease. */
export function EvidencePreview({ base, file }: { base: string; file: Evidence }) {
	const host = useRef<HTMLSpanElement>(null),
		[visible, setVisible] = useState(false),
		[url, setUrl] = useState(""),
		[failed, setFailed] = useState(false);
	const version = file.thumbnail?.version;
	useEffect(() => {
		if (!host.current) return;
		const observer = new IntersectionObserver(
			([entry]) => setVisible(!!entry?.isIntersecting),
			{ rootMargin: "180px" },
		);
		observer.observe(host.current);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		setUrl("");
		setFailed(false);
		if (!visible || !version) return;
		let active = true,
			lease: { url: string; release: () => void } | undefined;
		const controller = new AbortController();
		void privateImage(`${base}/files/${file.id}/preview?variant=640`, version, controller.signal)
			.then((value) => {
				if (!active) {
					value.release();
					return;
				}
				lease = value;
				setUrl(value.url);
			})
			.catch(() => {
				if (active) setFailed(true);
			});
		return () => {
			active = false;
			controller.abort();
			lease?.release();
		};
	}, [base, file.id, version, visible]);
	return (
		<span
			ref={host}
			style={{ display: "inline-block", width: 260, maxWidth: "100%", minHeight: 120 }}
		>
			{url ? (
				<Image
					unoptimized
					width={260}
					height={220}
					src={url}
					alt={`测量证据：${file.filename}`}
					onError={() => {
						setUrl("");
						setFailed(true);
					}}
				/>
			) : (
				<span>{failed ? "证据预览暂不可用" : "证据预览待就绪"}，可查看原尺寸证据。</span>
			)}
		</span>
	);
}
