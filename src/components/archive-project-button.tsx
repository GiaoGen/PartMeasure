"use client";
import { useRef, useState } from "react";
import type { ProjectView } from "./projects";
import { api, ApiError } from "./api";
import { useProductConfirm } from "./product-confirm";
export function ArchiveProjectButton({
	project,
	onSaved,
	beforeChange,
}: {
	project: ProjectView;
	onSaved: (project: ProjectView) => void;
	beforeChange?: () => boolean | Promise<boolean>;
}) {
	const [busy, setBusy] = useState(false);
	const confirm = useProductConfirm();
	const [error, setError] = useState("");
	const running = useRef(false);
	const pending = useRef<{
		archived: boolean;
		revision: number;
		key: string;
	} | null>(null);
	async function change() {
		if (running.current) return;
		if (!pending.current && (await beforeChange?.()) === false) return;
		const archived = !project.archivedAt;
		if (
			!pending.current &&
			archived &&
			!(await confirm({
				title: `归档“${project.name}”？`,
				description:
					"归档后双方只能查看和下载，编辑及未完成上传将暂停；有效分享仍可只读访问。工程师可以恢复项目。",
				confirmLabel: "确认归档",
				danger: true,
			}))
		)
			return;
		const operation = pending.current ?? {
			archived,
			revision: project.revision,
			key: crypto.randomUUID(),
		};
		pending.current = operation;
		running.current = true;
		setBusy(true);
		setError("");
		try {
			const result = await api<ProjectView>(
				`/api/projects/${project.id}/archive`,
				"POST",
				{ archived: operation.archived },
				{ key: operation.key, revision: operation.revision },
			);
			pending.current = null;
			onSaved({ ...project, ...result });
		} catch (e) {
			if (e instanceof ApiError && e.status < 500) pending.current = null;
			setError(e instanceof Error ? e.message : "操作未完成，请重试。");
		} finally {
			running.current = false;
			setBusy(false);
		}
	}
	return (
		<>
			<button
				type="button"
				aria-label={`${project.archivedAt ? "恢复项目" : "归档项目"} ${project.name}`}
				disabled={busy}
				onClick={() => void change()}
			>
				{busy
					? "处理中…"
					: error && pending.current
						? "重试上次操作"
						: project.archivedAt
							? "恢复项目"
							: "归档项目"}
			</button>
			{error ? (
				<p className="error" role="alert">
					{error}
				</p>
			) : null}
		</>
	);
}
