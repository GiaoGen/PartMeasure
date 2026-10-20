const paths = {
	select: "m5 3 14 10-7 1-3 7Z",
	line: "M4 18 20 6M2 16l4 4M18 4l4 4",
	circle: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
	angle: "m4 5 1 14h15M5 13a6 6 0 0 1 6 6",
	arc: "M4 17a8 8 0 0 1 16 0M3 17h2M11 9h2M19 17h2",
	ellipse: "M20 7c2 3-1 8-6 11S4 21 3 17 5 9 10 6s9-2 10 1Z",
	point: "M12 3v5m0 8v5M3 12h5m8 0h5M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
	text: "M4 6V4h16v2M12 4v16m-4 0h8",
	pan: "M8 12V5a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v5-3a2 2 0 0 1 4 0v7c0 4-3 6-7 6-3 0-4-2-6-4l-3-4a2 2 0 0 1 3-2l1 1",
	undo: "m8 4-5 5 5 5M3 9h10a7 7 0 0 1 7 7v3",
	redo: "m16 4 5 5-5 5M21 9H11a7 7 0 0 0-7 7v3",
	save: "M4 3h13l4 4v14H3V3Zm3 0v7h10V3M7 21v-7h10v7",
	delete: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
	history: "M3 5v5h5M3 10a9 9 0 1 1 2 8M12 7v5l3 2",
	back: "m10 5-7 7 7 7M3 12h18",
	copy: "M8 8h13v13H8ZM16 8V3H3v13h5",
	retry: "M20 4v6h-6M4 20v-6h6M19 10a7 7 0 0 0-12-5L4 8m1 6a7 7 0 0 0 12 5l3-3",
	more: "m6 9 6 6 6-6",
	zoomIn: "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6M7 10h6m-3-3v6",
	zoomOut: "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6M7 10h6",
	fit: "M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6",
	close: "m6 6 12 12M18 6 6 18",
};
export function AnnotationIcon({ kind }: { kind: keyof typeof paths }) {
	return (
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d={paths[kind]} />
		</svg>
	);
}
