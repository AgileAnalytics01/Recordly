import { Tooltip } from "@heroui/react";
import { useEffect, useState } from "react";
import { MicrophoneIcon, MicrophoneSlashIcon } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import { useAudioLevelMeter } from "@/hooks/useAudioLevelMeter";
import styles from "./LaunchWindow.module.css";

/** Level (0-100) below which the mic counts as silent. */
const SILENT_LEVEL = 3;
/** How long the mic has to stay silent before the HUD warns. */
const SILENT_WARNING_MS = 4000;
const BAR_THRESHOLDS = [3, 12, 25, 40, 60];

interface RecordingMicLevelProps {
	deviceId?: string;
	paused: boolean;
}

/**
 * Live microphone level shown in the recording HUD, so it is obvious while
 * recording whether the mic is picking anything up.
 */
export function RecordingMicLevel({ deviceId, paused }: RecordingMicLevelProps) {
	const t = useScopedT("capture");
	const { level, status } = useAudioLevelMeter({
		enabled: !paused,
		deviceId: deviceId && deviceId !== "default" ? deviceId : undefined,
		smoothingFactor: 0.5,
	});
	const [silentSince, setSilentSince] = useState<number | null>(null);
	const [warning, setWarning] = useState(false);

	const isSilent = status === "monitoring" && level < SILENT_LEVEL;
	useEffect(() => {
		if (!isSilent) {
			setSilentSince(null);
			setWarning(false);
			return;
		}
		setSilentSince((current) => current ?? Date.now());
	}, [isSilent]);

	useEffect(() => {
		if (silentSince === null) return;
		const timer = window.setTimeout(
			() => setWarning(true),
			Math.max(0, SILENT_WARNING_MS - (Date.now() - silentSince)),
		);
		return () => window.clearTimeout(timer);
	}, [silentSince]);

	const unavailable = status === "unavailable";
	const alert = !paused && (warning || unavailable);
	const label = alert ? t("micNoSignal") : t("microphoneLevel");

	return (
		<Tooltip>
			<Tooltip.Trigger>
				<div
					role="meter"
					aria-label={label}
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round(paused ? 0 : level)}
					data-alert={alert || undefined}
					className={styles.recordingMicLevel}
				>
					{alert ? (
						<MicrophoneSlashIcon weight="fill" className="size-4" aria-hidden="true" />
					) : (
						<MicrophoneIcon weight="fill" className="size-4" aria-hidden="true" />
					)}
					<span aria-hidden="true" className={styles.recordingMicBars}>
						{BAR_THRESHOLDS.map((threshold) => (
							<span
								key={threshold}
								data-active={(!paused && level >= threshold) || undefined}
							/>
						))}
					</span>
				</div>
			</Tooltip.Trigger>
			<Tooltip.Content>{label}</Tooltip.Content>
		</Tooltip>
	);
}
