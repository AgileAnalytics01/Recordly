import fs from "node:fs/promises";
import { BrowserWindow, globalShortcut } from "electron";
import {
	DEFAULT_PAUSE_RECORDING_SHORTCUT,
	type GlobalShortcutBinding,
	globalShortcutsEqual,
	normalizeGlobalShortcut,
	type RecordingShortcuts,
	toAccelerator,
	validateGlobalShortcut,
	ZOOM_MARKER_SHORTCUT,
} from "../../../src/lib/globalShortcut";
import { RECORDING_SHORTCUTS_FILE } from "../constants";

/** Global hotkey that toggles pause/resume while a recording is active. */
export const TOGGLE_PAUSE_RECORDING_CHANNEL = "toggle-pause-recording-from-shortcut";
export const RECORDING_SHORTCUTS_CHANGED_CHANNEL = "recording-shortcuts-changed";

let shortcuts: RecordingShortcuts = { pauseRecording: DEFAULT_PAUSE_RECORDING_SHORTCUT };
let active = false;
let registeredAccelerator: string | null = null;
let lastToggleAt = Number.NEGATIVE_INFINITY;

function broadcast(channel: string, payload?: unknown) {
	// Capture belongs to the HUD, which can outlive the current main/editor window.
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
			win.webContents.send(channel, payload);
		}
	}
}

function onShortcut() {
	// Ignore key repeat / double taps while the native pause round-trip is in flight.
	const now = Date.now();
	if (now - lastToggleAt < 400) return;
	lastToggleAt = now;
	broadcast(TOGGLE_PAUSE_RECORDING_CHANNEL);
}

function unregister() {
	if (registeredAccelerator) globalShortcut.unregister(registeredAccelerator);
	registeredAccelerator = null;
}

function register(binding: GlobalShortcutBinding | null) {
	unregister();
	if (!binding) return true;
	const accelerator = toAccelerator(binding);
	try {
		if (!globalShortcut.register(accelerator, onShortcut)) {
			console.warn(`Could not register recording pause shortcut ${accelerator}.`);
			return false;
		}
		registeredAccelerator = accelerator;
		return true;
	} catch (error) {
		console.warn(`Could not register recording pause shortcut ${accelerator}:`, error);
		return false;
	}
}

export function setRecordingPauseShortcutActive(next: boolean) {
	if (next === active) return;
	active = next;
	lastToggleAt = Number.NEGATIVE_INFINITY;
	if (next) register(shortcuts.pauseRecording);
	else unregister();
}

export function getRecordingShortcuts(): RecordingShortcuts {
	return shortcuts;
}

function parseStored(value: unknown): RecordingShortcuts {
	if (!value || typeof value !== "object" || !("pauseRecording" in value))
		return { pauseRecording: DEFAULT_PAUSE_RECORDING_SHORTCUT };
	const stored = (value as { pauseRecording: unknown }).pauseRecording;
	if (stored === null) return { pauseRecording: null };
	if (validateGlobalShortcut(stored)) return { pauseRecording: DEFAULT_PAUSE_RECORDING_SHORTCUT };
	return { pauseRecording: normalizeGlobalShortcut(stored as GlobalShortcutBinding) };
}

export async function loadRecordingShortcuts() {
	try {
		const raw = await fs.readFile(RECORDING_SHORTCUTS_FILE, "utf-8");
		shortcuts = parseStored(JSON.parse(raw.replace(/^﻿/, "")));
	} catch {
		shortcuts = { pauseRecording: DEFAULT_PAUSE_RECORDING_SHORTCUT };
	}
	if (active) register(shortcuts.pauseRecording);
	return shortcuts;
}

/**
 * Changes the pause shortcut. `null` turns it off. The new key combination is
 * checked against the OS: if another app already owns it, nothing changes.
 */
export async function setRecordingPauseShortcut(
	binding: unknown,
): Promise<{ success: true; shortcuts: RecordingShortcuts } | { success: false; error: string }> {
	let next: GlobalShortcutBinding | null = null;
	if (binding !== null) {
		const invalid = validateGlobalShortcut(binding);
		if (invalid) return { success: false, error: invalid };
		next = normalizeGlobalShortcut(binding as GlobalShortcutBinding);
		if (globalShortcutsEqual(next, ZOOM_MARKER_SHORTCUT))
			return { success: false, error: "That shortcut is already used for zoom markers." };
	}

	const previous = shortcuts.pauseRecording;
	const unchanged =
		previous === next || (previous && next && globalShortcutsEqual(previous, next));
	if (!unchanged && next) {
		// Probe the combination so a shortcut owned by another app is rejected now,
		// instead of silently failing at the start of the next recording.
		const accelerator = toAccelerator(next);
		if (active) {
			if (!register(next)) {
				register(previous);
				return { success: false, error: "Another app is already using that shortcut." };
			}
		} else {
			let available = false;
			try {
				available = globalShortcut.register(accelerator, () => undefined);
			} finally {
				if (available) globalShortcut.unregister(accelerator);
			}
			if (!available)
				return { success: false, error: "Another app is already using that shortcut." };
		}
	} else if (!next && active) {
		unregister();
	}

	shortcuts = { pauseRecording: next };
	try {
		await fs.writeFile(RECORDING_SHORTCUTS_FILE, JSON.stringify(shortcuts, null, 2), "utf-8");
	} catch (error) {
		console.error("Failed to save recording shortcuts:", error);
		return { success: false, error: String(error) };
	}
	broadcast(RECORDING_SHORTCUTS_CHANGED_CHANNEL, shortcuts);
	return { success: true, shortcuts };
}
