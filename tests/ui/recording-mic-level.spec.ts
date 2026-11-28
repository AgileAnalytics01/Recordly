import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test.use({
	launchOptions: {
		args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
	},
});

async function startRecordingWithMic(page: Page) {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.getRecordingPreferences = async () => ({
			success: true,
			microphoneEnabled: true,
			webcamEnabled: false,
			systemAudioEnabled: true,
		});
		window.electronAPI.getMediaPermissionStatus = async () => ({
			success: true,
			microphone: "granted",
			camera: "granted",
		});
		window.electronAPI.onRecordingStateChanged = (callback) => {
			const listener = () => callback({ recording: true, sourceName: "Built-in Display" });
			window.addEventListener("test-recording-started", listener);
			return () => window.removeEventListener("test-recording-started", listener);
		};
	});
	await page.goto("/?windowType=hud-overlay");
	await expect(page.getByRole("group", { name: "Recording setup", exact: true })).toBeVisible();
	await page.evaluate(() => window.dispatchEvent(new Event("test-recording-started")));
	const controls = page.getByRole("group", { name: "Recording controls" });
	await expect(controls).toBeVisible();
	return controls;
}

test("recording HUD shows live microphone level", async ({ page }) => {
	const controls = await startRecordingWithMic(page);
	const meter = controls.getByRole("meter", { name: "Microphone level" });
	await expect(meter).toBeVisible();
	await expect
		.poll(async () => Number(await meter.getAttribute("aria-valuenow")), { timeout: 10000 })
		.toBeGreaterThan(5);
	await page
		.locator('[data-recording-state="recording"]')
		.screenshot({ path: "test-results/hud-recording-mic-level.png" });
});

test("recording HUD warns when the microphone stays silent", async ({ page }) => {
	await page.addInitScript(() => {
		navigator.mediaDevices.getUserMedia = async () => {
			const context = new AudioContext();
			const destination = context.createMediaStreamDestination();
			return destination.stream;
		};
	});
	const controls = await startRecordingWithMic(page);
	await expect(controls.getByRole("meter", { name: "No sound from the microphone" })).toBeVisible(
		{
			timeout: 10000,
		},
	);
	await page
		.locator('[data-recording-state="recording"]')
		.screenshot({ path: "test-results/hud-recording-mic-silent.png" });
});
