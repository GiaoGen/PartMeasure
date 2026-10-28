// Actual production canvas and image/cache code, synthetic local pixels only.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import AnnotationCanvas from "../../src/components/annotation-canvas";
import { emptyMetadata, type AnnotationDraft, type Geometry } from "../../src/lib/annotations";

function Fixture() {
	const [items, setItems] = useState<AnnotationDraft[]>([]);
	const [selected, select] = useState<string | null>(null);
	const [errors, setErrors] = useState<string[]>([]);
	return <main style={{ width: 380 }}>
		<AnnotationCanvas
			image={{ id: "touch-fixture", width: 400, height: 400, imageHash: "synthetic-touch-image", normalizationVersion: 1 }}
			src="/touch-pixels.webp" items={items} selected={selected} guest={false} disabled={false}
			onSelect={select}
			onCreate={(geometry: Geometry) => {
				const id = String(items.length + 1);
				setItems(previous => [...previous, { id, geometry, metadata: emptyMetadata() }]);
				select(id);
			}}
			onChange={item => setItems(previous => previous.map(current => current.id === item.id ? item : current))}
			onDelete={() => {}} onUndo={() => {}} onRedo={() => {}} onSave={() => {}}
			onError={error => setErrors(previous => [...previous, error])} onInvalid={() => setErrors(previous => [...previous, "invalid"])}
		/>
		<pre id="created">{JSON.stringify(items.map(item => item.geometry))}</pre>
		<pre id="errors">{JSON.stringify(errors)}</pre>
	</main>;
}
createRoot(document.getElementById("root") as HTMLElement).render(<Fixture />);
