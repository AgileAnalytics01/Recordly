import { beforeEach, describe, expect, it } from "vitest";
import {
	armRecordingAppend,
	disarmRecordingAppend,
	noteFinishedRecording,
	takeRecordingAppendTarget,
} from "./recordingAppendTarget";

describe("record and add to project", () => {
	beforeEach(() => disarmRecordingAppend());

	it("hands the finished recording to the armed project exactly once", () => {
		expect(armRecordingAppend("/projects/demo.recordly")).toBe(true);
		expect(takeRecordingAppendTarget()).toBeNull();
		noteFinishedRecording("/recordings/take-2.mp4");
		expect(takeRecordingAppendTarget()).toEqual({
			projectPath: "/projects/demo.recordly",
			recordingPath: "/recordings/take-2.mp4",
		});
		expect(takeRecordingAppendTarget()).toBeNull();
	});

	it("ignores recordings when nothing is armed", () => {
		noteFinishedRecording("/recordings/take.mp4");
		expect(takeRecordingAppendTarget()).toBeNull();
	});

	it("refuses to arm without a saved project", () => {
		expect(armRecordingAppend(null)).toBe(false);
		noteFinishedRecording("/recordings/take.mp4");
		expect(takeRecordingAppendTarget()).toBeNull();
	});

	it("is cleared when the user leaves for Projects or records a new project", () => {
		armRecordingAppend("/projects/demo.recordly");
		disarmRecordingAppend();
		noteFinishedRecording("/recordings/take.mp4");
		expect(takeRecordingAppendTarget()).toBeNull();
	});
});
