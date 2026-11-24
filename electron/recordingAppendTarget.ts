/**
 * "Record and add to this project": the editor arms a target project before it
 * opens the recording HUD. When that recording is finalized, the reloaded editor
 * takes the target, reopens the project and appends the new recording as a clip.
 *
 * The project path always comes from the main process (the project the editor
 * just saved), never from the renderer.
 */
export type RecordingAppendTarget = { projectPath: string; recordingPath: string };

let armedProjectPath: string | null = null;
let recordingPath: string | null = null;

export function armRecordingAppend(projectPath: string | null) {
	armedProjectPath = projectPath;
	recordingPath = null;
	return Boolean(projectPath);
}

export function disarmRecordingAppend() {
	armedProjectPath = null;
	recordingPath = null;
}

export function isRecordingAppendArmed() {
	return armedProjectPath !== null;
}

/** Called whenever a freshly finished recording becomes the current video. */
export function noteFinishedRecording(path: string | null | undefined) {
	if (armedProjectPath && path) recordingPath = path;
}

/** Returns the target once a recording has finished, and clears it. */
export function takeRecordingAppendTarget(): RecordingAppendTarget | null {
	if (!armedProjectPath || !recordingPath) return null;
	const target = { projectPath: armedProjectPath, recordingPath };
	disarmRecordingAppend();
	return target;
}
