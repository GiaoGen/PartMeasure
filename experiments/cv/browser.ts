import { emptyMetadata, validateAnnotation, type Geometry, type Point } from "../../src/lib/annotations";
import { fitDetected, roundGeometry, configuration, type Candidate, type Detections, type PixelEllipse, type LocalResult } from "./core";

const element = <T extends HTMLElement>(id: string) => {
	const found = document.getElementById(id);
	if (!found) throw Error(`Missing ${id}`);
	return found as T;
};
const select = (id: string) => element<HTMLSelectElement>(id);
const input = (id: string) => element<HTMLInputElement>(id);
const button = (id: string) => element<HTMLButtonElement>(id);
const photo = element<HTMLImageElement>("photo");
const svg = document.getElementById("overlay") as unknown as SVGSVGElement;
const message = (text: string) => { element("message").textContent = text; };
const status = (text: string) => { element("status").textContent = text; };
type Sample = { id: string; category: string; width: number; height: number; canonicalSha256: string };
type Operation = { kind: string; elapsedMs: number; detail?: unknown };
type Session = { sample: Sample; task: string; mode: string; engine: string; started: number; startedAt: string; operations: Operation[]; visibilityInterruptions: number; goalAtStart: string; assistanceDisabled: boolean; completedMs: number | null };
let samples: Sample[] = [], session: Session | null = null;
let draft: Geometry | null = null, original: Geometry | null = null;
let points: Point[] = [], history: (Geometry | null)[] = [], candidates: Candidate[] = [];
let pixels: Uint8Array | null = null, detections: Detections | null = null;
let busy = false, loaded = false, epoch = 0, requestId = 0;
let worker: Worker | null = null;
let workerReady: Promise<void> | null = null;
let rejectStartup: ((reason: Error) => void) | null = null;
let rejectPending: ((reason: Error) => void) | null = null;
let resolvePending: ((value: { candidates: Candidate[]; locals: LocalResult[]; totalMs: number }) => void) | null = null;
let activeRequest = 0;
const records: unknown[] = [];
const log = (kind: string, detail?: unknown) => session?.operations.push({ kind, elapsedMs: performance.now() - session.started, ...(detail === undefined ? {} : { detail }) });
const valid = (geometry: Geometry) => {
	if (!session) return false;
	try { validateAnnotation(geometry, emptyMetadata(), session.sample.width, session.sample.height); return true; } catch { return false; }
};
const copy = <T>(value: T): T => structuredClone(value);
function controls() {
	for (const id of ["sample", "mode", "engine"]) select(id).disabled = !!session;
	input("task").disabled = !!session;
	button("start").disabled = !!session || !samples.length;
	button("finish").disabled = !session || !loaded || busy;
	button("complete").disabled = !session || !draft || busy || session.completedMs !== null;
	const closed = !session || session.completedMs !== null;
	for (const id of ["undo", "clear"]) button(id).disabled = closed || !pixels || busy;
	select("tool").disabled = closed || !pixels || busy;
	button("detect").disabled = closed || !session || !pixels || busy || session.assistanceDisabled || !["candidates", "combined"].includes(session.mode);
	button("cancel").disabled = closed || !session || !loaded || session.mode === "manual" || session.assistanceDisabled;
}
function stopWorker() {
	worker?.terminate(); worker = null; workerReady = null;
	rejectStartup?.(Error("CANCELLED")); rejectStartup = null;
	rejectPending?.(Error("CANCELLED")); rejectPending = null; resolvePending = null;
}
function loadWorker() {
	if (workerReady) return workerReady;
	workerReady = new Promise<void>((resolve, reject) => {
		const instance = new Worker("/worker.js"); worker = instance;
		const timer = window.setTimeout(() => { reject(Error("CV_LOAD_TIMEOUT")); stopWorker(); }, 20000);
		rejectStartup = reason => { clearTimeout(timer); reject(reason); };
		instance.onmessage = event => {
			if (worker !== instance) return;
			const data = event.data;
			if (data.kind === "ready") { clearTimeout(timer); rejectStartup = null; log("browser-cv-ready", { initializationMs: data.initializationMs }); resolve(); }
			else if (data.kind === "result" && data.id === activeRequest) { resolvePending?.(data.result); resolvePending = null; rejectPending = null; }
			else if (data.kind === "error") { clearTimeout(timer); reject(Error(data.message)); rejectPending?.(Error(data.message)); resolvePending = null; rejectPending = null; }
		};
		instance.onerror = () => { clearTimeout(timer); reject(Error("CV_WORKER_FAILED")); rejectPending?.(Error("CV_WORKER_FAILED")); };
	});
	return workerReady;
}
async function compute(drafts: Geometry[], detect: boolean) {
	if (!session || !pixels) throw Error("IMAGE_NOT_READY");
	const current = session;
	if (current.engine === "edge") {
		if (!detections) throw Error("EDGE_FEATURES_MISSING");
		return { candidates: detect ? detections.rounds.slice(0, configuration.maxCandidates) : [], locals: drafts.map(g => fitDetected(detections as Detections, g, current.sample.width, current.sample.height)), totalMs: null };
	}
	await loadWorker();
	if (session !== current || current.assistanceDisabled) throw Error("CANCELLED");
	const buffer = pixels.slice();
	const result = await new Promise<{ candidates: Candidate[]; locals: LocalResult[]; totalMs: number }>((resolve, reject) => {
		activeRequest = ++requestId;
		const timer = window.setTimeout(() => { stopWorker(); reject(Error("CV_COMPUTE_TIMEOUT")); }, 15000);
		resolvePending = value => { clearTimeout(timer); resolve(value); };
		rejectPending = error => { clearTimeout(timer); reject(error); };
		worker?.postMessage({ id: activeRequest, rgba: buffer, width: current.sample.width, height: current.sample.height, drafts, candidates: detect }, [buffer.buffer]);
	});
	return result;
}
async function assist(detect: boolean) {
	if (!session || session.assistanceDisabled || busy) return;
	const current = session, token = epoch, before = copy(draft), began = performance.now();
	busy = true; controls(); status("正在计算；可取消，原草稿保留。");
	try {
		const result = await compute(detect || !draft ? [] : [draft], detect);
		if (session !== current || epoch !== token) return;
		log(detect ? "candidate-call" : "local-fit", { waitMs: performance.now() - began, computeMs: result.totalMs, locals: result.locals, nativePrecomputed: current.engine === "edge" });
		if (detect) { candidates = result.candidates.filter(c => valid(c.geometry)); renderCandidates(); }
		else {
			const fit = result.locals[0];
			if (fit?.changed && valid(fit.output)) { history.push(before); original = before; draft = fit.output; }
			status(fit?.changed ? "已尝试贴合；请判断是否正确，可撤销或拖动修正。" : "无可靠匹配，保留原手画。");
		}
		if (detect) status(`${candidates.length} 个候选；未选用的候选不会成为草稿。`);
		render();
	} catch (error) {
		if (session !== current || epoch !== token) return;
		log("failure", String(error)); message(`辅助未完成：${String(error)}。原草稿保留，可继续手动。`);
		stopWorker();
	} finally { if (session === current) { busy = false; controls(); } }
}
function setDraft(geometry: Geometry) {
	if (!valid(geometry)) { message("几何越界或点过近，请重新选择。"); return; }
	history.push(copy(draft)); draft = geometry; original = null; points = []; message("");
	log("draw", copy(geometry)); render(); controls();
	if (session && ["local", "combined"].includes(session.mode) && !session.assistanceDisabled) void assist(false);
}
function geometryFromPoints(p: Point[]): Geometry | null {
	const a = p[0], b = p[1], c = p[2];
	if (!a || !b || !session) return null;
	const { width: w, height: h } = session.sample;
	if (select("tool").value === "line") return { type: "line", from: a, to: b };
	if (select("tool").value === "angle" && c) return { type: "angle", from: a, vertex: b, to: c, reflex: false };
	if (select("tool").value === "circle") {
		const radius = Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
		return { type: "circle", center: a, radiusX: radius / w, radiusY: radius / h };
	}
	if (select("tool").value === "ellipse" && c) {
		const angle = Math.atan2((b.y - a.y) * h, (b.x - a.x) * w);
		const radius = -(c.x - a.x) * w * Math.sin(angle) + (c.y - a.y) * h * Math.cos(angle);
		return { type: "ellipse", center: a, axisA: b, axisB: { x: a.x - radius * Math.sin(angle) / w, y: a.y + radius * Math.cos(angle) / h } };
	}
	return null;
}
const namespace = "http://www.w3.org/2000/svg";
function node(tag: string, attributes: Record<string, string | number>) {
	const n = document.createElementNS(namespace, tag);
	for (const [key, value] of Object.entries(attributes)) n.setAttribute(key, String(value));
	return n;
}
function draw(g: Geometry, color: string, dashed = false) {
	if (!session) return;
	const { width: w, height: h } = session.sample;
	const attrs = { fill: "none", stroke: color, "stroke-width": 3, "vector-effect": "non-scaling-stroke", ...(dashed ? { "stroke-dasharray": "7 5" } : {}) };
	if (g.type === "line" || g.type === "angle") svg.append(node("path", { ...attrs, d: g.type === "line" ? `M${g.from.x*w},${g.from.y*h}L${g.to.x*w},${g.to.y*h}` : `M${g.from.x*w},${g.from.y*h}L${g.vertex.x*w},${g.vertex.y*h}L${g.to.x*w},${g.to.y*h}` }));
	if (g.type === "circle") svg.append(node("ellipse", { ...attrs, cx: g.center.x*w, cy: g.center.y*h, rx: g.radiusX*w, ry: g.radiusY*h }));
	if (g.type === "ellipse") {
		const x = g.center.x*w, y = g.center.y*h;
		svg.append(node("ellipse", { ...attrs, cx: x, cy: y, rx: Math.hypot(g.axisA.x*w-x,g.axisA.y*h-y), ry: Math.hypot(g.axisB.x*w-x,g.axisB.y*h-y), transform: `rotate(${Math.atan2(g.axisA.y*h-y,g.axisA.x*w-x)*180/Math.PI} ${x} ${y})` }));
	}
}
function handles(g: Geometry): [string, Point][] {
	if (g.type === "line") return [["from",g.from],["to",g.to]];
	if (g.type === "angle") return [["from",g.from],["vertex",g.vertex],["to",g.to]];
	if (g.type === "circle") return [["center",g.center],["radius",{x:g.center.x+g.radiusX,y:g.center.y}]];
	if (g.type === "ellipse") return [["center",g.center],["axisA",g.axisA],["axisB",g.axisB]];
	return [];
}
function render() {
	svg.replaceChildren(); if (!session) return;
	const { width: w, height: h } = session.sample;
	for (const [i,c] of candidates.entries()) { draw(c.geometry,"#697586",true); const label=node("text",{x:c.pixel.x+5,y:c.pixel.y});label.textContent=String(i+1);svg.append(label); }
	if (original) draw(original,"#697586",true);
	if (draft) {
		draw(draft,"#175cd3");
		for (const [key,p] of handles(draft)) svg.append(node("circle",{cx:p.x*w,cy:p.y*h,r:Math.max(7,12*w/Math.max(1,svg.clientWidth)),fill:"white",stroke:"#175cd3","stroke-width":2,"data-handle":key}));
	}
	for (const p of points) svg.append(node("circle",{cx:p.x*w,cy:p.y*h,r:6,fill:"#175cd3"}));
}
function renderCandidates() {
	const list = element("candidate-list"); list.replaceChildren();
	for (const [i,c] of candidates.entries()) {
		const row=document.createElement("div"); row.className="candidate";
		const adopt=document.createElement("button");adopt.type="button";adopt.textContent=`选用 ${i+1} · ${c.geometry.type === "circle" ? "圆" : "椭圆"}`;
		adopt.onclick=()=>{ if (!session || session.completedMs !== null || busy) return; history.push(copy(draft));draft=copy(c.geometry);original=null;points=[];log("adopt-candidate",{index:i,geometry:c.geometry});render();controls(); };
		row.append(adopt);
		for (const [field,options] of [["contour",["轮廓未评价","轮廓正确","轮廓错误","含糊"]],["hole",["孔未评价","是孔","不是孔","无法判断"]]] as const) {
			const review=document.createElement("select");review.dataset.index=String(i);review.dataset.field=field;review.setAttribute("aria-label",`候选${i+1}${field}`);
			for (const text of options) { const option=document.createElement("option");option.value=text;option.textContent=text;review.append(option); } row.append(review);
		} list.append(row);
	}
}
function position(event: PointerEvent): Point | null {
	const matrix=svg.getScreenCTM(); if (!matrix || !session) return null;
	const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
	return {x:Math.max(0,Math.min(1,p.x/session.sample.width)),y:Math.max(0,Math.min(1,p.y/session.sample.height))};
}
let drag: { pointer: number; key: string; before: Geometry; changed: boolean } | null = null;
let drawingPointer: number | null = null;
svg.addEventListener("pointerdown", event=>{
	if (!session || session.completedMs !== null || !loaded || !pixels || busy || event.button !== 0 || drag || drawingPointer !== null) return;
	const key=(event.target as Element).getAttribute("data-handle");
	if (key && draft) { drag={pointer:event.pointerId,key,before:copy(draft),changed:false};svg.setPointerCapture(event.pointerId); }
	else drawingPointer = event.pointerId;
});
svg.addEventListener("pointermove",event=>{
	if (!drag || drag.pointer!==event.pointerId || !draft || !session) return;
	const p=position(event);if (!p)return;
	const g=copy(drag.before),{width:w,height:h}=session.sample;
	if (g.type === "circle" && drag.key === "radius") { const r=Math.hypot((p.x-g.center.x)*w,(p.y-g.center.y)*h);g.radiusX=r/w;g.radiusY=r/h; }
	else if ((g.type === "circle" || g.type === "ellipse") && drag.key === "center") {
		const dx=p.x-g.center.x,dy=p.y-g.center.y;g.center=p;
		if(g.type==="ellipse"){g.axisA={x:g.axisA.x+dx,y:g.axisA.y+dy};g.axisB={x:g.axisB.x+dx,y:g.axisB.y+dy};}
	} else if (g.type === "ellipse") {
		const angle=Math.atan2((g.axisA.y-g.center.y)*h,(g.axisA.x-g.center.x)*w), oldB=Math.hypot((g.axisB.x-g.center.x)*w,(g.axisB.y-g.center.y)*h);
		if(drag.key==="axisA"){g.axisA=p;const theta=Math.atan2((p.y-g.center.y)*h,(p.x-g.center.x)*w);g.axisB={x:g.center.x-oldB*Math.sin(theta)/w,y:g.center.y+oldB*Math.cos(theta)/h};}
		else{const r=-(p.x-g.center.x)*w*Math.sin(angle)+(p.y-g.center.y)*h*Math.cos(angle);g.axisB={x:g.center.x-r*Math.sin(angle)/w,y:g.center.y+r*Math.cos(angle)/h};}
	} else if(g.type==="line" || g.type==="angle") { if(drag.key==="from")g.from=p;else if(drag.key==="to")g.to=p;else if(g.type==="angle")g.vertex=p; }
	if(valid(g)){draft=g;drag.changed=JSON.stringify(g)!==JSON.stringify(drag.before);render();}
});
svg.addEventListener("pointerup",event=>{
	if (drag) { if (drag.pointer!==event.pointerId)return;if(drag.changed){history.push(drag.before);log("manual-adjust",copy(draft));}drag=null;svg.releasePointerCapture(event.pointerId);return; }
	if(drawingPointer !== event.pointerId)return;drawingPointer=null;
	if(!session || session.completedMs !== null || !loaded || !pixels || busy)return;const p=position(event);if(!p)return;points.push(p);render();
	const needed=["angle","ellipse"].includes(select("tool").value)?3:2;
	if(points.length>=needed){const g=geometryFromPoints(points);if(g)setDraft(g);points=[];render();}
});
svg.addEventListener("pointercancel",()=>{drawingPointer=null;if(drag){draft=drag.before;drag=null;render();log("pointer-cancel");}});
svg.addEventListener("pointerleave",()=>{drawingPointer=null;});
select("tool").onchange=()=>{points=[];render();};
document.addEventListener("keydown",event=>{if(event.key==="Escape"){points=[];render();}});
button("undo").onclick=()=>{if(!session||busy)return;log("undo");if(points.length)points.pop();else if(history.length)draft=history.pop()??null;original=null;render();controls();};
button("clear").onclick=()=>{history.push(copy(draft));draft=null;original=null;points=[];log("redraw");render();controls();};
button("detect").onclick=()=>void assist(true);
button("cancel").onclick=()=>{if(!session)return;epoch++;session.assistanceDisabled=true;stopWorker();busy=false;log("disable-or-cancel");status("辅助已关闭；保留原草稿，可继续手动。重新开始一条记录后可再次使用。");controls();};
document.addEventListener("visibilitychange",()=>{if(session && document.hidden){session.visibilityInterruptions++;log("hidden");}});
button("start").onclick=async()=>{
	const sample=samples.find(s=>s.id===select("sample").value);if(!sample)return;
	const task=input("task").value.trim();if(!task){message("请填写任务编号，以便配对同一目标。");return;}
	const token=++epoch;session={sample,task,mode:select("mode").value,engine:select("engine").value,started:performance.now(),startedAt:new Date().toISOString(),operations:[],visibilityInterruptions:0,goalAtStart:element<HTMLTextAreaElement>("goal").value,assistanceDisabled:false,completedMs:null};
	loaded=false;busy=true;draft=null;original=null;points=[];history=[];candidates=[];detections=null;pixels=null;stopWorker();renderCandidates();render();photo.hidden=true;controls();message("");status("加载照片中，计时已经开始。");
	for(const id of ["notes","miss-circle","miss-ellipse"]) input(id).value="";
	select("judgement").value="unreviewed";
	try{
		photo.src=`/images/${sample.id}.png`;await photo.decode();if(token!==epoch)return;
		if(photo.naturalWidth!==sample.width || photo.naturalHeight!==sample.height)throw Error("IMAGE_DIMENSIONS");
		photo.hidden=false;svg.setAttribute("viewBox",`0 0 ${sample.width} ${sample.height}`);
		const canvas=document.createElement("canvas");canvas.width=sample.width;canvas.height=sample.height;const context=canvas.getContext("2d");if(!context)throw Error("CANVAS_UNAVAILABLE");context.drawImage(photo,0,0);pixels=new Uint8Array(context.getImageData(0,0,sample.width,sample.height).data);
		if(session?.engine==="edge" && session.mode!=="manual"){
			const response=await fetch(`/features/${sample.id}.json`);if(!response.ok)throw Error("EDGE_FEATURES_MISSING");
			const raw=await response.json() as { canonicalSha256:string; lines:Detections["lines"];rounds:PixelEllipse[];totalMs:number };
			if(token!==epoch)return;if(raw.canonicalSha256!==sample.canonicalSha256)throw Error("EDGE_HASH_MISMATCH");
			const rounds:Candidate[]=[];for(const e of raw.rounds){if(rounds.some(c=>Math.hypot(e.x-c.pixel.x,e.y-c.pixel.y)<Math.max(3,e.ry*.12)&&Math.abs(Math.log(e.rx/c.pixel.rx))<.15&&Math.abs(Math.log(e.ry/c.pixel.ry))<.15))continue;rounds.push({geometry:roundGeometry(e,sample.width,sample.height),pixel:e,quality:1,coverage:null,residual:null});}
			detections={lines:raw.lines,rounds};log("offline-native-features",{nativeComputeMs:raw.totalMs,excludedFromHumanWallTime:true});
		}
		loaded=true;log("image-ready");status("按工具提示点击绘制；目标完成后填写观察并结束记录。");
	}catch(error){log("load-failure",String(error));message(`加载失败：${String(error)}。本条将记为失败，可结束记录。`);loaded=true;}
	finally{busy=false;controls();}
};
const optionalCount=(id:string)=>{const value=input(id).value;return value===""?null:Math.max(0,Math.floor(Number(value)));};
button("complete").onclick=()=>{if(!session || !draft || busy)return;session.completedMs=performance.now()-session.started;points=[];log("task-completed");status("操作计时已停止。现在填写评价，再保存记录；评价时间单独排除。");controls();};
button("finish").onclick=()=>{
	if(!session || busy)return;
	const current=session;
	const reviews=Array.from(element("candidate-list").querySelectorAll("select")).map(s=>({index:Number(s.dataset.index),field:s.dataset.field,value:s.value}));
	const entry={...current,started:undefined,endedAt:new Date().toISOString(),wallMs:performance.now()-current.started,goal:element<HTMLTextAreaElement>("goal").value,finalGeometry:copy(draft),judgement:select("judgement").value,missed:{circle:optionalCount("miss-circle"),ellipse:optionalCount("miss-ellipse")},candidateGeometries:candidates.map(c=>c.geometry),candidateReviews:reviews,notes:element<HTMLTextAreaElement>("notes").value,userAgent:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},limitation:current.engine==="edge"?"Native preprocessing cost is excluded; not deployable browser performance evidence.":"Independent lab; does not prove production editor UX."};
	records.push(entry);if(records.length>150)records.shift();element("record-count").textContent=`${records.length} 条（仅当前页面内存，请导出；刷新会丢失）`;
	element("results").textContent=`最近一条：${current.sample.id}\n${current.mode} · ${(entry.wallMs/1000).toFixed(1)} 秒\n草稿：${draft?.type??"无"}；后台中断：${current.visibilityInterruptions}`;
	epoch++;stopWorker();session=null;loaded=false;controls();status("已记录，请导出 JSON。下一条使用相同任务编号可做配对对照。");
};
button("export").onclick=()=>{
	const data={schemaVersion:1,experiment:"P1-03",exportedAt:new Date().toISOString(),status:"human-records-require-review",records,notes:"Self-reported outcomes; no automatic precision/recall or pass inference. Native-precomputed times exclude detection. Background interruptions, failed or empty tasks must be reviewed."};
	const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));const link=document.createElement("a");link.href=url;link.download="p1-03-human-records.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
window.addEventListener("beforeunload",event=>{if(session||records.length){event.preventDefault();}});
void fetch("/manifest.json").then(r=>{if(!r.ok)throw Error("MANIFEST_MISSING");return r.json();}).then(data=>{samples=data.items;for(const s of samples){const option=document.createElement("option");option.value=s.id;option.textContent=s.id;select("sample").append(option);}controls();}).catch(error=>message(String(error)));
controls();
