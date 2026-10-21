import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { emptyMetadata, type Annotation } from "../../src/lib/annotations";

const fixture = vi.hoisted(() => ({
	items: [] as Annotation[],
	selected: "",
	keys: [] as string[],
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("../../src/components/use-annotation-session", () => ({
	useAnnotationSession: () => ({
		document: {
			image: {
				id: "image",
				width: 1000,
				height: 800,
				imageHash: "hash",
				normalizationVersion: 1,
			},
		},
		items: fixture.items,
		heads: fixture.items,
		selected: fixture.selected,
		loading: false,
		dirty: false,
		saving: false,
		blocked: false,
		conflict: false,
		status: "已保存",
		error: "",
	}),
}));
vi.mock("../../src/components/engineering-fields", () => ({
	EngineeringFields: ({ item }: { item: Annotation }) =>
		createElement("fieldset", null, item.metadata.name),
}));
vi.mock("../../src/components/annotation-collaboration", () => ({
	AnnotationCollaboration: ({ annotationId }: { annotationId: string }) =>
		createElement("section", null, annotationId),
}));
vi.mock("../../src/components/workspace-side-content", () => ({
	WorkspaceSideContent: ({ children }: { children: ReactNode }) => {
		if (
			isValidElement<{ children: ReactNode }>(children) &&
			children.type === "aside"
		)
			fixture.keys = Children.toArray(children.props.children)
				.filter(isValidElement)
				.map((child) => String(child.key));
		return children;
	},
}));
import { AnnotationEditor } from "../../src/components/annotation-editor";

describe("annotation panel identity", () => {
	it("keeps property and collaboration siblings distinct when switching line → ellipse → line", () => {
		const shared = {
			metadata: emptyMetadata(),
			revision: 1,
			deleted: false,
			createdAt: "now",
			updatedAt: "now",
			schemaVersion: 1 as const,
		};
		fixture.items = [
			{
				...shared,
				id: "line-id",
				metadata: { ...emptyMetadata(), name: "线段一" },
				geometry: {
					type: "line",
					from: { x: 0.1, y: 0.1 },
					to: { x: 0.8, y: 0.1 },
				},
			},
			{
				...shared,
				id: "ellipse-id",
				metadata: { ...emptyMetadata(), name: "椭圆四" },
				geometry: {
					type: "ellipse",
					center: { x: 0.5, y: 0.5 },
					axisA: { x: 0.7, y: 0.5 },
					axisB: { x: 0.5, y: 0.6 },
				},
			},
		];
		const keysBySelection = new Map<string, string[]>();
		for (const index of [0, 1, 0]) {
			const item = fixture.items[index] as Annotation;
			fixture.selected = item.id;
			const html = renderToStaticMarkup(
				createElement(AnnotationEditor, {
					base: "/api/projects/sample",
					fileId: "image",
					guest: false,
					propertiesOnly: true,
					onInvalid: () => {},
					onDirty: () => {},
					onIssueCreated: () => {},
					onOpenIssue: () => {},
				}),
			);
			expect(new Set(fixture.keys).size).toBe(fixture.keys.length);
			const currentKeys = fixture.keys.filter((key) => key.includes(item.id));
			expect(currentKeys).toHaveLength(2);
			const previous = keysBySelection.get(item.id);
			if (previous) expect(currentKeys).toEqual(previous);
			keysBySelection.set(item.id, currentKeys);
			const form = html.match(/<fieldset[^>]*>(.*?)<\/fieldset>/s)?.[1];
			expect(form).toBe(item.metadata.name);
		}
		expect(
			keysBySelection
				.get("line-id")
				?.some((key) => keysBySelection.get("ellipse-id")?.includes(key)),
		).toBe(false);
	});
});
