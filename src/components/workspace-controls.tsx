"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { fileSorts, fileTypes, type FileFilters } from "@/lib/archive-filters";
import { WorkspaceIcon, useWorkspaceDisclosure } from "./workspace-ui";

/** Native disclosure semantics; buttons dismiss it while selects remain usable. */
export function WorkspaceMenu({
	label,
	kind,
	className = "",
	panelClassName = "",
	dismissCanvasPointer = false,
	disabled = false,
	children,
}: {
	label: string;
	kind: "more" | "download";
	className?: string;
	panelClassName?: string;
	dismissCanvasPointer?: boolean;
	disabled?: boolean;
	children: ReactNode;
}) {
	const ref = useRef<HTMLDetailsElement>(null);
	const menu = useWorkspaceDisclosure();
	useEffect(() => {
		if (!menu.expanded) return;
		function outside(event: Event) {
			if (
				event.target instanceof Node &&
				!ref.current?.contains(event.target)
			) {
				menu.hide();
			}
		}
		function onEscape(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			menu.hide();
			ref.current?.querySelector("summary")?.focus({ preventScroll: true });
		}
		document.addEventListener("pointerdown", outside);
		document.addEventListener("focusin", outside);
		document.addEventListener("scroll", outside, true);
		document.addEventListener("keydown", onEscape, true);
		return () => {
			document.removeEventListener("pointerdown", outside);
			document.removeEventListener("focusin", outside);
			document.removeEventListener("scroll", outside, true);
			document.removeEventListener("keydown", onEscape, true);
		};
	}, [menu.expanded, menu.hide]);
	return (
		<details
			ref={ref}
			className={`workspace-action-menu ${className}`}
			open={menu.mounted}
			data-phase={menu.phase}
			onClick={(event) => {
				if (!(event.target instanceof Element)) return;
				if (event.target.closest("summary")) {
					event.preventDefault();
					if (!disabled) {
						if (menu.expanded) menu.hide(); else menu.show();
					}
					return;
				}
				const action = event.target.closest("button,a[href]");
				if (action && !(action instanceof HTMLButtonElement && action.disabled)) {
					menu.hide();
					ref.current?.querySelector("summary")?.focus({ preventScroll: true });
				}
			}}
			onKeyDown={(event) => {
				if (event.key !== "Escape" || !menu.mounted) return;
				event.preventDefault();
				event.stopPropagation();
				menu.hide();
				event.currentTarget.querySelector("summary")?.focus();
			}}
		>
			<summary aria-label={label} aria-disabled={disabled}>
				<WorkspaceIcon kind={kind} />
				{kind === "download" ? <span>{label}</span> : null}
			</summary>
			{dismissCanvasPointer && menu.mounted ? (
				<button type="button" className="workspace-menu-dismiss"
					aria-label={`收起${label}`} tabIndex={-1} />
			) : null}
			<div className={`workspace-action-menu-items ${panelClassName}`} inert={disabled || menu.phase === "closing"}>
				{children}
			</div>
		</details>
	);
}

export function WorkspaceMaterialControls({
	filters,
	busy,
	selecting,
	onChange,
	onExport,
}: {
	filters: FileFilters;
	busy: boolean;
	selecting: boolean;
	onChange: (filters: FileFilters) => Promise<boolean>;
	onExport: (kind: "pdf" | "zip") => Promise<void>;
}) {
	const disclosure = useWorkspaceDisclosure();
	const fieldsId = useId();
	const actions = (
		<>
			<button
				type="button"
				className="workspace-secondary-action"
				disabled={busy}
				onClick={() => void onExport("pdf")}
			>
				<WorkspaceIcon kind="file" />
				PDF资料报告
			</button>
			<button
				type="button"
				className="workspace-secondary-action"
				disabled={busy}
				onClick={() => void onExport("zip")}
			>
				<WorkspaceIcon kind="package" />
				ZIP资料包
			</button>
		</>
	);
	return (
		<div className="workspace-material-controls">
			<div className="workspace-mobile-tools">
				<button
					type="button"
					className="workspace-filter-trigger"
					aria-expanded={disclosure.expanded}
					aria-controls={fieldsId}
					onClick={() => { if (disclosure.expanded) disclosure.hide(); else disclosure.show(); }}
				>
					<WorkspaceIcon kind="filters" />
					筛选与排序
					<WorkspaceIcon kind="chevron" />
				</button>
				{!selecting ? (
					<WorkspaceMenu label="导出" kind="download" disabled={busy}>
						{actions}
					</WorkspaceMenu>
				) : null}
			</div>
			<div
				className="workspace-file-filters"
				id={fieldsId}
				data-expanded={disclosure.mounted}
				data-phase={disclosure.phase}
				inert={disclosure.phase === "closing"}
			>
				<label>
					类型
					<select
						disabled={busy}
						value={filters.type}
						onChange={(event) =>
							void onChange({
								...filters,
								type: event.target.value as FileFilters["type"],
							})
						}
					>
						{Object.entries(fileTypes).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
				</label>
				<label>
					排序
					<select
						disabled={busy}
						value={filters.sort}
						onChange={(event) =>
							void onChange({
								...filters,
								sort: event.target.value as FileFilters["sort"],
							})
						}
					>
						{Object.entries(fileSorts).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
				</label>
				{!selecting ? (
					<div className="workspace-desktop-exports">{actions}</div>
				) : null}
			</div>
			<p className="workspace-filter-summary">
				{fileTypes[filters.type]} · {fileSorts[filters.sort]}
			</p>
		</div>
	);
}
