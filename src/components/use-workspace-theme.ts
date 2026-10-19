"use client";
import { useSyncExternalStore } from "react";
import {
	parseFolderColor,
	workspaceMark,
	workspaceThemeStyle,
} from "./projects-theme";

function subscribe(change: () => void) {
	window.addEventListener("popstate", change);
	return () => window.removeEventListener("popstate", change);
}
const snapshot = () => new URLSearchParams(window.location.search).get("theme");
const serverSnapshot = () => null;

// Cosmetic URL hint only. Never used for ownership, filtering or permissions.
function useWorkspaceColor(guest: boolean) {
	const hint = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
	return guest ? undefined : parseFolderColor(hint);
}
export function useWorkspaceTheme(guest: boolean) {
	return workspaceThemeStyle(useWorkspaceColor(guest));
}
export function useWorkspaceMark(guest: boolean) {
	return workspaceMark(useWorkspaceColor(guest));
}
