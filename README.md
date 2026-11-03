# ios-sim-check

Opens public web pages in Mobile Safari on an iOS Simulator (GitHub-hosted macOS runner) and saves screenshots.
Nothing private lives here: no app code, no keys. It only visits URLs given at run time.

    gh workflow run ios-sim.yml -R SRHSoulja/ios-sim-check -f urls="https://straycucks.com/arplay/?id=190" -f wait=20
    gh run list -R SRHSoulja/ios-sim-check -w ios-sim -L 1
    gh run download <run-id> -R SRHSoulja/ios-sim-check -n ios-shots -D ./ios-shots

Each URL gets two screenshots (after `wait` s and 3 s later). The simulator is real Mobile Safari (WebKit on iOS);
it has no camera, so AR Quick Look placement cannot be tested, but pages, layout, Quick Look's object view and
JavaScript behaviour can. Canonical copy: gmgn-brain work/drafts/stray-cucks/ios-sim-check (private).
