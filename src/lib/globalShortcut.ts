/**
 * System-wide (global) recording shortcuts. Unlike editor shortcuts these fire
 * while other apps are focused, so they must include a modifier (or be a function
 * key) to avoid swallowing ordinary typing.
 */
export interface GlobalShortcutBinding {
	/** Normalized key: "a".."z", "0".."9", "f1".."f24", "space", "up", "down", "left", "right". */
	key: string;
	/** Cmd on macOS, Ctrl on Windows/Linux. */
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
}

export type RecordingShortcuts = {
	/** null when the user turned the shortcut off. */
	pauseRecording: GlobalShortcutBinding | null;
};

export const DEFAULT_PAUSE_RECORDING_SHORTCUT: GlobalShortcutBinding = {
	key: "p",
	ctrl: true,
	alt: true,
};

/** Fixed global shortcut used for recording zoom markers. */
export const ZOOM_MARKER_SHORTCUT: GlobalShortcutBinding = { key: "z", ctrl: true, alt: true };

const NAMED_KEYS: Record<string, string> = {
	space: "Space",
	up: "Up",
	down: "Down",
	left: "Left",
	right: "Right",
};

function isFunctionKey(key: string) {
	return /^f([1-9]|1[0-9]|2[0-4])$/.test(key);
}

function isSupportedKey(key: string) {
	return /^[a-z0-9]$/.test(key) || isFunctionKey(key) || key in NAMED_KEYS;
}

/** Maps KeyboardEvent.code to a layout-independent key, or null if unsupported. */
export function keyFromCode(code: string): string | null {
	let match = /^Key([A-Z])$/.exec(code);
	if (match) return match[1].toLowerCase();
	match = /^(?:Digit|Numpad)([0-9])$/.exec(code);
	if (match) return match[1];
	match = /^F([0-9]{1,2})$/.exec(code);
	if (match && isFunctionKey(`f${match[1]}`)) return `f${match[1]}`;
	if (code === "Space") return "space";
	match = /^Arrow(Up|Down|Left|Right)$/.exec(code);
	if (match) return match[1].toLowerCase();
	return null;
}

/** Returns a reason the binding can't be used, or null if it's valid. */
export function validateGlobalShortcut(binding: unknown): string | null {
	if (!binding || typeof binding !== "object") return "Invalid shortcut.";
	const { key, ctrl, shift, alt } = binding as Record<string, unknown>;
	if (typeof key !== "string" || !isSupportedKey(key))
		return "Use a letter, number, function key, Space or an arrow key.";
	for (const flag of [ctrl, shift, alt])
		if (flag !== undefined && typeof flag !== "boolean") return "Invalid shortcut.";
	if (!isFunctionKey(key) && !ctrl && !alt)
		return "Include Ctrl/Cmd or Alt/Option so the shortcut doesn't interfere with typing.";
	return null;
}

export function normalizeGlobalShortcut(binding: GlobalShortcutBinding): GlobalShortcutBinding {
	return {
		key: binding.key,
		...(binding.ctrl ? { ctrl: true } : {}),
		...(binding.shift ? { shift: true } : {}),
		...(binding.alt ? { alt: true } : {}),
	};
}

export function globalShortcutsEqual(a: GlobalShortcutBinding, b: GlobalShortcutBinding) {
	return (
		a.key === b.key && !!a.ctrl === !!b.ctrl && !!a.shift === !!b.shift && !!a.alt === !!b.alt
	);
}

/** Electron accelerator string, e.g. "CommandOrControl+Alt+P". */
export function toAccelerator(binding: GlobalShortcutBinding): string {
	const parts: string[] = [];
	if (binding.ctrl) parts.push("CommandOrControl");
	if (binding.alt) parts.push("Alt");
	if (binding.shift) parts.push("Shift");
	parts.push(NAMED_KEYS[binding.key] ?? binding.key.toUpperCase());
	return parts.join("+");
}

export function formatGlobalShortcut(binding: GlobalShortcutBinding, isMac: boolean): string {
	const key = NAMED_KEYS[binding.key] ?? binding.key.toUpperCase();
	if (isMac)
		return `${binding.ctrl ? "⌘" : ""}${binding.alt ? "⌥" : ""}${binding.shift ? "⇧" : ""}${key}`;
	return [binding.ctrl && "Ctrl", binding.alt && "Alt", binding.shift && "Shift", key]
		.filter(Boolean)
		.join("+");
}
