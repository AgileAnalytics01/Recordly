# Fork notes: what to keep when updating from upstream

This fork tracks the upstream Recordly project (`webadderallorg/Recordly`) and
adds a few local changes on top of it. When a new upstream release lands,
rebase these changes onto upstream `main` rather than merging, so the branch
stays "upstream + our commits" and nothing else.

## Features to keep

### 1. Pause/resume recording hotkey

- A global shortcut pauses and resumes an active recording. Default is
  **Ctrl/Cmd+Alt+P**.
- It can be changed or turned off in **Settings > Shortcuts**. Bindings must
  include Ctrl/Cmd or Alt, or be a function key. A combination another app
  already owns is rejected when saved.
- The recording HUD tooltip shows the current binding.
- The hotkey is registered only while recording and released on quit
  (`setRecordingPauseShortcutActive(false)` in the `will-quit` handler in
  `electron/main.ts`).

Main files:
- `electron/ipc/recording/pauseShortcut.ts`
- `src/lib/globalShortcut.ts` (+ test)
- `src/components/video-editor/settings/RecordingShortcutsSettings.tsx`
- `src/hooks/useRecordingShortcuts.ts`
- Wiring: `electron/main.ts`, `electron/preload.ts`,
  `electron/electron-env.d.ts`, `electron/ipc/register/settings.ts`,
  `electron/ipc/recording/handlers/recordingState.ts`,
  `src/hooks/useScreenRecorder.ts`,
  `src/components/launch/RecordingControls.tsx`

### 2. Local-only mode (works without a cloud sign-in)

Builds without Supabase settings (`VITE_SUPABASE_URL` / key) can never sign
in. Upstream gates onboarding and recording on a signed-in user, so without
this the app is stuck on the sign-in screen.

- `src/components/auth/useRecordlyAuth.ts`: when `recordlyAuthConfigured` is
  false, a fixed `LOCAL_ONLY_USER` profile stands in for a user. Cloud
  sharing and billing stay off because there is no access token.
- `src/hooks/useRecorderPreferences.ts`: the sign-in gate in
  `preparePermissions` only applies when `recordlyAuthConfigured` is true.
  Keep upstream's guest check (`hasSkippedOnboardingSignIn()`) alongside it;
  both conditions must stay.
- Tests: `src/hooks/useRecorderPreferences.test.ts`

After any update, check upstream did not add a new sign-in gate elsewhere
(search for `hasRecordlySession` and `showProjectDashboard()`).

### 3. "Record & add" takes

An editor header button saves the project, opens the recorder, and appends
the new recording to the end of that project when it finishes. Leaving the
recorder for Projects cancels it. If the project can't be reopened, the
recording opens on its own.

- `electron/recordingAppendTarget.ts` (+ test): main-process state for the
  pending target
- `electron/ipc/register/project.ts`, `electron/ipc/register/sources.ts`,
  `electron/ipc/constants.ts`
- `src/components/video-editor/project/pendingRecordingAppend.ts`
- `src/components/video-editor/library/useAppendPendingRecording.ts`
- `src/components/video-editor/project/useInitialEditorSource.ts`: the append
  block runs before `operation.step("restore-project")` and calls
  `operation.finish("succeeded")` on its early return
- `src/components/video-editor/project/useProjectOpenActions.ts`:
  `openRecordingHud(appendToProject)` backs both `handleOpenRecordingHud` and
  `handleRecordAndAppend`
- `src/components/video-editor/layout/EditorHeader.tsx`, `EditorShell.tsx`
- UI tests: `tests/ui/record-and-add.spec.ts`,
  `tests/ui/recording-shortcuts-settings.spec.ts`

Upstream moved its own "Record new" button into the export menu. Only the
"Record & add" button lives in our header, so "Record new" doesn't appear
twice.

### 4. Default zoom of 1.5x

`DEFAULT_ZOOM_DEPTH` in `src/components/video-editor/types.ts` is `2` (1.5x)
instead of upstream's `3` (1.8x). This covers manual, auto, and
recording-shortcut zooms. Existing zooms keep their saved depth.

### 5. Windows recording start sync

- `electron/native/wgc-capture/src/main.cpp`: frame timestamps earlier than
  the moment capture started are moved up to that moment. Windows stamps a
  captured window's first frame with the time the window last changed, which
  can be seconds before Record was pressed. Upstream uses that stamp as the
  start of the video, so the first image is held over the gap and the mic
  audio and clicks land seconds late. Drop this once upstream clamps or
  discards stale first frames.
- `src/hooks/startNativeRecorder.ts` (+ test): native capture is paused while
  the webcam opens and resumed right before the recording UI appears.

### 6. English strings

New keys live in `src/i18n/locales/en/` (`editor.json`,
`notifications.json`, `shortcuts.json`, `ui.json`). Other locales fall back to
the English defaults written in code.

### 7. Popups in Windows window recordings

Recording a single window on Windows left out dropdown lists, context menus
and tooltips: Windows Graphics Capture records only the chosen window, and
those are separate popup windows.

- `electron/native/wgc-capture/src/wgc_session.cpp` / `.h`: while a popup of
  the recorded app is open over the window, a monitor capture runs alongside
  and the popup's area is copied from it into the window frame. The monitor
  capture stops 3 seconds after the last popup closes. Popups are visible,
  captionless, non-resizable `WS_POPUP` windows of the same process that sit
  above the window. If the monitor capture can't start, the window is still
  recorded without popups.
- `electron/native/wgc-capture/CMakeLists.txt`: links `dwmapi`.

Drop this once upstream records popups in window captures.

## How to update to a new upstream release

```bash
git remote add upstream https://github.com/webadderallorg/Recordly   # once
git fetch upstream main
git rebase upstream/main
```

Expect conflicts mainly in `electron/main.ts`, `electron/preload.ts`,
`src/hooks/useRecorderPreferences.ts`, `EditorHeader.tsx`,
`useInitialEditorSource.ts` and `useProjectOpenActions.ts`. Keep both sides:
upstream's new code, plus the pieces described above. If upstream renamed
something near our lines (it renamed `nativeExportQuitState` to
`quitCleanupState`, and wraps preload calls in `invokeWithDiagnostics`),
follow upstream's new names.

## Checks after updating

```bash
npx tsc --noEmit
npx vitest --run
```

Some tests need the bundled FFmpeg binary, so they fail when dependencies are
installed with `--ignore-scripts`. Compare against plain upstream before
treating those failures as real.

Then build Windows with the **Build Electron App** workflow
(`.github/workflows/build.yml`, manual run on this branch). Download the
`windows-x64-release` artifact and check by hand: the pause hotkey and
changing it in Settings, using the app without signing in, "Record & add",
mic audio and clicks lining up with the video in a window recording,
and new zooms starting at 1.5x.

## History note

Upstream rewrote its history in Nov 2026, so commit hashes from before then
don't match. Don't merge old branches based on pre-rewrite history; replay
(cherry-pick) the commits instead.
