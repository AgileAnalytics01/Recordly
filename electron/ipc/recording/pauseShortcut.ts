import { BrowserWindow, globalShortcut } from "electron";

/** Global hotkey that toggles pause/resume while a recording is active. */
export const RECORDING_PAUSE_SHORTCUT = "CommandOrControl+Alt+P";
export const TOGGLE_PAUSE_RECORDING_CHANNEL = "toggle-pause-recording-from-shortcut";

let registered = false;
let lastToggleAt = Number.NEGATIVE_INFINITY;

function broadcastTogglePause() {
	// Capture belongs to the HUD, which can outlive the current main/editor window.
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
			win.webContents.send(TOGGLE_PAUSE_RECORDING_CHANNEL);
		}
	}
}

export function setRecordingPauseShortcutActive(active: boolean) {
	if (active === registered) return;
	if (!active) {
		globalShortcut.unregister(RECORDING_PAUSE_SHORTCUT);
		registered = false;
		lastToggleAt = Number.NEGATIVE_INFINITY;
		return;
	}

	try {
		registered = globalShortcut.register(RECORDING_PAUSE_SHORTCUT, () => {
			// Ignore key repeat / double taps while the native pause round-trip is in flight.
			const now = Date.now();
			if (now - lastToggleAt < 400) return;
			lastToggleAt = now;
			broadcastTogglePause();
		});
		if (!registered)
			console.warn(
				`Could not register recording pause shortcut ${RECORDING_PAUSE_SHORTCUT}.`,
			);
	} catch (error) {
		console.warn(
			`Could not register recording pause shortcut ${RECORDING_PAUSE_SHORTCUT}:`,
			error,
		);
	}
}
