"use client";
import { useLayoutEffect, useRef } from "react";
import { ActionLifetime } from "./action-lifetime";

export function useActionLifetime(scope = "") {
	const owner = useRef<ActionLifetime | null>(null);
	if (!owner.current) owner.current = new ActionLifetime();
	const lifetime = owner.current;
	// End ownership during the commit, before a late promise can run against a different painted view.
	useLayoutEffect(() => {
		void scope;
		lifetime.resume();
		return () => lifetime.end();
	}, [lifetime, scope]);
	return lifetime;
}
