import { createRoot } from "react-dom/client";
import { AnnotationEditor } from "../../src/components/annotation-editor";
import { ProductSurface } from "../../src/components/product-surface";
import { drawExportAnnotations } from "../../src/components/render-annotated-export";
import type { AnnotatedExport } from "../../src/lib/annotated-export";
import "../../src/app/globals.css";
import "../../src/app/product-ui.css";
import "../../src/components/workspace.css";
import "../../src/components/annotation-properties.css";

Object.assign(window, { renderFixtureExport: async (snapshot: AnnotatedExport) => {
	const canvas = document.querySelector<HTMLCanvasElement>("#export-canvas");
	const ctx = canvas?.getContext("2d");
	if (!canvas || !ctx) throw Error("EXPORT_CANVAS_MISSING");
	ctx.fillStyle = "#e7edf3"; ctx.fillRect(0, 0, 400, 400);
	await drawExportAnnotations(ctx, snapshot, { x: 0, y: 0, width: 400, height: 400 }, new AbortController().signal);
} });
const root = document.getElementById("root");
if (!root) throw Error("FIXTURE_ROOT_MISSING");
createRoot(root).render(
	<ProductSurface className="pm-workspace workspace-redesign">
		<AnnotationEditor base="/api/projects/local" fileId="photo" guest={false} onInvalid={() => { throw Error("unexpected auth invalidation"); }} onDirty={() => {}} onIssueCreated={() => {}} onOpenIssue={() => {}} />
		<canvas id="export-canvas" width={400} height={400} />
	</ProductSurface>,
);
