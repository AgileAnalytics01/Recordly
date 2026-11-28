import { describe, expect, it } from "vitest";
import { findSilentRuns } from "./AudioWaveform";

describe("findSilentRuns", () => {
	it("returns runs at least as long as the minimum", () => {
		const silent = [false, true, true, true, false, true, false, true, true, true, true];
		expect(findSilentRuns(silent, 3)).toEqual([
			[1, 4],
			[7, 11],
		]);
	});

	it("ignores short gaps between words", () => {
		expect(findSilentRuns([false, true, false, true, true, false], 3)).toEqual([]);
	});

	it("treats a fully silent track as one run", () => {
		expect(findSilentRuns(new Array(10).fill(true), 2)).toEqual([[0, 10]]);
	});
});
