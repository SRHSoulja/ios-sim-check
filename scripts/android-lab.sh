#!/usr/bin/env bash
# android-lab.sh (2026-11-14): runs inside android-emulator-runner (emulator booted). Drives room pages with room-lab.mjs
# in one or more Android browsers. Env (all from workflow inputs, through env only):
#   PHASES  space list of: rel (scripts/rel-lab.mjs, engine releases), chrome (the image's own Chrome), chromium (apks/ChromePublic.apk, a Chromium snapshot),
#           webview (apks/SystemWebView.apk made the WebView provider + apks/SystemWebViewShell.apk as the browser),
#           webview-stock (the shell on the image's own WebView), metamask (apks/metamask.apk, walked through first run
#           with a throwaway wallet, the url opened in its in-app browser), xconnect (the X connect cases on a /me
#           url inside MetaMask's browser, Chrome as the second browser: scripts/xconnect-lab.mjs)
#   URLS    room page urls (each gets a room-lab run per browser)
#   HOLDER  (phase rel) a PUBLIC burner address the page-side wallet stub answers eth_accounts with (no signing, ever)
#   OS_URL  the NFT's animation_url, framed OpenSea-style (HARNESS=1) twice: as is + "#perf", and + "#pchtml&perf"
set -uo pipefail
# orbit twice after the zoom-out so the computer faces the camera (from behind a tap finds nothing, runs 43657727010/715594)
export DRAGS="${DRAGS:-2}"
mkdir -p shots
# host memory before, kernel OOM/qemu lines after: the emulator died mid-run twice on 2026-11-15 (runs 43726890096, 43727493568)
{ free -m; nproc; } > shots/host.txt 2>&1
read -ra LIST <<< "${URLS:-}"
OS_URL="${OS_URL:-}"
note() { echo "$*" | tee -a shots/index.txt; }
{ adb shell getprop ro.build.version.release; adb shell getprop ro.build.version.sdk; adb shell getprop ro.debuggable; adb shell wm size; adb shell wm density
  adb shell dumpsys package com.android.chrome | grep -m1 versionName; adb shell dumpsys webviewupdate | head -25; } 2>&1 | tee shots/index.txt
