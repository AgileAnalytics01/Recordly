import { Kbd } from "@heroui/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { useRecordingShortcuts } from "@/hooks/useRecordingShortcuts";
import {
	DEFAULT_PAUSE_RECORDING_SHORTCUT,
	formatGlobalShortcut,
	type GlobalShortcutBinding,
	globalShortcutsEqual,
	keyFromCode,
	validateGlobalShortcut,
	ZOOM_MARKER_SHORTCUT,
} from "@/lib/globalShortcut";

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph"]);

/** System-wide recording shortcuts, saved immediately (they're validated against the OS). */
export function RecordingShortcutsSettings({ active = true }: { active?: boolean }) {
	const t = useScopedT("shortcuts");
	const { isMac } = useShortcuts();
	const [shortcuts, setShortcuts] = useRecordingShortcuts();
	const [capturing, setCapturing] = useState(false);
	const [saving, setSaving] = useState(false);
	const pause = shortcuts.pauseRecording;
	const format = (binding: GlobalShortcutBinding) => formatGlobalShortcut(binding, isMac);

	const save = async (binding: GlobalShortcutBinding | null) => {
		const api = window.electronAPI?.setRecordingPauseShortcut;
		if (!api) return;
		setSaving(true);
		try {
			const result = await api(binding);
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			setShortcuts(result.shortcuts);
			toast.success(
				binding
					? t("recording.saved", "Pause shortcut set to {{binding}}", {
							binding: format(binding),
						})
					: t("recording.disabled", "Pause shortcut turned off"),
			);
		} catch (error) {
			toast.error(String(error));
		} finally {
			setSaving(false);
		}
	};

	useEffect(() => {
		if (!active) setCapturing(false);
	}, [active]);

	useEffect(() => {
		if (!capturing) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			event.preventDefault();
			event.stopPropagation();
			if (event.key === "Escape") {
				setCapturing(false);
				return;
			}
			if (MODIFIER_KEYS.has(event.key)) return;
			setCapturing(false);
			const key = keyFromCode(event.code);
			if (!key) {
				toast.error(
					t(
						"recording.unsupportedKey",
						"Use a letter, number, function key, Space or an arrow key.",
					),
				);
				return;
			}
			const binding: GlobalShortcutBinding = {
				key,
				...(event.ctrlKey || event.metaKey ? { ctrl: true } : {}),
				...(event.altKey ? { alt: true } : {}),
				...(event.shiftKey ? { shift: true } : {}),
			};
			const invalid = validateGlobalShortcut(binding);
			if (invalid) {
				toast.error(invalid);
				return;
			}
			void save(binding);
		};
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
	});

	return (
		<div className="space-y-0.5" data-testid="recording-shortcuts">
			<p className="mb-1 text-[13px] font-medium text-foreground">
				{t("recording.title", "Recording (works in any app)")}
			</p>
			<p className="mb-2 text-xs text-muted-foreground">
				{t(
					"recording.pauseResumeHint",
					"Works while you're in other apps. Include Ctrl/Cmd or Alt/Option, or use a function key.",
				)}
			</p>
			<div className="flex flex-wrap items-center justify-between gap-4 border-b border-separator py-3">
				<span className="text-[13px] text-foreground">
					{t("recording.pauseResume", "Pause / Resume recording")}
				</span>
				<div className="flex flex-wrap items-center gap-1.5">
					{(!pause || !globalShortcutsEqual(pause, DEFAULT_PAUSE_RECORDING_SHORTCUT)) && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={saving}
							onClick={() => void save(DEFAULT_PAUSE_RECORDING_SHORTCUT)}
						>
							{t("recording.reset", "Reset")}
						</Button>
					)}
					{pause && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={saving}
							onClick={() => void save(null)}
						>
							{t("recording.turnOff", "Turn off")}
						</Button>
					)}
					<Button
						type="button"
						variant="secondary"
						size="sm"
						disabled={saving}
						data-testid="pause-shortcut-button"
						aria-label={
							capturing
								? t("recording.pressKeys", "Press keys…")
								: t(
										"recording.change",
										"Change pause shortcut, currently {{binding}}",
										{
											binding: pause
												? format(pause)
												: t("recording.off", "Off"),
										},
									)
						}
						onClick={() => setCapturing((value) => !value)}
						className={`min-w-[90px] px-2 py-1 text-center text-xs select-none${capturing ? " animate-pulse" : ""}`}
					>
						{capturing
							? t("recording.pressKeys", "Press keys…")
							: pause
								? format(pause)
								: t("recording.off", "Off")}
					</Button>
				</div>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-4 border-b border-separator py-3">
				<span className="text-[13px] text-foreground">
					{t("recording.zoomMarker", "Mark a zoom point")}
				</span>
				<Kbd className="min-w-[90px] justify-center">{format(ZOOM_MARKER_SHORTCUT)}</Kbd>
			</div>
		</div>
	);
}
