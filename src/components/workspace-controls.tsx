"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { fileSorts, fileTypes, type FileFilters } from "@/lib/archive-filters";
import { WorkspaceIcon } from "./workspace-ui";

/** Native disclosure semantics; buttons dismiss it while selects remain usable. */
export function WorkspaceMenu({
	label,
	kind,
	className = "",
	disabled = false,
	children,
}: {
	label: string;
	kind: "more" | "download";
	className?: string;
	disabled?: boolean;
	children: ReactNode;
}) {
	const ref = useRef<HTMLDetailsElement>(null);
	const [opened, setOpened] = useState(false);
	useEffect(() => {
		if (!opened) return;
		function outside(event: Event) {
			if (
				event.target instanceof Node &&
				!ref.current?.contains(event.target)
			) {
				if (ref.current) ref.current.open = false;
			}
		}
		document.addEventListener("pointerdown", outside);
		document.addEventListener("focusin", outside);
		return () => {
			document.removeEventListener("pointerdown", outside);
			document.removeEventListener("focusin", outside);
		};
	}, [opened]);
	return (
		<details
			ref={ref}
			className={`workspace-action-menu ${className}`}
			onToggle={(event) => setOpened(event.currentTarget.open)}
			onClick={(event) => {
				if (!(event.target instanceof Element)) return;
				if (disabled && event.target.closest("summary")) event.preventDefault();
				const button = event.target.closest("button");
				if (button && !button.disabled && ref.current) {
					ref.current.open = false;
					ref.current.querySelector("summary")?.focus({ preventScroll: true });
				}
			}}
			onKeyDown={(event) => {
				if (event.key !== "Escape" || !event.currentTarget.open) return;
				event.preventDefault();
				event.stopPropagation();
				event.currentTarget.open = false;
				event.currentTarget.querySelector("summary")?.focus();
			}}
		>
			<summary aria-label={label} aria-disabled={disabled}>
				<WorkspaceIcon kind={kind} />
				{kind === "download" ? <span>{label}</span> : null}
			</summary>
			<div className="workspace-action-menu-items" inert={disabled}>
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
	const [expanded, setExpanded] = useState(false);
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
					aria-expanded={expanded}
					aria-controls={fieldsId}
					onClick={() => setExpanded((value) => !value)}
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
				data-expanded={expanded}
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
