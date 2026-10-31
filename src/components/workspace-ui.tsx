"use client";
import Image from "next/image";
import { privateImage, cachedPrivateImage } from "./private-image-cache";
import { useCallback, useEffect, useRef, useState } from "react";
import { motionDuration } from "./ui-motion";

export function WorkspaceIcon({
	kind,
}: {
	kind:
		| "home"
		| "chevron"
		| "upload"
		| "camera"
		| "file"
		| "album"
		| "bell"
		| "refresh"
		| "more"
		| "back"
		| "folder"
		| "share"
		| "download"
		| "filters"
		| "package"
		| "check";
}) {
	return (
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.7"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{kind === "back" ? <path d="m10 5-7 7 7 7M3 12h18" /> : null}
			{kind === "folder" ? <><path d="M3 7V5h7l2 2h9v12H3Zm0 3h18" /><path d="m8 14 4 3 4-3" /></> : null}
			{kind === "more" ? <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></> : null}
			{kind === "share" ? <><path d="m8 8 8-4M8 16l8 4" /><circle cx="5" cy="12" r="4" /><circle cx="19" cy="3" r="3" /><circle cx="19" cy="21" r="3" /></> : null}
			{kind === "download" ? <path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4" /> : null}
			{kind === "filters" ? <><path d="M3 6h7m4 0h7M3 18h11m4 0h3" /><circle cx="12" cy="6" r="2" /><circle cx="16" cy="18" r="2" /></> : null}
			{kind === "package" ? <path d="m3 7 9-4 9 4v10l-9 4-9-4Zm0 0 9 4 9-4M12 11v10M7 5l10 4" /> : null}
			{kind === "bell" ? (
				<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" />
			) : null}
			{kind === "refresh" ? (
				<>
					<path d="M20 4v6h-6M4 20v-6h6" />
					<path d="M19 10a7 7 0 0 0-12-5L4 8m1 6a7 7 0 0 0 12 5l3-3" />
				</>
			) : null}
			{kind === "check" ? <path d="m5 12 4 4L19 6" /> : null}
			{kind === "home" ? <path d="m3 11 9-8 9 8v10h-6v-7H9v7H3Z" /> : null}
			{kind === "chevron" ? <path d="m6 9 6 6 6-6" /> : null}
			{kind === "upload" ? (
				<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" />
			) : null}
			{kind === "camera" ? (
				<>
					<path d="M3 7h4l2-3h6l2 3h4v14H3Z" />
					<circle cx="12" cy="13" r="4" />
				</>
			) : null}
			{kind === "file" ? (
				<path d="M5 3h9l5 5v13H5Zm9 0v6h5M9 14h6m-6 3h6" />
			) : null}
			{kind === "album" ? (
				<>
					<rect x="3" y="3" width="18" height="18" rx="3" />
					<circle cx="8" cy="8" r="1" />
					<path d="m3 17 6-6 5 5 3-3 4 4" />
				</>
			) : null}
		</svg>
	);
}

export function useWorkspaceDisclosure() {
	const [phase, setPhase] = useState<"open" | "closing" | "closed">("closed");
	const currentPhase = useRef<"open" | "closing" | "closed">("closed");
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);
	const hide = useCallback(() => {
		if (currentPhase.current !== "open") return;
		currentPhase.current = "closing";
		if (timer.current) clearTimeout(timer.current);
		setPhase((current) => (current === "closed" ? current : "closing"));
		timer.current = setTimeout(() => {
			currentPhase.current = "closed";
			setPhase("closed");
			timer.current = null;
		}, motionDuration("exit"));
	}, []);
	function show() {
		currentPhase.current = "open";
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		setPhase("open");
	}
	return {
		phase,
		mounted: phase !== "closed",
		expanded: phase === "open",
		hide,
		show,
	};
}

/** A transition only leases an existing thumbnail; it never starts a second download. */
export function CachedPhotoPreview({
	preview,
}: {
	preview?: { src: string; version: string } | undefined;
}) {
	const [url, setUrl] = useState("");
	const src = preview?.src,
		version = preview?.version;
	useEffect(() => {
		const lease = src && version ? cachedPrivateImage(src, version) : undefined;
		setUrl(lease?.url ?? "");
		return () => lease?.release();
	}, [src, version]);
	return url ? (
		<div className="photo-transition">
			<Image
				unoptimized
				src={url}
				alt="已载入的照片预览，正在准备高清图"
				fill
				sizes="100vw"
				style={{ objectFit: "contain" }}
			/>
		</div>
	) : null;
}

export function MaterialThumbnail({
	src,
	version,
	onReady,
	name,
	defer = false,
}: {
	src?: string | undefined;
	version?: string | undefined;
	onReady?: ((ready: boolean) => void) | undefined;
	name: string;
	defer?: boolean;
}) {
	const host = useRef<HTMLSpanElement>(null);
	const readyCallback = useRef(onReady);
	readyCallback.current = onReady;
	const [visible, setVisible] = useState(!defer);
	useEffect(() => {
		if (!defer || !host.current) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				setVisible(!!entry?.isIntersecting);
			},
			{ rootMargin: "80px" },
		);
		observer.observe(host.current);
		return () => observer.disconnect();
	}, [defer]);
	const activeSrc = !defer || visible ? src : undefined;
	const [failed, setFailed] = useState(false),
		[objectUrl, setObjectUrl] = useState("");
	useEffect(() => {
		let active = true,
			lease: { url: string; release: () => void } | undefined;
		const controller = new AbortController();
		setObjectUrl("");
		setFailed(false);
		readyCallback.current?.(false);
		if (activeSrc && version)
			void privateImage(activeSrc, version, controller.signal)
				.then((value) => {
					if (!active) {
						value.release();
						return;
					}
					lease = value;
					setObjectUrl(value.url);
				})
				.catch(() => {
					if (active) setFailed(true);
				});
		return () => {
			active = false;
			controller.abort();
			lease?.release();
		};
	}, [activeSrc, version]);
	const content =
		failed || !objectUrl ? (
			<span className="workspace-image-fallback">
				<WorkspaceIcon kind="album" />
				<span>{failed ? "图片预览暂不可用" : "图片预览准备中"}</span>
				<small>点击查看详情或重试</small>
			</span>
		) : (
			<Image
				unoptimized
				src={objectUrl}
				alt={name}
				width={600}
				height={440}
				loading="lazy"
				decoding="async"
				referrerPolicy="no-referrer"
				onLoad={() => readyCallback.current?.(true)}
				onError={() => {
					setFailed(true);
					readyCallback.current?.(false);
				}}
			/>
		);
	return defer ? (
		<span ref={host} className="material-thumbnail">
			{content}
		</span>
	) : (
		content
	);
}
