import type { CSSProperties } from "react";

export const folderColors = {
	blue: {
		name: "雾蓝",
		accent: "#7395c6",
		folder: "#dce6f4",
		page: "#f0f4fa",
		card: "#dee7f4",
	},
	cyan: {
		name: "天青",
		accent: "#719eac",
		folder: "#dcebf0",
		page: "#f0f7f9",
		card: "#deedf2",
	},
	green: {
		name: "松绿",
		accent: "#7a9f8c",
		folder: "#deebe3",
		page: "#f1f7f3",
		card: "#e0ece4",
	},
	purple: {
		name: "薰紫",
		accent: "#a08cb9",
		folder: "#e8e0f0",
		page: "#f6f2fa",
		card: "#eae2f2",
	},
	rose: {
		name: "玫瑰",
		accent: "#b58fa2",
		folder: "#efdfe7",
		page: "#faf2f6",
		card: "#f0e1e9",
	},
	coral: {
		name: "珊瑚",
		accent: "#b99a92",
		folder: "#efe2de",
		page: "#faf4f1",
		card: "#f1e5e0",
	},
	slate: {
		name: "冷灰",
		accent: "#8b9cac",
		folder: "#e1e7ed",
		page: "#f3f6f9",
		card: "#e4eaf1",
	},
} as const;
export type FolderColor = keyof typeof folderColors;
export function parseFolderColor(
	value: string | null,
): FolderColor | undefined {
	return value && Object.hasOwn(folderColors, value)
		? (value as FolderColor)
		: undefined;
}

export function projectWorkspaceHref(id: string, color?: FolderColor, from?: string) {
	const params = new URLSearchParams();
	if (color) params.set("theme", color);
	if (from && /^\/projects(?:\?[^#\\]*)?$/.test(from)) params.set("from", from);
	return `/projects/${encodeURIComponent(id)}${params.size ? `?${params}` : ""}`;
}

const themeInk: Record<FolderColor, string> = {
	blue: "#36567f",
	cyan: "#355d69",
	green: "#3f634f",
	purple: "#625076",
	rose: "#754c61",
	coral: "#765348",
	slate: "#475b70",
};
export function workspaceMark(color?: FolderColor) {
	return themeInk[color ?? "blue"];
}

export function workspaceThemeStyle(color?: FolderColor): CSSProperties {
	const theme = color ? folderColors[color] : defaultProjectTheme;
	return {
		"--workspace-page": theme.page,
		"--workspace-panel": theme.folder,
		"--workspace-card": theme.page,
		"--workspace-soft": theme.card,
		"--workspace-line": theme.accent,
		"--workspace-mark": workspaceMark(color),
		"--workspace-action": workspaceMark(color),
	} as CSSProperties;
}
export type Folder = {
	id: string;
	name: string;
	description: string;
	color: FolderColor;
};
export const defaultProjectTheme = {
	page: "#f7f9fc",
	card: "#eaf0f7",
	accent: "#7395c6",
	folder: "#e1e9f5",
};

export function projectThemeStyle(color?: FolderColor): CSSProperties {
	const theme = color ? folderColors[color] : defaultProjectTheme;
	return {
		"--projects-page": theme.page,
		"--projects-card": theme.card,
		"--projects-accent": theme.accent,
		"--projects-folder": theme.folder,
	} as CSSProperties;
}

export type RippleOrigin = { x: number; y: number };
export function rippleGeometry(
	width: number,
	height: number,
	origin: RippleOrigin,
) {
	const x = Math.max(0, Math.min(width, origin.x));
	const y = Math.max(0, Math.min(height, origin.y));
	const radius =
		Math.hypot(Math.max(x, width - x), Math.max(y, height - y)) + 2;
	return { x, y, radius };
}
