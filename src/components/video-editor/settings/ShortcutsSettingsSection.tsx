import { useSettingsCategoryActive } from "../SettingsSections";
import { ShortcutsConfigDialog } from "../ShortcutsConfigDialog";
import { RecordingShortcutsSettings } from "./RecordingShortcutsSettings";

export function ShortcutsSettingsSection() {
	const active = useSettingsCategoryActive("shortcuts");
	return (
		<>
			<RecordingShortcutsSettings active={active} />
			<ShortcutsConfigDialog inline active={active} />
		</>
	);
}
