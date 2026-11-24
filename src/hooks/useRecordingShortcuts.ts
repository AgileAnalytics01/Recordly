import { useEffect, useState } from "react";
import { DEFAULT_PAUSE_RECORDING_SHORTCUT, type RecordingShortcuts } from "@/lib/globalShortcut";

const DEFAULTS: RecordingShortcuts = { pauseRecording: DEFAULT_PAUSE_RECORDING_SHORTCUT };

/** The user's global recording shortcuts, kept in sync across windows. */
export function useRecordingShortcuts() {
	const [shortcuts, setShortcuts] = useState<RecordingShortcuts>(DEFAULTS);
	useEffect(() => {
		let active = true;
		void window.electronAPI
			?.getRecordingShortcuts?.()
			.then((value) => {
				if (active && value) setShortcuts(value);
			})
			.catch(() => undefined);
		const unsubscribe = window.electronAPI?.onRecordingShortcutsChanged?.((value) => {
			if (value) setShortcuts(value);
		});
		return () => {
			active = false;
			unsubscribe?.();
		};
	}, []);
	return [shortcuts, setShortcuts] as const;
}
