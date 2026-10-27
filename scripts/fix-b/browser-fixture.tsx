// Component fixture only: actual hooks/history classes, local synthetic pixels, no Auth/API claims.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ApplicationHistory } from "../../src/components/application-history";
import { WorkspaceHistory } from "../../src/components/workspace-history";
import { MeasurementHelp } from "../../src/components/measurement-help";
import { useCvAssistance } from "../../src/components/use-cv-assistance";
import { useProjectDialog } from "../../src/components/projects-motion";
import "../../src/components/measurement-help.css";
import "../../src/app/product-ui.css";
import "../../src/app/product-motion.css";
type FixtureWindow = Window & { fixtureImage: { width: number; height: number; imageHash: string; src: string } };
function Fixture() {
	const data = (window as unknown as FixtureWindow).fixtureImage;
	const [bitmap, setBitmap] = useState<HTMLImageElement | null>(null);
	const [input, setInput] = useState("");
	const history = useRef<WorkspaceHistory | null>(null);
	const popup = useProjectDialog();
	useEffect(() => {
		const image = new Image(); image.onload = () => setBitmap(image); image.src = data.src;
		return () => { image.onload = null; history.current?.dispose(); };
	}, []);
	const cv = useCvAssistance({ image: { id: "fixture", width: data.width, height: data.height, imageHash: data.imageHash, normalizationVersion: 1 }, src: "/synthetic-local-only", bitmap, allowed: true, apply: undefined });
	async function prepareHistory() {
		history.current?.dispose();
		window.history.pushState({ source: "list" }, "", "/fix-b-list");
		window.history.pushState({ source: "workspace" }, "", "/fix-b-workspace?section=files");
		window.history.pushState({ source: "later" }, "", "/fix-b-later");
		await new Promise<void>(resolve => {
			window.addEventListener("popstate", () => resolve(), { once: true }); window.history.back();
		});
		history.current = new WorkspaceHistory(window, "/api/projects/fixture", false, () => ({ canLeave: () => window.confirm("fixture: leave unsaved input?"), restore() {} }));
	}
	return <main className="pm-ui" style={{ maxWidth: 390, padding: 20 }}>
		<h1>FIX-B 本地组件隔离样本</h1>
		<p>无认证、业务权限或真实手机验收含义。</p>
		<label>未提交输入<input value={input} onChange={event => setInput(event.target.value)} /></label>
		<button type="button" onClick={() => void prepareHistory()}>准备同文档历史</button>
		<button type="button" onClick={popup.open}>打开弹框</button>
		<dialog ref={popup.ref}><p>组件样本</p><button type="button" onClick={() => { popup.close(); popup.open(); }}>关闭并立即重开</button><button type="button" onClick={() => popup.close()}>关闭弹框</button></dialog>
		<MeasurementHelp method="outside" />
		<div><button type="button" disabled={!bitmap || cv.busy} onClick={cv.detect}>检测组件样本</button>{cv.busy ? <button type="button" onClick={cv.cancel}>取消组件辅助</button> : null}<p id="cv-status">{cv.status}</p><p id="cv-busy">{String(cv.busy)}</p></div>
	</main>;
}
createRoot(document.getElementById("root") as HTMLElement).render(<><ApplicationHistory /><Fixture /></>);
