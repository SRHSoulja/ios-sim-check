#!/usr/bin/env bash
# Runs inside android-emulator-runner (emulator already booted). Env: URLS, WAIT, DEV_NAME, GPU, CHROME_FLAGS.
# URLs may include chrome://gpu (Chrome refuses it by intent; cdp-capture.mjs navigates the tab there instead).
set -uo pipefail
mkdir -p shots
case "${WAIT:-}" in ''|*[!0-9]*) WAIT=20;; esac
read -ra LIST <<< "${URLS:-}"
PKG=com.android.chrome
{ echo "device: ${DEV_NAME:-?} gpu: ${GPU:-?} chrome_flags: ${CHROME_FLAGS:-none}"; adb shell getprop ro.build.version.release; adb shell getprop ro.build.version.sdk
  adb shell wm size; adb shell wm density; adb shell dumpsys package $PKG | grep -m1 versionName; } | tee shots/index.txt
if ! adb shell pm list packages | grep -q "package:$PKG"; then echo "NO CHROME on this image" | tee -a shots/index.txt; exit 1; fi
# skip first-run / default-browser screens, enable devtools socket
adb root >/dev/null 2>&1 || true; sleep 2
case "${CHROME_FLAGS:-}" in *[!A-Za-z0-9=,._\ -]*) echo "CHROME_FLAGS has unsafe characters, ignored" | tee -a shots/index.txt; CHROME_FLAGS="";; esac
adb shell "echo '_ --disable-fre --no-first-run --no-default-browser-check ${CHROME_FLAGS:-}' > /data/local/tmp/chrome-command-line"
adb shell chmod 755 /data/local/tmp/chrome-command-line
adb shell am set-debug-app --persistent $PKG || true
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS 2>/dev/null || true
# software emulator makes Pixel Launcher ANR ("isn't responding" dialog over the page): hide error dialogs
adb shell settings put global hide_error_dialogs 1 || true
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1 || true
adb shell am force-stop $PKG
# warm Chrome once (cold start on the first URL left no devtools target in time, run 41868447220): open about:blank and
# wait for the devtools socket to list a page, up to 30 s
adb shell am start -a android.intent.action.VIEW -d about:blank $PKG >/dev/null 2>&1 || true
adb forward tcp:9222 localabstract:chrome_devtools_remote >/dev/null 2>&1 || true
for t in $(seq 1 15); do curl -s --max-time 2 http://localhost:9222/json 2>/dev/null | grep -q '"type": *"page"' && break; sleep 2; done
i=0
for u in "${LIST[@]}"; do
  i=$((i+1)); n=$(printf '%02d' $i)
  echo "$n $u" | tee -a shots/index.txt
  case "$u" in chrome://*) adb shell am start -n $PKG/com.google.android.apps.chrome.Main >/dev/null || true;;
    *) adb shell am start -a android.intent.action.VIEW -d "'$u'" $PKG || { echo "$n FAILED to open" | tee -a shots/index.txt; continue; };; esac
  sleep 6
  adb forward --remove-all >/dev/null 2>&1 || true
  adb forward tcp:9222 localabstract:chrome_devtools_remote
  # attach over CDP, replay the load to catch console/page/network errors for WAIT seconds
  timeout $((WAIT+90)) node scripts/cdp-capture.mjs "$u" "$WAIT" "shots/$n.json" || echo "$n cdp capture failed" | tee -a shots/index.txt
  adb exec-out screencap -p > "shots/$n.png" || echo "$n screenshot failed" | tee -a shots/index.txt
  sleep 3
  adb exec-out screencap -p > "shots/$n-b.png" || true
done
exit 0
