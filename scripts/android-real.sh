#!/usr/bin/env bash
# android-real.sh (2026-11-17): inside android-emulator-runner. Android Chrome on the REAL OpenSea item page (env ITEM), scripts/android-real.mjs.
set -uo pipefail
mkdir -p shots; note() { echo "$*" | tee -a shots/index.txt; }
{ adb shell getprop ro.build.version.release; adb shell wm size; adb shell wm density; adb shell dumpsys package com.android.chrome | grep -m1 versionName; } 2>&1 | tee shots/index.txt
adb root >/dev/null 2>&1 || true; sleep 2
adb shell settings put global hide_error_dialogs 1 || true
adb shell "echo '_ --disable-fre --no-first-run --no-default-browser-check' > /data/local/tmp/chrome-command-line"; adb shell chmod 755 /data/local/tmp/chrome-command-line
adb shell am force-stop com.android.chrome; adb shell am set-debug-app --persistent com.android.chrome || true
adb shell pm grant com.android.chrome android.permission.POST_NOTIFICATIONS 2>/dev/null || true
adb shell am start -a android.intent.action.VIEW -d about:blank com.android.chrome >/dev/null 2>&1 || true
adb forward --remove-all; adb forward tcp:9222 localabstract:chrome_devtools_remote
for t in $(seq 1 30); do curl -s --max-time 2 http://localhost:9222/json 2>/dev/null | grep -q '"type": *"page"' && break; sleep 2; done
curl -s http://localhost:9222/json/version | tee shots/version.json | head -5
(cd scripts && npm i --no-save --silent playwright-core 2>&1 | tail -2)
OUT=shots/real NODE_PATH=scripts/node_modules timeout 900 node scripts/android-real.mjs 2>&1 | tee shots/lab.log || note "android-real exit $?"
exit 0
