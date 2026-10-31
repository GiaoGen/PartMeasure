"use client";
import { useId, useRef } from "react";
import {
	taskToneLabel,
	type TaskCard,
	type TaskFileGroup,
} from "./task-inbox-groups";
import { WorkspaceIcon } from "./workspace-ui";

function FileRow({
	group,
	selected,
	onSelect,
	compact = false,
}: {
	group: TaskFileGroup;
	selected: string | null;
	onSelect: (card: TaskCard) => void;
	compact?: boolean;
}) {
	const lane = useRef<HTMLDivElement>(null);
	const id = useId();
	function scroll(direction: number) {
		lane.current?.scrollBy({
			left: direction * 240,
			behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
				? "auto"
				: "smooth",
		});
	}
	return (
		<section className="task-file-group" aria-label={group.label}>
			<header className="task-file-heading" hidden={compact}>
				<WorkspaceIcon kind="file" />
				<h3>{group.label}</h3>
				<div className="task-lane-arrows">
					<button
						type="button"
						aria-label={`向前浏览${group.label}的事项`}
						aria-controls={id}
						onClick={() => scroll(-1)}
					>
						‹
					</button>
					<button
						type="button"
						aria-label={`向后浏览${group.label}的事项`}
						aria-controls={id}
						onClick={() => scroll(1)}
					>
						›
					</button>
				</div>
			</header>
			<div className="task-card-lane" id={id} ref={lane}>
				{(["redo", "missing", "done"] as const).map((tone) => {
					const cards = group.cards.filter((card) => card.tone === tone);
					return cards.length ? (
						<div className="task-card-cluster" key={tone}>
							{cards.map((card) => (
								<button
									type="button"
									className="task-reminder-card"
									key={card.id}
									data-tone={tone}
									aria-label={`${card.label}，${taskToneLabel[tone]}`}
									aria-pressed={selected === card.id}
									aria-expanded={selected === card.id}
									onClick={() => onSelect(card)}
								>
									{card.label}
								</button>
							))}
						</div>
					) : null;
				})}
			</div>
		</section>
	);
}

export function TaskCardRows({
	groups,
	selected,
	onSelect,
	compact = false,
}: {
	groups: TaskFileGroup[];
	selected: string | null;
	onSelect: (card: TaskCard) => void;
	compact?: boolean;
}) {
	return (
		<>
			{groups.map((group) => (
				<FileRow
					key={group.fileId}
					group={group}
					selected={selected}
					onSelect={onSelect}
					compact={compact}
				/>
			))}
		</>
	);
}
