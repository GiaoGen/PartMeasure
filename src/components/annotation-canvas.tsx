"use client";
import {
	angleGeometry,
	anchor,
	ellipseGeometry,
	makeEllipse,
	normalized,
} from "@/lib/geometry-extensions";
import {
	geometryPaths,
	labelPosition,
	photoDimensionText,
	photoStatusText,
	annotationColor,
} from "@/lib/annotation-presentation";
import {
	threePointGeometry,
	dragHandleGeometry,
	annotationDragResult,
} from "@/lib/annotation-interaction";
import { AnnotationIcon } from "./annotation-icon";
import { useCallback, useEffect, useRef, useState } from "react";
import type Konva from "konva";
import { decodedImage } from "./decoded-image";
import { discardPrivateImage, cachedPrivateImage } from "./private-image-cache";
import { imagePreviewHint } from "./image-preview";
import { useWorkspaceMark } from "./use-workspace-theme";
import {
	Stage,
	Layer,
	Group,
	Image as CanvasImage,
	Line,
	Circle,
	Text,
	Path,
} from "react-konva";
import {
	type AnnotationDraft,
	type CanonicalImage,
	type Geometry,
	type Point,
	type View,
	bounds,
	fitView,
	fromScreen,
	inside,
	makeCircle,
	moveGeometry,
	zoomView,
	validateAnnotation,
	emptyMetadata,
} from "@/lib/annotations";
type Tool =
	| "select"
	| "line"
	| "circle"
	| "point"
	| "text"
	| "pan"
	| "angle"
	| "arc"
	| "ellipse";
