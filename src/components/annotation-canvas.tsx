"use client";
import {
	anchor,
	angleGeometry,
	ellipseGeometry,
	editEllipse,
	makeEllipse,
	normalized,
	pixel,
} from "@/lib/geometry-extensions";
import {
	geometryPaths,
	labelPosition,
	annotationText,
} from "@/lib/annotation-presentation";
import { annotationStatus } from "@/lib/annotation-collaboration";
import { useEffect, useRef, useState } from "react";
import type Konva from "konva";
import { privateImage, discardPrivateImage } from "./private-image-cache";
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
	arc: "圆弧",
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
	showNumbers = true,
	canUndo = false,
	canRedo = false,
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
	showNumbers?: boolean;
	canUndo?: boolean;
	canRedo?: boolean;
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
		[loadError, setLoadError] = useState(false),
		[attempt, setAttempt] = useState(0),
		[tool, setTool] = useState<Tool>("select"),
		[space, setSpace] = useState(false),
		[draft, setDraft] = useState<Geometry | null>(null);
	const triplet = useRef<Point[]>([]);
	const [partial, setPartial] = useState<Point[]>([]);
	const [hover, setHover] = useState<Point | null>(null);
	const drawing = useRef<Draw | null>(null),
		panning = useRef<{ start: Point; view: View } | null>(null),
		pinch = useRef<{ distance: number; center: Point; view: View } | null>(
			null,
		),
		multi = useRef(false);
	const handlers = useRef({ onCreate, onError, onInvalid });
	handlers.current = { onCreate, onError, onInvalid };
	const canEdit = !guest && !disabled;
	useEffect(() => {
		let lease: { url: string; release: () => void } | undefined;
		let objectUrl = "",
			img: HTMLImageElement | null = null,
			active = true;
		setBitmap(null);
		setLoadError(false);
		void (async () => {
			try {
				if (attempt > 0) discardPrivateImage(src, image.imageHash);
				const value = await privateImage(src, image.imageHash);
				if (!active) {
					value.release();
					return;
				}
				lease = value;
				objectUrl = value.url;
				img = new window.Image();
				img.onload = () => {
					if (!active || !img) return;
					if (
						img.naturalWidth !== image.width ||
						img.naturalHeight !== image.height
					) {
						setLoadError(true);
						handlers.current.onError(
							"图片尺寸与标准图记录不一致，已停止编辑。",
						);
						return;
					}
					setBitmap(img);
				};
				img.onerror = () => {
					if (active) setLoadError(true);
				};
				img.src = objectUrl;
			} catch {
				if (active) setLoadError(true);
			}
		})();
		return () => {
			active = false;
			if (img) {
				img.onload = null;
				img.onerror = null;
				img.src = "";
			}
			lease?.release();
		};
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
	}, [image.width, image.height]);
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
		if (d && !multi.current) {
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
		if (tool === "angle" || tool === "arc") {
			const points = [...triplet.current, normalized];
			if (points.length === 3) {
				const [a, b, c] = points;
				if (a && b && c)
					handlers.current.onCreate(
						tool === "angle"
							? {
									type: "angle",
									vertex: a,
									from: b,
									to: c,
									reflex: false,
									arcScale: 0.35,
								}
							: { type: "arc", from: a, via: b, to: c },
					);
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
		drawing.current = { tool, from: normalized, to: normalized };
		setDraft(asGeometry(drawing.current));
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
					tool === "angle"
						? {
								type: "angle",
								vertex: a,
								from: b,
								to: q,
								reflex: false,
								arcScale: 0.35,
							}
						: { type: "arc", from: a, via: b, to: q },
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
		multi.current = true;
		triplet.current = [];
		setPartial([]);
		setHover(null);
		drawing.current = null;
		panning.current = null;
		setDraft(null);
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
			stage.current?.find("Group").forEach((node) => {
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
		if (!guest && !space && !["select", "pan"].includes(tool)) return;
		if ((!space && !multi.current) || guest) {
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
		const g = item.geometry,
			chosen = !preview && selected === item.id,
			editing = canEdit && chosen && !space && !preview,
			stroke = chosen ? "#273444" : mark,
			lineWidth = (chosen ? 3 : 2) / s;
		const p = anchor(g);
		const label = [item.metadata.name, annotationText(item)]
			.filter(Boolean)
			.join(" · ");
		const position = labelPosition(g, w, h, s);
		const paths = geometryPaths(g, w, h, s, editing).map((data, i) => ({
			data,
			role: ["outline", "detail", "secondary"][i] ?? "extra",
		}));
		const shape =
			g.type === "text" ? (
				<Text
					x={g.at.x * w}
					y={g.at.y * h}
					text={g.text || "备注"}
					fontSize={16 / s}
					fill={stroke}
					padding={3 / s}
				/>
			) : (
				paths.map(({ data, role }) => (
					<Path
						key={role}
						data={data}
						stroke={stroke}
						strokeWidth={lineWidth}
						hitStrokeWidth={44 / s}
						fill={g.type === "point" ? stroke : "transparent"}
					/>
				))
			);
		const handles: { key: string; point: Point }[] = [];
		if (chosen && editing) {
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
					onDragEnd={(e) => {
						const node = e.target,
							dx = node.x() / w,
							dy = node.y() / h;
						node.position({ x: 0, y: 0 });
						if (!multi.current)
							onChange({ ...item, geometry: moveGeometry(g, dx, dy, w, h) });
					}}
				>
					{g.type !== "text"
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
					{!preview && showNumbers ? (
						<Group
							x={Math.max(14 / s, Math.min(w - 14 / s, p.x * w))}
							y={Math.max(14 / s, p.y * h - 18 / s)}
							listening={false}
						>
							<Circle radius={11 / s} fill={stroke} />
							<Text
								x={-11 / s}
								y={-7 / s}
								width={22 / s}
								align="center"
								text={String(items.findIndex((i) => i.id === item.id) + 1)}
								fontSize={13 / s}
								fill="white"
							/>
						</Group>
					) : null}
					{label && g.type !== "text" ? (
						<Text
							x={Math.max(0, Math.min(w - 180 / s, position.x - 90 / s))}
							y={Math.max(0, Math.min(h - 42 / s, position.y - 14 / s))}
							width={180 / s}
							align="center"
							text={`${label}${annotationStatus(item) ? ` · ${annotationStatus(item)}` : ""}`}
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
						stroke={mark}
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
						onDragEnd={(e) => {
							if (multi.current) {
								e.target.position({ x: point.x * w, y: point.y * h });
								return;
							}
							const endPoint = clamp({
								x: e.target.x() / w,
								y: e.target.y() / h,
							});
							e.target.position({ x: point.x * w, y: point.y * h });
							let geometry: Geometry = g;
							if (g.type === "line")
								geometry = {
									...g,
									...(key === "from" ? { from: endPoint } : { to: endPoint }),
								};
							else if (g.type === "circle")
								geometry = makeCircle(g.center, endPoint, w, h);
							else if (g.type === "arc") geometry = { ...g, [key]: endPoint };
							else if (g.type === "angle") {
								if (key === "arcScale") {
									const v = angleGeometry(g, w, h),
										q = pixel(endPoint, w, h);
									geometry = {
										...g,
										arcScale: Math.max(
											0.1,
											Math.min(
												0.85,
												((g.arcScale ?? 0.35) *
													Math.hypot(q.x - v.center.x, q.y - v.center.y)) /
													Math.max(v.radius, 0.001),
											),
										),
									};
								} else geometry = { ...g, [key]: endPoint };
							} else if (g.type === "ellipse")
								geometry =
									key === "center"
										? moveGeometry(
												g,
												endPoint.x - g.center.x,
												endPoint.y - g.center.y,
												w,
												h,
											)
										: editEllipse(g, key, endPoint, w, h);
							onChange({ ...item, geometry });
						}}
					/>
				))}
			</Group>
		);
	}
	return (
		<div className="canvas-column">
			{!guest ? (
				<div
					className="annotation-toolbar"
					role="toolbar"
					aria-label="标注工具"
				>
					{(["select", "line", "circle", "angle"] as Tool[]).map((value) => (
						<button
							key={value}
							type="button"
							disabled={disabled}
							aria-pressed={tool === value}
							onClick={() => {
								setTool(value);
								drawing.current = null;
								triplet.current = [];
								setPartial([]);
								setHover(null);
								setDraft(null);
							}}
						>
							{names[value]}
						</button>
					))}
					<label className="more-annotation-tools">
						更多
						<select
							aria-label="更多标注工具"
							disabled={disabled}
							value={
								["arc", "ellipse", "point", "text"].includes(tool) ? tool : ""
							}
							onChange={(e) => {
								setTool(e.target.value as Tool);
								drawing.current = null;
								triplet.current = [];
								setPartial([]);
								setHover(null);
								setDraft(null);
							}}
						>
							<option value="" disabled>
								选择工具
							</option>
							{(["arc", "ellipse", "point", "text"] as Tool[]).map((value) => (
								<option key={value} value={value}>
									{names[value]}
								</option>
							))}
						</select>
					</label>

					<button
						type="button"
						disabled={disabled || !canUndo}
						onClick={onUndo}
					>
						撤销
					</button>
					<button
						type="button"
						disabled={disabled || !canRedo}
						onClick={onRedo}
					>
						重做
					</button>
				</div>
			) : null}
			<div
				ref={host}
				className="annotation-viewport"
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
				onTouchCancelCapture={endTouches}
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
						drawing.current = null;
						triplet.current = [];
						setPartial([]);
						setHover(null);
						setDraft(null);
						setTool("select");
						onSelect(null);
						return;
					}
					if (!canEdit) return;
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
					<div className="canvas-message">
						{loadError ? (
							<>
								<p role="alert">图片暂时无法载入。</p>
								<button type="button" onClick={() => setAttempt((v) => v + 1)}>
									重试图片
								</button>
							</>
						) : (
							<p role="status">载入标准图片…</p>
						)}
					</div>
				) : null}
				<Stage
					ref={stage}
					width={size.width}
					height={size.height}
					onMouseDown={begin}
					onContextMenu={(e) => e.evt.preventDefault()}
					onDblClick={(e) => {
						if (e.target === e.target.getStage())
							setView(fitView(w, h, size.width, size.height));
					}}
					onDblTap={(e) => {
						if (e.target === e.target.getStage())
							setView(fitView(w, h, size.width, size.height));
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
						const point = stage.current?.getPointerPosition();
						if (point)
							setView((v) =>
								zoomView(
									v,
									point,
									v.scale * (e.evt.deltaY > 0 ? 1 / 1.1 : 1.1),
								),
							);
					}}
				>
					<Layer>
						<Group x={view.x} y={view.y} scaleX={s} scaleY={s}>
							{bitmap ? (
								<CanvasImage
									image={bitmap}
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
						? ["点选顶点", "点选第一条边", "点选第二条边"][partial.length]
						: ["点选弧起点", "点选弧上的中间点", "点选终点"][
								partial.length
							]}{" "}
					·{" "}
					<button
						type="button"
						onClick={() => {
							triplet.current = [];
							setPartial([]);
							setHover(null);
							setDraft(null);
							setTool("select");
						}}
					>
						取消
					</button>
				</p>
			) : null}
			<p className="canvas-help">
				{guest
					? "双指缩放 · 单指平移"
					: "滚轮缩放 · 空格拖动平移 · 双击空白复位"}
			</p>
		</div>
	);
}
