"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
	parseProjectList,
	projectListHref,
	rememberProjectListScroll,
	type ProjectListState,
} from "./project-list-navigation";

export function useProjectListNavigation(initial: ProjectListState) {
	const searchParams = useSearchParams();
	const locationKey = searchParams?.toString() ?? "";
	const [filters, setFilters] = useState(initial);
	const [query, setQuery] = useState(initial.q);
	const current = useRef(filters);
	current.current = filters;
	const restore = useRef(true);
	const change = useCallback(
		(next: ProjectListState, mode: "push" | "replace" = "push") => {
			const href = projectListHref(next);
			if (`${window.location.pathname}${window.location.search}` !== href) {
				if (mode === "push") {
					rememberProjectListScroll();
					window.history.pushState(null, "", href);
				} else window.history.replaceState(window.history.state, "", href);
			}
			current.current = next;
			setFilters(next);
			setQuery(next.q);
		},
		[],
	);
	useEffect(() => {
		function back() {
			const next = parseProjectList(
				new URLSearchParams(window.location.search),
			);
			current.current = next;
			restore.current = true;
			setFilters(next);
			setQuery(next.q);
		}
		// Native history may restore an RSC entry with older initial props.
		const actual = parseProjectList(
			new URLSearchParams(locationKey),
		);
		if (projectListHref(actual) !== projectListHref(current.current)) back();
		window.addEventListener("popstate", back);
		return () => window.removeEventListener("popstate", back);
	}, [locationKey]);
	useEffect(() => {
		if (query.trim() === filters.q) return;
		const timer = setTimeout(
			() => change({ ...current.current, q: query.trim() }, "replace"),
			250,
		);
		return () => clearTimeout(timer);
	}, [query, filters.q, change]);
	const restoreScroll = useCallback((displayed: ProjectListState) => {
		if (!restore.current) return;
		if (
			projectListHref(displayed) !==
			projectListHref(
				parseProjectList(new URLSearchParams(window.location.search)),
			)
		)
			return;
		restore.current = false;
		const value: unknown = window.history.state?.pmListScroll;
		if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
			const frame = requestAnimationFrame(() =>
				window.scrollTo({ top: value, behavior: "instant" }),
			);
			return () => cancelAnimationFrame(frame);
		}
	}, []);
	return { filters, query, setQuery, change, restoreScroll };
}
