import { describe, expect, it } from "vitest";
import {
	DEFAULT_PAUSE_RECORDING_SHORTCUT,
	formatGlobalShortcut,
	keyFromCode,
	toAccelerator,
	validateGlobalShortcut,
} from "./globalShortcut";

describe("global recording shortcuts", () => {
	it("keeps the original pause shortcut as the default", () => {
		expect(toAccelerator(DEFAULT_PAUSE_RECORDING_SHORTCUT)).toBe("CommandOrControl+Alt+P");
		expect(formatGlobalShortcut(DEFAULT_PAUSE_RECORDING_SHORTCUT, false)).toBe("Ctrl+Alt+P");
		expect(formatGlobalShortcut(DEFAULT_PAUSE_RECORDING_SHORTCUT, true)).toBe("⌘⌥P");
	});

	it("maps physical keys independent of keyboard layout and modifiers", () => {
		expect(keyFromCode("KeyQ")).toBe("q");
		expect(keyFromCode("Digit1")).toBe("1");
		expect(keyFromCode("Numpad7")).toBe("7");
		expect(keyFromCode("F9")).toBe("f9");
		expect(keyFromCode("F25")).toBeNull();
		expect(keyFromCode("Space")).toBe("space");
		expect(keyFromCode("ArrowLeft")).toBe("left");
		expect(keyFromCode("Semicolon")).toBeNull();
	});

	it("builds Electron accelerators", () => {
		expect(toAccelerator({ key: "space", ctrl: true, shift: true })).toBe(
			"CommandOrControl+Shift+Space",
		);
		expect(toAccelerator({ key: "f8" })).toBe("F8");
		expect(toAccelerator({ key: "up", alt: true })).toBe("Alt+Up");
	});

	it("requires a modifier unless a function key is used", () => {
		expect(validateGlobalShortcut({ key: "p" })).toMatch(/Ctrl\/Cmd or Alt/);
		expect(validateGlobalShortcut({ key: "p", shift: true })).toMatch(/Ctrl\/Cmd or Alt/);
		expect(validateGlobalShortcut({ key: "p", alt: true })).toBeNull();
		expect(validateGlobalShortcut({ key: "f10" })).toBeNull();
		expect(validateGlobalShortcut({ key: ";", ctrl: true })).not.toBeNull();
		expect(validateGlobalShortcut({ key: "p", ctrl: "yes" })).not.toBeNull();
		expect(validateGlobalShortcut(null)).not.toBeNull();
	});
});
