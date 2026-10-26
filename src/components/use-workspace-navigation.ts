"use client";
import { useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
	WorkspaceHistory,
	type WorkspaceHistoryCallbacks,
} from "./workspace-history";
import type { WorkspaceView } from "./workspace-navigation";

export function useWorkspaceNavigation({
	scope,
	guest,
	canLeave,
	restore,
	travel,
}: WorkspaceHistoryCallbacks & { scope: string; guest: boolean }) {
	const search = useSearchParams()?.toString() ?? "";
	const callbacks = useRef<WorkspaceHistoryCallbacks>({ canLeave, restore });
	callbacks.current = { canLeave, restore, ...(travel ? { travel } : {}) };
	const history = useRef<WorkspaceHistory | null>(null);
	useEffect(() => {
		const controller = new WorkspaceHistory(
			window,
			scope,
			guest,
			() => callbacks.current,
		);
		history.current = controller;
		return () => {
			controller.dispose();
			if (history.current === controller) history.current = null;
		};
	}, [scope, guest]);
	useEffect(() => {
		history.current?.sync(search);
	}, [search]);
	const write = useCallback((view: WorkspaceView, replace = false) => {
		history.current?.write(view, replace);
	}, []);
	return { write };
}
