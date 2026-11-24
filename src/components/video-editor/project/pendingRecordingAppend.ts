import { useSyncExternalStore } from "react";

/** A finished recording waiting to be appended to the project it was recorded for. */
export type PendingRecordingAppend = { projectPath: string; recordingPath: string };

let pending: PendingRecordingAppend | null = null;
const listeners = new Set<() => void>();

export function setPendingRecordingAppend(next: PendingRecordingAppend | null) {
	pending = next;
	for (const listener of listeners) listener();
}

export function usePendingRecordingAppend() {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => pending,
	);
}
