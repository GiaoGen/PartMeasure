import { useState } from "react";
import { createRoot } from "react-dom/client";
import AnnotationCanvas from "../../src/components/annotation-canvas";
import { AnnotatedThumbnail } from "../../src/components/annotated-thumbnail";
import { ProductSurface } from "../../src/components/product-surface";
import { useProductConfirm } from "../../src/components/product-confirm";
import { WorkspaceContextDialog } from "../../src/components/workspace-context-dialog";
import { WorkspaceSideContent, WorkspaceSideTarget } from "../../src/components/workspace-side-content";
import { Projects } from "../../src/components/projects";
import { IssueInbox } from "../../src/components/issue-inbox";
import { pickAnnotation } from "../../src/components/annotation-picker";
import { emptyMetadata, type AnnotationDraft, type Geometry } from "../../src/lib/annotations";
import "../../src/app/globals.css";
import "../../src/app/product-ui.css";
import "../../src/app/product-motion.css";
import "../../src/components/workspace.css";
import "../../src/components/workspace-popup.css";

const geometries: Geometry[] = [
	{ type: "line", from: { x: .3, y: .5 }, to: { x: .7, y: .5 } },
	{ type: "line", from: { x: .87, y: .4 }, to: { x: .87, y: .6 } },
	{ type: "circle", center: { x: .5, y: .5 }, radiusX: .38, radiusY: .38 },
];
export const fixtureItems = geometries.map((geometry, i) => ({ id: ["inner", "near", "circle"][i] ?? "fixture", geometry, metadata: emptyMetadata() }));
Object.assign(window, { fixturePick: pickAnnotation });
const root = document.getElementById("root");
if (!root) throw Error("FIXTURE_ROOT_MISSING");

function ConfirmSamples() {
	const confirm = useProductConfirm();
	const [answer, setAnswer] = useState(""), [target, setTarget] = useState<HTMLDivElement | null>(null), [open, setOpen] = useState(false);
	const ask = (title: string, long = false) => void confirm({ title, description: long ? "附件与交付说明。\n".repeat(100) : "切换将保留仍在本页的会话；请留意未保存的输入和未完成的操作。", confirmLabel: "仍要继续", cancelLabel: "继续编辑" }).then(value => setAnswer(String(value)));
	return <>
		{["有未完成的修改或操作", "归档项目？", "发布交付版本？", "撤销接收记录？"].map(title => <button key={title} type="button" onClick={() => ask(title)}>{title}</button>)}
		<button type="button" onClick={() => ask("长内容", true)}>长内容</button>
		<button type="button" onClick={() => setOpen(true)}>标注属性</button>
		<WorkspaceContextDialog active={open} mobileOpen={open} title="标注属性" onClose={() => setOpen(false)} targetRef={setTarget} />
		<WorkspaceSideTarget value={target}><WorkspaceSideContent><button type="button" onClick={() => ask("嵌套确认")}>嵌套确认</button></WorkspaceSideContent></WorkspaceSideTarget>
		<pre id="answer">{answer}</pre>
		<IssueInbox base="/api/projects/local" guest={false} refreshKey={0} onInvalid={() => { throw Error("UNEXPECTED_AUTH"); }} onUpdated={() => {}} onDirty={() => {}} />
	</>;
}
function CanvasFixture() {
	const [items, setItems] = useState<AnnotationDraft[]>(fixtureItems), [selected, select] = useState<string | null>(null), [changed, setChanged] = useState(0);
	const [locked, setLocked] = useState(false);
	return <>
		<AnnotationCanvas image={{ id: "photo", width: 400, height: 400, imageHash: "fixture", normalizationVersion: 1 }} src="/pixels.webp" items={items} selected={selected} guest={false} disabled={locked}
			onSelect={select} onCreate={geometry => { const id = `created-${items.length}`; setItems(old => [...old, { id, geometry, metadata: emptyMetadata() }]); select(id); }}
			onChange={item => { setItems(old => old.map(value => value.id === item.id ? item : value)); setChanged(value => value + 1); }} onDelete={() => {}} onUndo={() => {}} onRedo={() => {}} onSave={() => {}} onError={error => { throw Error(error); }} onInvalid={() => { throw Error("UNEXPECTED_AUTH"); }} />
		<pre id="selected">{selected}</pre><pre id="items">{JSON.stringify(items)}</pre><pre id="changed">{changed}</pre>
		<button type="button" onClick={() => { setItems(fixtureItems); select(null); setChanged(0); }}>重置</button>
		<button type="button" id="lock" onClick={() => setLocked(value => !value)}>切换只读</button>
	</>;
}
function GalleryFixture() {
	const [selected, select] = useState("");
	return <><div className="workspace-asset"><AnnotatedThumbnail base="/api/projects/local" fileId="photo" name="fixture.webp" refreshKey={0} thumbnail={{ version: "fixture", width: 400, height: 400 }} onInvalid={() => { throw Error("UNEXPECTED_AUTH"); }} onBrowse={() => select("browse")} onAnnotation={select} /></div><pre id="selected">{selected}</pre></>;
}
const mode = new URLSearchParams(location.search).get("mode");
createRoot(root).render(mode === "projects" ? <Projects initial={[]} initialCursor={null} initialError="" initialFolders={[]} initialFolderError="" /> :
	<ProductSurface className="pm-workspace workspace-redesign">{mode === "canvas" ? <CanvasFixture /> : mode === "gallery" ? <GalleryFixture /> : <ConfirmSamples />}</ProductSurface>);
