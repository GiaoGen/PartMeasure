"use client";

import {
	createContext,
	useContext,
	useSyncExternalStore,
	type ReactNode,
} from "react";
import {
	parseAppearance,
	readAppearance,
	subscribeAppearance,
	writeAppearance,
	type Appearance,
} from "./appearance";
import { ProductConfirmProvider } from "./product-confirm";

const serverSnapshot = (): Appearance => "system";
const AppearanceContext = createContext<Appearance>("system");

/** One theme and confirmation surface for the product, including native top-layer dialogs. */
export function ProductSurface({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) {
	const appearance = useSyncExternalStore(
		subscribeAppearance,
		readAppearance,
		serverSnapshot,
	);
	return (
		<AppearanceContext.Provider value={appearance}>
			<div className={`pm-ui ${className}`} data-appearance={appearance}>
				<ProductConfirmProvider>{children}</ProductConfirmProvider>
			</div>
		</AppearanceContext.Provider>
	);
}

export function AppearanceControl() {
	const appearance = useContext(AppearanceContext);
	return (
		<label className="pm-appearance">
			<span className="pm-sr-only">外观</span>
			<svg
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.6"
				aria-hidden="true"
			>
				<circle cx="12" cy="12" r="4" />
				<path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1" />
			</svg>
			<select
				aria-label="外观"
				value={appearance}
				onChange={(event) =>
					writeAppearance(parseAppearance(event.target.value))
				}
			>
				<option value="system">跟随系统</option>
				<option value="light">浅色模式</option>
				<option value="dark">深色模式</option>
			</select>
		</label>
	);
}