adb root >/dev/null 2>&1 || true; sleep 2
adb shell settings put global hide_error_dialogs 1 || true
adb shell "echo '_ --disable-fre --no-first-run --no-default-browser-check' > /data/local/tmp/chrome-command-line"; adb shell chmod 755 /data/local/tmp/chrome-command-line
wait_json() { for t in $(seq 1 30); do curl -s --max-time 2 http://localhost:9222/json 2>/dev/null | grep -q '"type": *"page"' && return 0; sleep 2; done; return 1; }
labs() {   # $1 label prefix; env passed through
  local p=$1 i=0
  for u in "${LIST[@]}"; do i=$((i+1)); note "$p-u$i $u"; ADB=1 timeout 1500 node scripts/room-lab.mjs http://localhost:9222 shots "$p-u$i" "$u" >> shots/lab.log 2>&1 || note "$p-u$i room-lab exit $?"; done
  if [ -n "$OS_URL" ]; then
    note "$p-os-plain $OS_URL#perf (OpenSea-style frame)"; HARNESS=1 ADB=1 timeout 1500 node scripts/room-lab.mjs http://localhost:9222 shots "$p-os-plain" "$OS_URL#perf" >> shots/lab.log 2>&1 || note "$p-os-plain exit $?"
    note "$p-os-pchtml $OS_URL#pchtml&perf (OpenSea-style frame)"; HARNESS=1 ADB=1 timeout 1500 node scripts/room-lab.mjs http://localhost:9222 shots "$p-os-pchtml" "$OS_URL#pchtml&perf" >> shots/lab.log 2>&1 || note "$p-os-pchtml exit $?"
  fi
}
rels() {   # $1 label prefix: rel-lab.mjs per room url (chair from the url), then OS_URL as the real OpenSea item page and the harness
  local p=$1 i=0 c
  for u in "${LIST[@]}"; do i=$((i+1)); c=$(echo "$u" | grep -oE '/alive/[0-9]+' | grep -oE '[0-9]+$'); [ -n "$c" ] || { note "$p-u$i no chair in $u"; continue; }
    note "$p-c$c $u"; PROTO=cdp HOLDER="${HOLDER:-}" PARTS="${PARTS:-}" timeout 1700 node scripts/rel-lab.mjs shots "$p-c$c" "$c" >> shots/lab.log 2>&1 || note "$p-c$c rel-lab exit $?"; done
  if [ -n "$OS_URL" ]; then c=$(echo "$OS_URL" | grep -oE '[0-9]+$')
    note "$p-os-real $OS_URL"; PROTO=cdp OS_ITEM="$OS_URL" timeout 600 node scripts/rel-lab.mjs shots "$p-os-real" "$c" >> shots/lab.log 2>&1 || note "$p-os-real exit $?"
    note "$p-os-harness /alive/$c framed at $HURL"; PROTO=cdp HARNESS=1 timeout 600 node scripts/rel-lab.mjs shots "$p-os-harness" "$c" >> shots/lab.log 2>&1 || note "$p-os-harness exit $?"
  fi
}
HURL=https://opensea.io/__device-lab-harness
chrome_like() {   # $1 package $2 label [$3 runner: labs (default) or rels]
  adb shell am force-stop com.android.chrome; adb shell am force-stop org.chromium.chrome 2>/dev/null || true
  adb shell am set-debug-app --persistent "$1" || true
  adb shell pm grant "$1" android.permission.POST_NOTIFICATIONS 2>/dev/null || true
  adb shell am start -a android.intent.action.VIEW -d about:blank "$1" >/dev/null 2>&1 || true
  adb forward --remove-all; adb forward tcp:9222 localabstract:chrome_devtools_remote
  if ! wait_json; then note "$2: no devtools page"; adb exec-out screencap -p > "shots/$2-nodevtools.png"; return; fi
  curl -s http://localhost:9222/json/version > "shots/$2-version.json"; note "$2 $(grep -o '"Browser": *"[^"]*"' shots/$2-version.json)"
  "${3:-labs}" "$2"
}
webview_shell() {   # $1 label
  adb shell am force-stop org.chromium.webview_shell
  adb shell am start -n org.chromium.webview_shell/.WebViewBrowserActivity -a android.intent.action.VIEW -d about:blank >/dev/null 2>&1 || true
  sleep 8; local sock=""
  for t in $(seq 1 15); do sock=$(adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | head -1); [ -n "$sock" ] && break; sleep 2; done
  if [ -z "$sock" ]; then note "$1: no webview devtools socket"; adb exec-out screencap -p > "shots/$1-nosocket.png"; return; fi
  adb forward --remove-all; adb forward tcp:9222 "localabstract:$sock"
  wait_json || note "$1: socket $sock lists no page"
  curl -s http://localhost:9222/json/version > "shots/$1-version.json"; note "$1 $sock $(tr -d '\n' < shots/$1-version.json | grep -o '"User-Agent": *"[^"]*"')"
  labs "$1"
}
mm_setup() {   # install MetaMask (the verified release APK) and walk its first run with a throwaway wallet
  adb install -r -g apks/metamask.apk 2>&1 | tail -1 | tee -a shots/index.txt
  adb shell dumpsys package io.metamask | grep -m1 versionName | tee -a shots/index.txt
  adb shell monkey -p io.metamask -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 20
  # a throwaway wallet: random password made here, never printed or kept; MetaMask's screens are FLAG_SECURE, so
  # adb screencaps of them come out black (the texts in mm-walk-NN.txt are the record; the page itself is shot over CDP)
  MM_PW="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 16)Aa1!"   # kept in this shell only, for the unlock screen
  APP=io.metamask PW="$MM_PW" timeout 900 node scripts/ui-walk.mjs shots/mm-walk "${MM_STEPS:-30}" '^(browser|explore)$' 2>&1 | tee -a shots/lab.log
}
mm_open() {   # $1 url: open it in MetaMask's in-app browser, forward its WebView devtools socket to 9222; 0 = found
  local d="${1#https://}" s sock
  note "metamask deep link metamask://dapp/$d"
  adb shell am start -a android.intent.action.VIEW -d "'metamask://dapp/$d'" >/dev/null 2>&1 || true
  sleep 30; adb exec-out screencap -p > shots/mm-dapp-1.png
  # MetaMask can come back locked (run 43687232153: "Enter password / Unlock"): type the run's password and Unlock
  APP=io.metamask PW="${MM_PW:-x}" WALK='["^unlock$","^got it$","^not now$","^close$","^ok$","^dismiss$"]' timeout 180 node scripts/ui-walk.mjs shots/mm-dapp 6 'straycucks' 2>&1 | tee -a shots/lab.log
  sock=$(adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | sort -u | tr '\n' ' ')
  note "metamask webview devtools sockets: ${sock:-none}"
  for s in $sock; do
    adb forward --remove tcp:9222 2>/dev/null; adb forward tcp:9222 "localabstract:$s"
    curl -s http://localhost:9222/json > "shots/mm-$s.json"
    grep -q straycucks "shots/mm-$s.json" && return 0
  done
  return 1
}
for ph in ${PHASES:-chrome}; do
  note "=== phase $ph"
  case "$ph" in
    chrome) chrome_like com.android.chrome chrome ;;
    rel) chrome_like com.android.chrome rel rels ;;   # engine releases v121-v123 (scripts/rel-lab.mjs), Chrome of the image
    chromium)
      adb install -r -g apks/ChromePublic.apk 2>&1 | tail -1 | tee -a shots/index.txt
      chrome_like org.chromium.chrome chromium ;;
    webview-stock)
      adb install -r -g apks/SystemWebViewShell.apk 2>&1 | tail -1 | tee -a shots/index.txt
      webview_shell webview-stock ;;
    webview)
      adb install -r -g apks/SystemWebView.apk 2>&1 | tail -1 | tee -a shots/index.txt
      adb install -r -g apks/SystemWebViewShell.apk 2>&1 | tail -1 | tee -a shots/index.txt
      adb shell cmd webviewupdate set-webview-implementation com.android.webview 2>&1 | tee -a shots/index.txt
      adb shell dumpsys webviewupdate | head -12 | tee -a shots/index.txt
      webview_shell webview ;;
    xconnect)
      # X connect from MetaMask's in-app browser with Chrome as the second browser (scripts/xconnect-lab.mjs).
      # Chrome first: debug app (reads the no-first-run flags), one start so its first run is done before the handoff
      adb shell am set-debug-app --persistent com.android.chrome || true
      adb shell pm grant com.android.chrome android.permission.POST_NOTIFICATIONS 2>/dev/null || true
      adb shell am start -a android.intent.action.VIEW -d about:blank com.android.chrome >/dev/null 2>&1 || true
      sleep 10; adb exec-out screencap -p > shots/xc-chrome-ready.png; adb shell am force-stop com.android.chrome
      mm_setup
      for u in "${LIST[@]}"; do
        if mm_open "$u"; then MM_PW="$MM_PW" timeout 2400 node scripts/xconnect-lab.mjs http://localhost:9222 shots xc "$u" 2>&1 | tee -a shots/lab.log || note "xconnect exit $?"
        else note "xconnect: no straycucks page in MetaMask's browser"; adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml > shots/mm-dapp-ui.xml; fi
      done ;;
    metamask)
      mm_setup
      for u in "${LIST[@]}"; do
        d="${u#https://}"
        note "metamask deep link metamask://dapp/$d"
        adb shell am start -a android.intent.action.VIEW -d "'metamask://dapp/$d'" >/dev/null 2>&1 || true
        sleep 30; adb exec-out screencap -p > shots/mm-dapp-1.png
        APP=io.metamask PW=x WALK='["^got it$","^not now$","^close$","^ok$","^continue$","^dismiss$"]' timeout 300 node scripts/ui-walk.mjs shots/mm-dapp 4 '^diorama$|room menu' 2>&1 | tee -a shots/lab.log
        sock=$(adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | sort -u | tr '\n' ' ')
        note "metamask webview devtools sockets: ${sock:-none}"
        for s in $sock; do
          adb forward --remove-all; adb forward tcp:9222 "localabstract:$s"
          curl -s http://localhost:9222/json > "shots/mm-$s.json"; curl -s http://localhost:9222/json/version > "shots/mm-$s-version.json"
          if grep -q straycucks "shots/mm-$s.json"; then TARGET_MATCH=straycucks.com ADB=1 timeout 1500 node scripts/room-lab.mjs http://localhost:9222 shots mm-u1 "$u" >> shots/lab.log 2>&1 || note "mm room-lab exit $?"; fi
        done
        adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml > shots/mm-dapp-ui.xml
        adb exec-out screencap -p > shots/mm-dapp-end.png
      done ;;
  esac
done
{ echo "--- end"; free -m; sudo dmesg 2>/dev/null | grep -iE "oom|killed process|qemu|segfault" | tail -20; pgrep -a qemu-system | cut -c1-120; } >> shots/host.txt 2>&1
exit 0
