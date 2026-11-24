import { useEffect, useRef } from "react";
import {
	setPendingRecordingAppend,
	usePendingRecordingAppend,
} from "../project/pendingRecordingAppend";
import type { useProjectState } from "../state/useProjectState";
import type { useRecordingLibrary } from "./useRecordingLibrary";

/**
 * After "Record & add", the editor reopens the target project. Once that project's
 * timeline is ready, append the new recording to the end as another clip.
 */
const SETTLE_MS = 1000;

export function useAppendPendingRecording({
	project,
	library,
	ready,
}: {
	project: ReturnType<typeof useProjectState>;
	library: ReturnType<typeof useRecordingLibrary>;
	ready: boolean;
}) {
	const pending = usePendingRecordingAppend();
	const started = useRef<string | null>(null);
	const addToTimeline = useRef(library.addToTimeline);
	addToTimeline.current = library.addToTimeline;

	useEffect(() => {
		if (!pending || !ready || project.loading || library.importing) return;
		if (started.current === pending.recordingPath) return;
		if (project.currentProjectPath !== pending.projectPath) {
			// Another project was opened before the timeline became ready.
			if (project.currentProjectPath) setPendingRecordingAppend(null);
			return;
		}
		// Let the reopened project's preview finish settling before swapping its source;
		// the wait restarts if the preview stops being ready.
		const timer = setTimeout(() => {
			started.current = pending.recordingPath;
			setPendingRecordingAppend(null);
			void addToTimeline.current(pending.recordingPath);
		}, SETTLE_MS);
		return () => clearTimeout(timer);
	}, [pending, ready, project.loading, project.currentProjectPath, library.importing]);
}
