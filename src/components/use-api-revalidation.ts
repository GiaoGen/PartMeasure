"use client";
import { useEffect, useRef } from "react";
import { onApiRevalidate } from "./api";

/** One window listener; only currently mounted readers revalidate on return. */
export function useApiRevalidation(listener: () => void) {
	const current = useRef(listener);
	current.current = listener;
	useEffect(() => onApiRevalidate(() => current.current()), []);
}
