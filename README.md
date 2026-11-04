# ios-sim-check

Opens public web pages in Mobile Safari on an iOS Simulator (GitHub-hosted macOS runner) and saves screenshots.
Nothing private lives here: no app code, no keys. It only visits URLs given at run time.

    gh workflow run ios-sim.yml -R SRHSoulja/ios-sim-check -f urls="https://straycucks.com/arplay/?id=190" -f wait=20
    gh run list -R SRHSoulja/ios-sim-check -w ios-sim -L 1
    gh run download <run-id> -R SRHSoulja/ios-sim-check -n ios-shots -D ./ios-shots

Each URL gets two screenshots (after `wait` s and 3 s later). The simulator is real Mobile Safari (WebKit on iOS);
it has no camera, so AR Quick Look placement cannot be tested, but pages, layout, Quick Look's object view and
JavaScript behaviour can. Canonical copy: gmgn-brain work/drafts/stray-cucks/ios-sim-check (private).

## jsc-check.yml (2026-11-03)
Parses a page's inline scripts (and .js/.mjs URLs) with Safari's own engine, JavaScriptCore (`jsc` on the macOS runner), parse only. Catches the error behind a blank page in one minute:
`gh workflow run jsc-check.yml -R SRHSoulja/ios-sim-check -f urls="https://example.com/page/"`, then read the run log (PARSE OK / PARSE ERROR with line).
Found the /city/ restartShift SyntaxError on 2026-11-03.

## android-emu.yml (2026-11-04)
The Android twin of ios-sim: Chrome on an Android emulator (ubuntu runner with KVM, reactivecircus/android-emulator-runner v2.38.0,
API 34 `google_apis` x86_64 image, which ships Chrome; the script fails loudly if it does not). Default profile `pixel_7` = 1080x2400, 412 dp wide.
Each URL is opened with an `am start VIEW` intent, then `scripts/cdp-capture.mjs` attaches over Chrome DevTools
(`adb forward tcp:9222 localabstract:chrome_devtools_remote`), reloads the tab and records console errors/warnings, uncaught exceptions,
browser log entries and failed/4xx/5xx requests, plus viewport, UA, title, WebGL renderer and the first 300 chars of page text, into `NN.json`.
Screenshots `NN.png` (after `wait` s) and `NN-b.png` (3 s later), plus `index.txt`. Artifact: `android-shots`.

    gh workflow run android-emu.yml -R SRHSoulja/ios-sim-check -f urls="https://example.com/a https://example.com/b" -f wait=20
    gh run download <run-id> -R SRHSoulja/ios-sim-check -n android-shots -D ./android-shots

The emulator renders WebGL in software (swiftshader), so judge layout, errors and logic here, not GPU look.
