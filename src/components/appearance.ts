export const appearanceKey = "pm:appearance:v1";
export type Appearance = "system" | "light" | "dark";
export function parseAppearance(value: string | null): Appearance {
	return value === "light" || value === "dark" ? value : "system";
}

const changed = "pm:appearance-changed";
let memoryAppearance: Appearance = "system";
let storageUnavailable = false;
export function readAppearance(): Appearance {
	if (storageUnavailable) return memoryAppearance;
	try {
		return parseAppearance(window.localStorage.getItem(appearanceKey));
	} catch {
		return memoryAppearance;
	}
}
export function subscribeAppearance(change: () => void) {
	const storage = (event: StorageEvent) => {
		if (event.key === appearanceKey || event.key === null) {
			storageUnavailable = false;
			memoryAppearance = parseAppearance(event.newValue);
			change();
		}
	};
	window.addEventListener(changed, change);
	window.addEventListener("storage", storage);
	return () => {
		window.removeEventListener(changed, change);
		window.removeEventListener("storage", storage);
	};
}
export function writeAppearance(value: Appearance) {
	memoryAppearance = value;
	try {
		window.localStorage.setItem(appearanceKey, value);
		storageUnavailable = false;
	} catch {
		storageUnavailable = true;
	}
	window.dispatchEvent(new Event(changed));
}
