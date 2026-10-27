"use client";
import { useLayoutEffect } from "react";
import { retainHistoryPositions } from "./history-position";

export function ApplicationHistory() {
	useLayoutEffect(() => retainHistoryPositions(window), []);
	return null;
}
