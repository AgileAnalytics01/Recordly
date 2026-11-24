import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("Record & add arms the saved project and appends the finished take to it", async ({
	page,
}) => {
	test.setTimeout(120000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(`${error.message}\n${error.stack}`));
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const video = `${location.origin}/tests/ui/fixtures/filmstrip.mp4`;
		const project = {
			version: 2,
			videoPath: video,
			editor: {
				clipRegions: [
					{ id: "clip-1", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 },
				],
			},
		};
		const appending = sessionStorage.getItem("append") === "1";
		window.electronAPI.loadCurrentProjectFile = async () =>
			appending
				? { success: false, message: "No active project" }
				: { success: true, path: "/projects/demo.recordly", project };
		window.electronAPI.takeRecordingAppendTarget = async () =>
			appending
				? {
						projectPath: "/projects/demo.recordly",
						recordingPath: "/recordings/take-2.mp4",
					}
				: null;
		window.electronAPI.openProjectFileAtPath = async (path) => {
			document.documentElement.dataset.reopened = path;
			return { success: true, path, project };
		};
		window.electronAPI.setRecordingAppendTarget = async (enabled) => {
			document.documentElement.dataset.armed = String(enabled);
			return { success: true };
		};
		window.electronAPI.showRecordingHud = async () => {
			document.documentElement.dataset.hudShown = "true";
		};
		window.electronAPI.importRecording = async (_current, path) => {
			document.documentElement.dataset.importedPath = path;
			return {
				success: true,
				value: {
					path: video,
					url: video,
					sourceStartMs: 6000,
					durationMs: 2000,
					totalDurationMs: 8000,
				},
			};
		};
	});

	await page.goto("/?windowType=editor");
	const clip = page.locator('[data-variant="clip"]');
	await expect(clip).toHaveAttribute("data-end-ms", "6000", { timeout: 60000 });

	// "Record new" starts a separate project, so it disarms any pending append.
	await page.getByRole("button", { name: "Record new", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-armed", "false");

	await page.getByTestId("record-and-add").click();
	await expect(page.locator("html")).toHaveAttribute("data-armed", "true");
	await expect(page.locator("html")).toHaveAttribute("data-hud-shown", "true");

	// The recording finishes and main reloads the editor.
	await page.evaluate(() => sessionStorage.setItem("append", "1"));
	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("data-reopened", "/projects/demo.recordly", {
		timeout: 60000,
	});
	await expect(page.locator("html")).toHaveAttribute(
		"data-imported-path",
		"/recordings/take-2.mp4",
		{ timeout: 30000 },
	);
	await expect(clip).toHaveCount(2);
	await expect(clip.last()).toHaveAttribute("data-start-ms", "6000");
	await expect(clip.last()).toHaveAttribute("data-end-ms", "8000");
	await page.screenshot({ path: test.info().outputPath("record-and-add.png") });
	expect(errors).toEqual([]);
});