type Draw = { tool: Tool; from: Point; to: Point };
const names: Record<Tool, string> = {
	select: "选择",
	line: "线段",
	circle: "圆 / 孔位",
	point: "点位",
	text: "文字",
	pan: "平移",
	angle: "角度",
	arc: "三点圆弧",
	ellipse: "椭圆",
};
const clamp = (p: Point): Point => ({
	x: Math.max(0, Math.min(1, p.x)),
	y: Math.max(0, Math.min(1, p.y)),
});
export default function AnnotationCanvas({
	image,
	src,
	items,
	selected,
	guest,
	disabled,
	onSelect,
	onCreate,
	onChange,
	onDelete,
	onUndo,
	onRedo,
	onSave,
	onError,
	onInvalid,
	canUndo = false,
	canRedo = false,
	showNumbers = false,
	showToolbar = true,
	preview,
}: {
	image: CanonicalImage;
	src: string;
	items: AnnotationDraft[];
	selected: string | null;
	guest: boolean;
	disabled: boolean;
	onSelect: (id: string | null) => void;
	onCreate: (g: Geometry) => void;
	onChange: (item: AnnotationDraft) => void;
	onDelete: () => void;
	onUndo: () => void;
	onRedo: () => void;
	onSave: () => void;
	onError: (text: string) => void;
	onInvalid: () => void;
	canUndo?: boolean;
	canRedo?: boolean;
	showNumbers?: boolean;
	showToolbar?: boolean;
	preview?: { src: string; version: string } | undefined;
}) {
	const mark = useWorkspaceMark(guest);
	const host = useRef<HTMLDivElement>(null),
		stage = useRef<Konva.Stage>(null);
	const [size, setSize] = useState({ width: 640, height: 480 }),
		sizeRef = useRef({ width: 0, height: 0 }),
		[view, setView] = useState<View>({ x: 0, y: 0, scale: 1 }),
		viewRef = useRef(view);
	viewRef.current = view;
	const [bitmap, setBitmap] = useState<HTMLImageElement | null>(null),
		[previewBitmap, setPreviewBitmap] = useState<HTMLImageElement | null>(null),
		[loadError, setLoadError] = useState(false),
		[attempt, setAttempt] = useState(0),
		[tool, setTool] = useState<Tool>("select"),
		[space, setSpace] = useState(false),
		[draft, setDraft] = useState<Geometry | null>(null);
	const canEdit = !guest && !disabled && bitmap !== null;
	const latestItems = useRef(items);
	latestItems.current = items;
	const objectDrag = useRef<{ item: AnnotationDraft; imageId: string; node: Konva.Node } | null>(null);
	const [movingId, setMovingId] = useState<string | null>(null);
	const cancelObjectDrag = useCallback(() => {
		const drag = objectDrag.current;
		objectDrag.current = null;
		if (drag) {
			if (drag.node.isDragging()) drag.node.stopDrag();
			drag.node.position({ x: 0, y: 0 });
		}
		setMovingId(null);
	}, []);
	const controlDrag = useRef<{
		item: AnnotationDraft;
		imageId: string;
		key: string;
		point: Point;
		node: Konva.Node;
		geometry: Geometry;
	} | null>(null);
	const [controlPreview, setControlPreview] = useState<{
		id: string;
		geometry: Geometry;
	} | null>(null);
	const previewFrame = useRef<number | null>(null);
	const cancelControlDrag = useCallback(() => {
		if (previewFrame.current !== null)
			cancelAnimationFrame(previewFrame.current);
		previewFrame.current = null;
		const drag = controlDrag.current;
		controlDrag.current = null;
		if (drag) {
			if (drag.node.isDragging()) drag.node.stopDrag();
			drag.node.position({
				x: drag.point.x * image.width,
				y: drag.point.y * image.height,
			});
		}
		setControlPreview(null);
	}, [image.width, image.height]);
	useEffect(() => {
		if (
			!canEdit ||
			controlDrag.current?.item.id !== selected ||
			controlDrag.current?.imageId !== image.id
		)
			cancelControlDrag();
	}, [canEdit, selected, image.id, cancelControlDrag]);
	useEffect(() => {
		if (!canEdit || objectDrag.current?.item.id !== selected || objectDrag.current?.imageId !== image.id)
			cancelObjectDrag();
	}, [canEdit, selected, image.id, cancelObjectDrag]);
	useEffect(
		() => () => {
			if (previewFrame.current !== null)
				cancelAnimationFrame(previewFrame.current);
			controlDrag.current = null;
			objectDrag.current = null;
			drawing.current = null;
		},
		[],
	);
	function updateControlPreview(node: Konva.Node) {
		const drag = controlDrag.current;
		if (!drag || !canEdit || multi.current) return;
		const end = clamp({
			x: node.x() / image.width,
			y: node.y() / image.height,
		});
		const geometry = dragHandleGeometry(
			drag.item.geometry,
			drag.key,
			end,
			image.width,
			image.height,
		);
		try {
			validateAnnotation(geometry, emptyMetadata(), image.width, image.height);
		} catch {
			return;
		}
		drag.geometry = geometry;
		if (previewFrame.current === null)
			previewFrame.current = requestAnimationFrame(() => {
				previewFrame.current = null;
				const current = controlDrag.current;
				if (current)
					setControlPreview({
						id: current.item.id,
						geometry: current.geometry,
					});
			});
	}
	const triplet = useRef<Point[]>([]);
	const suppressPointClick = useRef(false);
	const [partial, setPartial] = useState<Point[]>([]);
	const [hover, setHover] = useState<Point | null>(null);
	const drawing = useRef<Draw | null>(null),
		panning = useRef<{ start: Point; view: View } | null>(null),
		pinch = useRef<{ distance: number; center: Point; view: View } | null>(
			null,
		),
		multi = useRef(false);
	const cancelGestures = useCallback(() => {
		cancelControlDrag();
		cancelObjectDrag();
		drawing.current = null;
		panning.current = null;
		pinch.current = null;
		multi.current = false;
		suppressPointClick.current = true;
		triplet.current = [];
		setPartial([]);
		setHover(null);
		setDraft(null);
		setSpace(false);
	}, [cancelControlDrag, cancelObjectDrag]);
	useEffect(() => {
		// Permission/loading changes must also cancel unfinished new shapes.
		if (!canEdit) cancelGestures();
	}, [canEdit, cancelGestures]);
	const gestureImage = useRef(`${image.id}:${image.imageHash}`);
	useEffect(() => {
		const identity = `${image.id}:${image.imageHash}`;
		if (gestureImage.current !== identity) {
			gestureImage.current = identity;
			cancelGestures();
		}
	}, [image.id, image.imageHash, cancelGestures]);
	useEffect(() => {
		const hidden = () => { if (document.hidden) cancelGestures(); };
		window.addEventListener("blur", cancelGestures);
		window.addEventListener("pointercancel", cancelGestures);
		document.addEventListener("visibilitychange", hidden);
		return () => {
			window.removeEventListener("blur", cancelGestures);
			window.removeEventListener("pointercancel", cancelGestures);
			document.removeEventListener("visibilitychange", hidden);
		};
	}, [cancelGestures]);
	function focusCanvas() {
		host.current?.focus({ preventScroll: true });
	}
	function changeView(next: View) {
		cancelControlDrag();
		cancelObjectDrag();
		drawing.current = null;
		panning.current = null;
		pinch.current = null;
		setDraft(null);
		setHover(null);
		// Keep already placed angle/arc points while zooming to place the next one.
		viewRef.current = next;
		setView(next);
	}
	function commitDrag(start: AnnotationDraft, geometry: Geometry) {
		const result = annotationDragResult(start, latestItems.current.find(item => item.id === start.id), geometry);
		if (result.conflict) onError("标注在拖动期间已被更新，本次拖动已取消，请重试。");
		else if (result.changed) onChange(result.changed);
	}
	const handlers = useRef({ onCreate, onError, onInvalid });
	handlers.current = { onCreate, onError, onInvalid };
	const [hint] = useState(() => imagePreviewHint(src));
	const previewSrc = preview?.src ?? (hint?.hash === image.imageHash ? hint.preview?.src : undefined);
	const previewVersion = preview?.version ?? (hint?.hash === image.imageHash ? hint.preview?.version : undefined);
	useEffect(() => {
		setPreviewBitmap(null);
		const lease = previewSrc && previewVersion ? cachedPrivateImage(previewSrc, previewVersion) : undefined;
		if (!lease) return;
		const img = new window.Image();
		img.onload = () => setPreviewBitmap(img);
		img.src = lease.url;
		return () => { img.onload = null; img.src = ""; lease.release(); };
	}, [previewSrc, previewVersion]);
	useEffect(() => {
		let lease: { release: () => void } | undefined;
		const controller = new AbortController();
		setBitmap(null); setLoadError(false);
		void (async () => {
			try {
				if (attempt > 0) discardPrivateImage(src, image.imageHash);
				const decoded = await decodedImage(src, image.imageHash, image.width, image.height, controller.signal);
				if (controller.signal.aborted) { decoded.release(); return; }
				lease = decoded; setBitmap(decoded.image);
			} catch (error) {
				if (controller.signal.aborted) return;
				setLoadError(true);
				if (error instanceof Error && error.message === "IMAGE_DIMENSIONS") handlers.current.onError("图片尺寸与标准图记录不一致，已停止编辑。");
			}
		})();
		return () => { controller.abort(); lease?.release(); };
	}, [src, image.width, image.height, image.imageHash, attempt]);

	useEffect(() => {
		if (!host.current) return;
		const observer = new ResizeObserver(([entry]) => {
			if (!entry) return;
			const next = {
					width: Math.max(100, Math.floor(entry.contentRect.width)),
					height: Math.max(200, Math.floor(entry.contentRect.height)),
				},
				old = sizeRef.current;
			cancelControlDrag();
			cancelObjectDrag();
			drawing.current = null;
			panning.current = null;
			setDraft(null);
			setHover(null);
			setView((previous) => {
				if (!old.width)
					return fitView(image.width, image.height, next.width, next.height);
				const center = fromScreen(
						{ x: old.width / 2, y: old.height / 2 },
						image.width,
						image.height,
						previous,
					),
					relative =
						previous.scale /
						fitView(image.width, image.height, old.width, old.height).scale,
					scale =
						fitView(image.width, image.height, next.width, next.height).scale *
						relative;
				return {
					x: next.width / 2 - center.x * image.width * scale,
					y: next.height / 2 - center.y * image.height * scale,
					scale,
				};
			});
			sizeRef.current = next;
			setSize(next);
		});
		observer.observe(host.current);
		return () => observer.disconnect();
	}, [image.width, image.height, cancelControlDrag, cancelObjectDrag]);
	function asGeometry(d: Draw): Geometry {
		if (d.tool === "line") return { type: "line", from: d.from, to: d.to };
		if (d.tool === "ellipse")
			return makeEllipse(d.from, d.to, image.width, image.height);
		if (d.tool === "circle")
			return makeCircle(d.from, d.to, image.width, image.height);
		if (d.tool === "text") return { type: "text", at: d.from, text: "备注" };
		return { type: "point", at: d.from };
	}
	function finish() {
		const d = drawing.current;
		drawing.current = null;
		panning.current = null;
		setDraft(null);
		if (d && canEdit && !multi.current) {
			handlers.current.onCreate(asGeometry(d));
			setTool("select");
		}
	}
	const finishRef = useRef(finish);
	finishRef.current = finish;
	useEffect(() => {
		const release = () => finishRef.current();
		window.addEventListener("pointerup", release);
		return () => window.removeEventListener("pointerup", release);
	}, []);
	function pointer() {
		const p = stage.current?.getPointerPosition();
		return p ? fromScreen(p, image.width, image.height, viewRef.current) : null;
	}
	function begin(event?: Konva.KonvaEventObject<MouseEvent>) {
		host.current?.focus({ preventScroll: true });
		if (multi.current || !bitmap) return;
		suppressPointClick.current = false;
		const p = stage.current?.getPointerPosition();
		if (!p) return;
		if (
			guest ||
			tool === "select" ||
			tool === "pan" ||
			space ||
			(event && event.evt.button !== 0)
		) {
			panning.current = { start: p, view: viewRef.current };
			return;
		}
		if (!canEdit) return;
		const normalized = pointer();
		if (!normalized || !inside(normalized)) return;
		if (tool === "angle" || tool === "arc") return;
		drawing.current = { tool, from: normalized, to: normalized };
		setDraft(asGeometry(drawing.current));
	}
	function placePoint(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
		if (
			("button" in event.evt && event.evt.button !== 0) ||
			!canEdit ||
			!bitmap ||
			multi.current ||
			suppressPointClick.current ||
			space ||
			(tool !== "angle" && tool !== "arc")
		)
			return;
		const normalized = pointer();
		if (!normalized || !inside(normalized)) return;

		const points = [...triplet.current, normalized];
		if (points.length === 3) {
			suppressPointClick.current = true;
			const [a, b, c] = points;
			if (a && b && c)
				handlers.current.onCreate(threePointGeometry(tool, [a, b, c]));
			triplet.current = [];
			setPartial([]);
			setHover(null);
			setDraft(null);
			setTool("select");
		} else {
			triplet.current = points;
			setPartial(points);
			setDraft(null);
		}
		return;
	}

	function move() {
		if (multi.current) return;
		const p = stage.current?.getPointerPosition();
		if (panning.current && p) {
			const start = panning.current;
			setView({
				...start.view,
				x: start.view.x + p.x - start.start.x,
				y: start.view.y + p.y - start.start.y,
			});
			return;
		}
		const point = pointer();
		if (point && triplet.current.length) {
			const q = clamp(point);
			setHover(q);
			const [a, b] = triplet.current;
			if (a && b)
				setDraft(
					threePointGeometry(tool === "angle" ? "angle" : "arc", [a, b, q]),
				);
		}
		if (drawing.current && point) {
			drawing.current.to = clamp(point);
			setDraft(asGeometry(drawing.current));
		}
	}
	function touches(event: React.TouchEvent<HTMLDivElement>) {
		if (event.touches.length < 2) return;
		event.preventDefault();
		event.stopPropagation();
		if (!multi.current) cancelGestures();
		multi.current = true;
		suppressPointClick.current = true;
		const a = event.touches[0],
			b = event.touches[1],
			rect = host.current?.getBoundingClientRect();
		if (!a || !b || !rect) return;
		const center = {
				x: (a.clientX + b.clientX) / 2 - rect.left,
				y: (a.clientY + b.clientY) / 2 - rect.top,
			},
			distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
		if (!pinch.current) {
			stage.current?.find("Group, Circle").forEach((node) => {
				if (node.isDragging()) node.stopDrag();
			});
			pinch.current = { distance, center, view: viewRef.current };
			return;
		}
		const start = pinch.current,
			v = zoomView(
				start.view,
				start.center,
				(start.view.scale * distance) / Math.max(1, start.distance),
			);
		setView({
			...v,
			x: v.x + center.x - start.center.x,
			y: v.y + center.y - start.center.y,
		});
	}
	function endTouches(event: React.TouchEvent<HTMLDivElement>) {
		if (multi.current) {
			event.stopPropagation();
			pinch.current = null;
			drawing.current = null;
			setDraft(null);
			if (!event.touches.length) multi.current = false;
		}
	}
	function select(
		event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
		id: string,
	) {
		if (space || tool === "pan") return;
		if (multi.current || ("button" in event.evt && event.evt.button !== 0)) return;
		if (!guest && !["select", "pan"].includes(tool)) return;
		if (!space && !multi.current) {
			onSelect(id);
			host.current?.focus({ preventScroll: true });
			event.cancelBubble = true;
			if (!guest) setTool("select");
		}
	}
	const w = image.width,
		h = image.height,
		s = view.scale;
	function render(item: AnnotationDraft, preview = false) {
		const g =
				canEdit && controlPreview?.id === item.id
					? controlPreview.geometry
					: item.geometry,
			chosen = !preview && selected === item.id,
			editing = canEdit && chosen && tool === "select" && !space && !preview,
			stroke = annotationColor(item),
			lineWidth = (chosen ? 3 : 2) / s;
		const label = photoDimensionText(item);
		const statusLabel = photoStatusText(item);
		const position = labelPosition(g, w, h, s);
		const number =
			showNumbers && !preview
				? items.findIndex((i) => i.id === item.id) + 1
				: 0;
		const at = anchor(g);
		const badgeX = Math.max(14 / s, Math.min(w - 14 / s, at.x * w - 18 / s));
		const badgeY = Math.max(14 / s, Math.min(h - 14 / s, at.y * h + 18 / s));
		const paths = geometryPaths(
			g,
			w,
			h,
			s,
			editing || (preview && g.type === "ellipse"),
		).map((data, i) => ({
			data,
			role: ["outline", "detail", "secondary"][i] ?? "extra",
		}));

		const shape = paths.map(({ data, role }) => (
			<Path
				key={role}
				data={data}
				stroke={stroke}
				strokeWidth={lineWidth}
				hitStrokeWidth={44 / s}
				fill={g.type === "point" || g.type === "text" ? stroke : "transparent"}
			/>
		));

		const handles: { key: string; point: Point }[] = [];
		if (chosen && editing && movingId !== item.id) {
			if (g.type === "line")
				handles.push(
					{ key: "from", point: g.from },
					{ key: "to", point: g.to },
				);
			if (g.type === "circle")
				handles.push({
					key: "radius",
					point: { x: g.center.x + g.radiusX, y: g.center.y },
				});
			if (g.type === "arc")
				handles.push(
					{ key: "from", point: g.from },
					{ key: "via", point: g.via },
					{ key: "to", point: g.to },
				);
			if (g.type === "angle") {
				handles.push(
					{ key: "vertex", point: g.vertex },
					{ key: "from", point: g.from },
					{ key: "to", point: g.to },
				);
				const v = angleGeometry(g, w, h),
					t = v.start + v.sweep / 2;
				handles.push({
					key: "arcScale",
					point: normalized(
						{
							x: v.center.x + v.radius * Math.cos(t),
							y: v.center.y + v.radius * Math.sin(t),
						},
						w,
						h,
					),
				});
			}
			if (g.type === "ellipse") {
				const e = ellipseGeometry(g, w, h),
					r = e.ry + 28 / s;
				handles.push(
					{ key: "center", point: g.center },
					{ key: "axisA", point: g.axisA },
					{ key: "axisB", point: g.axisB },
					{
						key: "rotate",
						point: normalized(
							{
								x: e.center.x + r * Math.sin(e.rotation),
								y: e.center.y - r * Math.cos(e.rotation),
							},
							w,
							h,
						),
					},
				);
			}
		}
		const active = controlDrag.current;
		if (active?.item.id === item.id) {
			// Canonical storage can swap major/minor axes during resizing. Keep the
			// untouched axis handle in place until this gesture finishes.
			if (
				active.item.geometry.type === "ellipse" &&
				["axisA", "axisB"].includes(active.key)
			) {
				const otherKey = active.key === "axisA" ? "axisB" : "axisA";
				const other = handles.find((value) => value.key === otherKey);
				if (other) other.point = active.item.geometry[otherKey];
			}
			const handle = handles.find((value) => value.key === active.key);
			if (handle) handle.point = active.point;
		}
		return (
			<Group key={item.id}>
				<Group
					x={0}
					y={0}
					draggable={editing}
					listening={!preview}
					onMouseDown={(e) => select(e, item.id)}
					onTouchStart={(e) => select(e, item.id)}
					dragBoundFunc={(pos) => {
						const b = bounds(g, w, h),
							dx = Math.max(
								-b.left,
								Math.min(1 - b.right, (pos.x - view.x) / (s * w)),
							),
							dy = Math.max(
								-b.top,
								Math.min(1 - b.bottom, (pos.y - view.y) / (s * h)),
							);
						return { x: view.x + dx * w * s, y: view.y + dy * h * s };
					}}
					onDragStart={(e) => {
						if (!editing || multi.current) { e.target.stopDrag(); return; }
						objectDrag.current = { item, imageId: image.id, node: e.target };
						setMovingId(item.id);
					}}
					onDragEnd={(e) => {
						const node = e.target,
							dx = node.x() / w,
							dy = node.y() / h;
						const drag = objectDrag.current;
						objectDrag.current = null;
						setMovingId(null);
						node.position({ x: 0, y: 0 });
						if (drag && canEdit && !multi.current && drag.imageId === image.id)
							commitDrag(drag.item, moveGeometry(drag.item.geometry, dx, dy, w, h));
					}}
				>
					{paths.length
						? paths.map(({ data, role }) => (
								<Path
									key={role}
									data={data}
									stroke="white"
									strokeWidth={lineWidth + 2 / s}
									listening={false}
								/>
							))
						: null}
					{shape}
					{number > 0 ? (
						<Group x={badgeX} y={badgeY} listening={false}>
							<Text
								x={-12 / s}
								y={-6 / s}
								width={24 / s}
								align="center"
								text={String(number)}
								fontSize={12 / s}
								fill={stroke}
								stroke="white"
								strokeWidth={2 / s}
								fillAfterStrokeEnabled
							/>
						</Group>
					) : null}
					{statusLabel ? (
						<Text
							x={Math.max(0, Math.min(w - 180 / s, position.x - 90 / s))}
							y={Math.max(
								0,
								Math.min(h - 18 / s, position.y + (label ? 12 : -6) / s),
							)}
							width={180 / s}
							align="center"
							text={statusLabel}
							fontSize={11 / s}
							fill={stroke}
							stroke="white"
							strokeWidth={2 / s}
							fillAfterStrokeEnabled
							listening={false}
						/>
					) : null}

					{label && g.type !== "text" ? (
						<Text
							x={Math.max(0, Math.min(w - 180 / s, position.x - 90 / s))}
							y={Math.max(0, Math.min(h - 42 / s, position.y - 14 / s))}
							width={180 / s}
							align="center"
							text={label}
							fontSize={14 / s}
							fill={stroke}
							stroke="white"
							strokeWidth={2 / s}
							fillAfterStrokeEnabled
							padding={3 / s}
							listening={!preview}
							onMouseDown={(e) => select(e, item.id)}
							onTouchStart={(e) => select(e, item.id)}
						/>
					) : null}
				</Group>
				{handles.map(({ point, key }) => (
					<Circle
						key={`${item.id}-${key}`}
						x={point.x * w}
						y={point.y * h}
						radius={key === "rotate" ? 7 / s : 6 / s}
						hitStrokeWidth={40 / s}
						fill="white"
						stroke={stroke}
						strokeWidth={2 / s}
						draggable
						onMouseDown={(e) => {
							e.cancelBubble = true;
						}}
						onTouchStart={(e) => {
							e.cancelBubble = true;
						}}
						dragBoundFunc={(pos) => {
							const p = clamp(fromScreen(pos, w, h, view));
							return { x: view.x + p.x * w * s, y: view.y + p.y * h * s };
						}}
						onDragStart={(e) => {
							e.cancelBubble = true;
							if (!canEdit || multi.current) return;
							controlDrag.current = {
								item,
								imageId: image.id,
								key,
								point,
								node: e.target,
								geometry: item.geometry,
							};
						}}
						onDragMove={(e) => {
							e.cancelBubble = true;
							updateControlPreview(e.target);
						}}
						onDragEnd={(e) => {
							e.cancelBubble = true;
							updateControlPreview(e.target);
							const drag = controlDrag.current;
							cancelControlDrag();
							e.target.position({ x: point.x * w, y: point.y * h });
							if (drag && canEdit && !multi.current && drag.imageId === image.id)
								commitDrag(drag.item, drag.geometry);
						}}
					/>
				))}
			</Group>
		);
	}
	return (
		<div className="canvas-column">
			{showToolbar ? <div
				className="annotation-toolbar"
				role="toolbar"
				aria-label="图片编辑工具"
			>
				{!guest ? (
					<>
						{(
							[
								"select",
								"pan",
								"line",
								"circle",
								"angle",
								"arc",
								"ellipse",
								"point",
								"text",
							] as const
						).map((value) => (
							<button
								key={value}
								type="button"
								className="annotation-icon-button"
								disabled={disabled}
								aria-pressed={tool === value}
								aria-label={names[value]}
								title={names[value]}
								onClick={() => {
									cancelGestures();
									setTool(value);
									focusCanvas();
								}}
							>
								<AnnotationIcon kind={value} />
							</button>
						))}
						<button
							type="button"
							className="annotation-icon-button"
							disabled={disabled || !canUndo}
							aria-label="撤销"
							title="撤销"
							onClick={() => { cancelGestures(); onUndo(); focusCanvas(); }}
						>
							<AnnotationIcon kind="undo" />
						</button>
						<button
							type="button"
							className="annotation-icon-button"
							disabled={disabled || !canRedo}
							aria-label="重做"
							title="重做"
							onClick={() => { cancelGestures(); onRedo(); focusCanvas(); }}
						>
							<AnnotationIcon kind="redo" />
						</button>
					</>
				) : null}
				<button
					type="button"
					className="annotation-icon-button"
					aria-label="缩小"
					title="缩小"
					onClick={() => {
						const v = viewRef.current;
						changeView(zoomView(v, { x: size.width / 2, y: size.height / 2 }, v.scale / 1.2));
						focusCanvas();
					}}
				>
					<AnnotationIcon kind="zoomOut" />
				</button>
				<button
					type="button"
					className="annotation-icon-button"
					aria-label="放大"
					title="放大"
					onClick={() => {
						const v = viewRef.current;
						changeView(zoomView(v, { x: size.width / 2, y: size.height / 2 }, v.scale * 1.2));
						focusCanvas();
					}}
				>
					<AnnotationIcon kind="zoomIn" />
				</button>
				<button
					type="button"
					className="annotation-icon-button"
					aria-label="适应图片"
					title="适应图片"
					onClick={() => { changeView(fitView(w, h, size.width, size.height)); focusCanvas(); }}
				>
					<AnnotationIcon kind="fit" />
				</button>
			</div> : null}

			<div
				ref={host}
				className="annotation-viewport"
				style={{ cursor: guest || space || tool === "pan" ? "grab" : tool === "select" ? "default" : "crosshair" }}
				role="application"
				aria-label={guest ? "图片标注只读视图" : "图片标注编辑器"}
				// biome-ignore lint/a11y/noNoninteractiveTabindex: custom canvas keyboard focus; parallel object list and forms provide accessible alternatives.
				tabIndex={0}
				data-image-width={w}
				data-image-height={h}
				data-scale={view.scale}
				data-pan-x={view.x}
				data-pan-y={view.y}
				onTouchStartCapture={touches}
				onTouchMoveCapture={touches}
				onTouchEndCapture={endTouches}
				onTouchCancelCapture={cancelGestures}
				onBlur={() => setSpace(false)}
				onKeyUp={(e) => {
					if (e.code === "Space") setSpace(false);
				}}
				onKeyDown={(e) => {
					if (e.target !== host.current) return;
					if (e.code === "Space") {
						e.preventDefault();
						setSpace(true);
						return;
					}
					if (e.key === "Escape") {
						e.preventDefault();
						e.stopPropagation();
						cancelGestures();
						setTool("select");
						onSelect(null);
						return;
					}
					if (!canEdit) return;
					if (e.nativeEvent.isComposing) return;
					if (drawing.current || controlDrag.current || objectDrag.current || triplet.current.length) {
						if (e.ctrlKey || e.metaKey || e.key.startsWith("Arrow") || e.key === "Delete" || e.key === "Backspace")
							e.preventDefault();
						return;
					}
					if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
						e.preventDefault();
						onSave();
					} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
						e.preventDefault();
						if (e.shiftKey) onRedo();
						else onUndo();
					} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
						e.preventDefault();
						onRedo();
					} else if (e.key === "Delete" || e.key === "Backspace") {
						e.preventDefault();
						onDelete();
					} else if (e.key.startsWith("Arrow")) {
						const current = items.find((i) => i.id === selected);
						if (current) {
							e.preventDefault();
							const step = e.shiftKey ? 10 : 1;
							onChange({
								...current,
								geometry: moveGeometry(
									current.geometry,
									e.key === "ArrowLeft"
										? -step / w
										: e.key === "ArrowRight"
											? step / w
											: 0,
									e.key === "ArrowUp"
										? -step / h
										: e.key === "ArrowDown"
											? step / h
											: 0,
									w,
									h,
								),
							});
						}
					}
				}}
			>
				{!bitmap ? (
					<div className={`canvas-message${previewBitmap && !loadError ? " canvas-preview-status" : ""}`}>
						{loadError ? (
							<>
								<p role="alert">图片暂时无法载入。</p>
								<button
									className="annotation-icon-button"
									aria-label="重试图片"
									title="重试图片"
									type="button"
									onClick={() => setAttempt((v) => v + 1)}
								>
									<AnnotationIcon kind="retry" />
								</button>
							</>
						) : (
							<p role="status">{previewBitmap ? "预览已载入，正在准备高清图…" : "载入标准图片…"}</p>
						)}
					</div>
				) : null}
				<Stage
					ref={stage}
					width={size.width}
					height={size.height}
					onMouseDown={begin}
					onClick={placePoint}
					onTap={placePoint}
					onContextMenu={(e) => e.evt.preventDefault()}
					onDblClick={(e) => {
						if (["select", "pan"].includes(tool) && !suppressPointClick.current && e.target === e.target.getStage())
							changeView(fitView(w, h, size.width, size.height));
					}}
					onDblTap={(e) => {
						if (["select", "pan"].includes(tool) && !suppressPointClick.current && e.target === e.target.getStage())
							changeView(fitView(w, h, size.width, size.height));
					}}
					onMouseMove={move}
					onMouseUp={finish}
					onTouchStart={() => {
						if (!multi.current) begin();
					}}
					onTouchMove={move}
					onTouchEnd={finish}
					onWheel={(e) => {
						e.evt.preventDefault();
						if (!e.evt.deltaY) return;
						const point = stage.current?.getPointerPosition();
						if (point)
							changeView(
								zoomView(
									viewRef.current,
									point,
									viewRef.current.scale * (e.evt.deltaY > 0 ? 1 / 1.1 : 1.1),
								),
							);
					}}
				>
					<Layer>
						<Group x={view.x} y={view.y} scaleX={s} scaleY={s}>
							{bitmap || previewBitmap ? (
								<CanvasImage
									image={bitmap ?? previewBitmap ?? undefined}
									width={w}
									height={h}
									listening={false}
								/>
							) : null}
							{bitmap ? items.map((i) => render(i)) : null}
							{partial.length && hover && !draft ? (
								<Line
									points={[...partial, hover].flatMap((p) => [
										p.x * w,
										p.y * h,
									])}
									stroke={mark}
									strokeWidth={2 / s}
									dash={[5 / s, 4 / s]}
									listening={false}
								/>
							) : null}
							{partial.map((point, index) => (
								<Circle
									key={index === 0 ? "first" : "second"}
									x={point.x * w}
									y={point.y * h}
									radius={4 / s}
									fill="white"
									stroke={mark}
									strokeWidth={2 / s}
									listening={false}
								/>
							))}
							{draft && bitmap
								? render(
										{
											id: "preview",
											geometry: draft,
											metadata: {
												name: "",
												dimension: "",
												unit: "mm",
												source: "human",
												circleMeasure: "diameter",
												holeDepth: "",
												holeType: "",
												thread: "",
												notes: "",
											},
										},
										true,
									)
								: null}
						</Group>
					</Layer>
				</Stage>
			</div>
			{!guest && ["angle", "arc"].includes(tool) ? (
				<p role="status">
					{tool === "angle"
						? ["第1点：第一端点", "第2点：角度顶点", "第3点：第二端点"][
								partial.length
							]
						: ["第1点：圆弧起点", "第2点：弧上经过点", "第3点：圆弧终点"][
								partial.length
							]}{" "}
					·{" "}
					<button
						className="annotation-icon-button"
						aria-label="取消"
						title="取消"
						type="button"
						onClick={() => {
							cancelGestures();
							setTool("select");
							focusCanvas();
						}}
					>
						<AnnotationIcon kind="close" />
					</button>
				</p>
			) : null}
			<p className="canvas-help">
				{guest
					? "双指缩放 · 单指平移"
					: tool === "ellipse"
						? "拖动确定一条轴的两端，松开后拖动垂直轴控制点调整宽度"
						: "滚轮缩放 · 空格拖动平移 · 双击空白复位"}
			</p>
		</div>
	);
}
