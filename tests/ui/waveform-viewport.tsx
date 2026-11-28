import { TimelineContext } from "dnd-timeline";
import { createRoot } from "react-dom/client";
import AudioWaveform from "@/components/video-editor/timeline/components/waveform/AudioWaveform";
import { ThemeProvider } from "@/contexts/ThemeContext";

const durationMs = 875000;
const band = new Float32Array(2048);
band.fill(
	0.8,
	Math.floor((845000 / durationMs) * band.length),
	Math.ceil((857000 / durationMs) * band.length),
);
const impulse = new Float32Array(2048);
impulse[59] = 0.8;
// 10 s of speech with a 3 s dead stretch (4-7 s) and a short pause near 1 s.
const silenceDurationMs = 10000;
const speechWithGap = new Float32Array(1000).fill(0.8);
speechWithGap.fill(0, 400, 700);
speechWithGap.fill(0, 100, 103);

createRoot(document.getElementById("root")!).render(
	<ThemeProvider>
		<TimelineContext
			range={{ start: 830000, end: 875000 }}
			onRangeChanged={() => undefined}
			onResizeEnd={() => undefined}
		>
			<div id="panned" style={{ width: 128, height: 40 }}>
				<AudioWaveform
					peaks={{ peaks: band, durationMs }}
					segmentStartMs={0}
					segmentEndMs={durationMs}
					timelineStartMs={0}
					timelineEndMs={durationMs}
				/>
			</div>
		</TimelineContext>
		<TimelineContext
			range={{ start: 0, end: 875000 }}
			onRangeChanged={() => undefined}
			onResizeEnd={() => undefined}
		>
			<div id="zoomed" style={{ width: 32, height: 40 }}>
				<AudioWaveform
					peaks={{ peaks: impulse, durationMs }}
					segmentStartMs={0}
					segmentEndMs={durationMs}
					timelineStartMs={0}
					timelineEndMs={durationMs}
				/>
			</div>
		</TimelineContext>
		<TimelineContext
			range={{ start: 10000, end: 12500 }}
			onRangeChanged={() => undefined}
			onResizeEnd={() => undefined}
		>
			<div id="trimmed" style={{ width: 128, height: 40 }}>
				<AudioWaveform
					peaks={{ peaks: band, durationMs }}
					segmentStartMs={845000}
					segmentEndMs={865000}
					timelineStartMs={5000}
					timelineEndMs={15000}
				/>
			</div>
		</TimelineContext>
		<TimelineContext
			range={{ start: 0, end: silenceDurationMs }}
			onRangeChanged={() => undefined}
			onResizeEnd={() => undefined}
		>
			<div id="silence" style={{ width: 100, height: 40 }}>
				<AudioWaveform
					peaks={{ peaks: speechWithGap, durationMs: silenceDurationMs }}
					segmentStartMs={0}
					segmentEndMs={silenceDurationMs}
					timelineStartMs={0}
					timelineEndMs={silenceDurationMs}
					highlightSilence
				/>
			</div>
		</TimelineContext>
	</ThemeProvider>,
);
