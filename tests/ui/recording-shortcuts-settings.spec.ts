import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("the global pause shortcut can be changed, rejected, turned off and reset", async ({
	page,
}) => {
	test.setTimeout(120000);
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		let stored: unknown = { pauseRecording: { key: "p", ctrl: true, alt: true } };
		window.electronAPI.getCurrentVideoPath = async () => ({ success: false, path: null });
		window.electronAPI.getRecordingShortcuts = async () => stored as never;
		window.electronAPI.setRecordingPauseShortcut = async (binding) => {
			if (binding && binding.key === "9")
				return { success: false, error: "Another app is already using that shortcut." };
			stored = { pauseRecording: binding };
			document.documentElement.dataset.pauseShortcut = JSON.stringify(binding);
			return { success: true, shortcuts: stored as never };
		};
	});
	await page.goto("/?windowType=editor");
	const dashboard = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	await expect(dashboard).toBeVisible({ timeout: 60000 });
	await dashboard.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await dashboard.getByRole("tab", { name: "Shortcuts", exact: true }).click();
	const panel = dashboard.getByRole("tabpanel", { name: /^Shortcuts settings/ });
	const pause = panel.getByTestId("pause-shortcut-button");
	await expect(pause).toHaveText("⌘⌥P");
	await expect(panel.getByText("Mark a zoom point", { exact: true })).toBeVisible();

	await pause.click();
	await expect(pause).toHaveText("Press keys…");
	await page.keyboard.press("Shift+r");
	await expect(page.getByText(/Include Ctrl\/Cmd or Alt\/Option/).first()).toBeVisible();
	await expect(pause).toHaveText("⌘⌥P");

	await pause.click();
	await page.keyboard.press("Meta+Alt+9");
	await expect(page.getByText("Another app is already using that shortcut.")).toBeVisible();
	await expect(pause).toHaveText("⌘⌥P");

	await pause.click();
	await page.keyboard.press("Meta+Shift+KeyR");
	await expect(pause).toHaveText("⌘⇧R");
	await expect(page.locator("html")).toHaveAttribute(
		"data-pause-shortcut",
		JSON.stringify({ key: "r", ctrl: true, shift: true }),
	);
	await panel.screenshot({ path: test.info().outputPath("recording-shortcuts.png") });

	await panel.getByRole("button", { name: "Turn off", exact: true }).click();
	await expect(pause).toHaveText("Off");
	await panel.getByRole("button", { name: "Reset", exact: true }).click();
	await expect(pause).toHaveText("⌘⌥P");
	await expect(panel.getByRole("button", { name: "Reset", exact: true })).toHaveCount(0);
});
