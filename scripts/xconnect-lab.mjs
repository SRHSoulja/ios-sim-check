// xconnect-lab.mjs (2026-11-14): the wallet-browser X cases on a scanner /me page, inside MetaMask's in-app browser
// (its WebView devtools socket) with Chrome as the second browser. Node 22 (global WebSocket, fetch).
//   node xconnect-lab.mjs <wallet cdp base, e.g. http://localhost:9222> <out dir> <label> <me url>
// Steps (all recorded in <label>.json; page shots <label>-NN-<step>.png over CDP, MetaMask's own screens are FLAG_SECURE):
//  A signed out: the wallet-browser note (#x-inapp) with Copy link / Open in Chrome; Sign in with X (spam check, X),
//    then history.back(): "Sign in with X did not finish" must show.
//  B Sign in with wallet (the run's throwaway MetaMask wallet; Connect / Confirm pressed through uiautomator).
//  C Link X: the handoff box (#x-ho); "Try Link X here anyway" to X, back: "Linking X did not finish" must show.
//  D Link X in Chrome or Safari: make the link, tap Open in Chrome (falls back to opening the link in Chrome by intent,
//    the paste stand-in), in Chrome: the handoff page, Sign in with X, stop at X's sign-in screen. NO credentials typed.
//  E back in MetaMask: the wallet tab polls (started = "Waiting for you to sign in with X in the other browser").
//  F abandoned: wait for the link to run out (10 min): "That link ran out" must show.
//  G clean-up: delete the throwaway account (owner session).
// The handoff code is a one-time 10-minute secret: only its first 6 characters are written to the json.
// Env: CHROME_PORT (default 9223), SKIP_EXPIRY=1 skips F.
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const [BASE, OUT, LABEL, URL0] = process.argv.slice(2);
const CPORT = process.env.CHROME_PORT || '9223';
mkdirSync(OUT, { recursive: true });
const R = { label: LABEL, url: URL0, steps: [], cases: {}, consoles: { mm: [], chrome: [] } };
const save = () => writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify(R, null, 2));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const red = s => String(s || '').replace(/([?&](?:c|code|oauth_token|state|code_challenge)=)([A-Za-z0-9_\-.%~]{6})[A-Za-z0-9_\-.%~]*/g, '$1$2...');
const log = (k, v) => { R.steps.push({ t: new Date().toISOString().slice(11, 19), k, v }); save(); console.log(LABEL, k, red(JSON.stringify(v ?? null)).slice(0, 500)); };
const adb = (...a) => { try { return execFileSync('adb', a, { maxBuffer: 64e6, timeout: 30000 }); } catch (e) { return Buffer.from(''); } };
let shotN = 0;

async function cdp(base, match, tag) {
  let tg;
  for (let t = 0; t < 20 && !tg; t++) {
    try { const all = (await (await fetch(base + '/json', { signal: AbortSignal.timeout(5000) })).json()).filter(x => x.type === 'page'); tg = all.find(x => x.url.includes(match)) || null; if (!tg) R[tag + 'Targets'] = all.map(x => red(x.url)); } catch (e) { R[tag + 'TargetErr'] = String(e); }
    if (!tg) await sleep(2000);
  }
  if (!tg) return null;
  const ws = new WebSocket(tg.webSocketDebuggerUrl);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; setTimeout(() => bad(new Error('ws open timeout')), 10000); });
  let id = 0; const pending = new Map();
  const send = (method, params = {}, ms = 20000) => new Promise(r => { const i = ++id; const tm = setTimeout(() => { pending.delete(i); r({ timeout: method }); }, ms); pending.set(i, v => { clearTimeout(tm); r(v); }); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? { error: m.error }); pending.delete(m.id); return; }
    const p = m.params || {};
    if (m.method === 'Runtime.consoleAPICalled') R.consoles[tag].push({ type: p.type, text: red((p.args || []).map(a => a.value ?? a.description ?? a.type).join(' ')).slice(0, 300) });
    if (m.method === 'Runtime.exceptionThrown') R.consoles[tag].push({ type: 'exception', text: red(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '').slice(0, 300) });
    if (m.method === 'Log.entryAdded') R.consoles[tag].push({ type: 'log-' + p.entry.level, text: red(p.entry.text + ' ' + (p.entry.url || '')).slice(0, 300) });
    if (m.method === 'Page.frameNavigated' && !p.frame.parentId) R.steps.push({ t: new Date().toISOString().slice(11, 19), k: tag + '-nav', v: red(p.frame.url) });
  };
  for (const d of ['Runtime', 'Page', 'Log']) await send(d + '.enable');
  const ev = async (expr, ms = 15000) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: ms - 1000 }, ms); return r?.result?.value ?? { evalErr: r?.exceptionDetails?.text || r?.error?.message || (r?.timeout ? 'timeout' : 'none') }; };
  const shot = async (name, sel) => {
    if (sel) await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(e&&e.scrollIntoView) e.scrollIntoView({block:'center'}); return !!e})()`); await sleep(600);
    const s = await send('Page.captureScreenshot', { format: 'png' }, 60000);
    const f = `${LABEL}-${String(++shotN).padStart(2, '0')}-${tag}-${name}.png`;
    if (s?.data) { writeFileSync(`${OUT}/${f}`, Buffer.from(s.data, 'base64')); R.shots = (R.shots || []).concat(f); } else log('shot-fail', { f, s });
    return f;
  };
  // a real touch (user activation) on the element's middle; the element is scrolled into view first
  const tapSel = async sel => {
    const b = await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; e.scrollIntoView({block:'center'}); var r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height}})()`);
    if (!b || b.evalErr || !b.w) return { tapped: false, b };
    await sleep(400);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
    await sleep(80);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return { tapped: true, b };
  };
  return { send, ev, shot, tapSel, url: () => ev('location.href'), close: () => ws.close() };
}
// what the visitor can read: the visible text of the given ids, and whether each is shown
const VIS = ids => `(function(){var o={};${JSON.stringify(ids)}.forEach(function(i){var e=document.getElementById(i); if(!e){o[i]=null;return;} var r=e.getBoundingClientRect(); o[i]={shown:!!(e.offsetParent||e.getClientRects().length)&&!e.closest('[hidden]'),text:(e.innerText||e.value||'').replace(/\\s+/g,' ').trim().slice(0,400),w:Math.round(r.width),h:Math.round(r.height)}}); return o})()`;
const BUTTONS = sel => `(function(){var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return null; return [].slice.call(b.querySelectorAll('button,a.btn,input')).map(function(x){return {tag:x.tagName,text:(x.innerText||x.value||'').trim(),href:x.href?String(x.href).replace(/([?&]c=[A-Za-z0-9_-]{6})[A-Za-z0-9_-]*/,'$1...'):undefined, w:Math.round(x.getBoundingClientRect().width), h:Math.round(x.getBoundingClientRect().height)}})})()`;
const ui = () => {
  adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml');
  const xml = adb('shell', 'cat', '/sdcard/ui.xml').toString();
  return [...xml.matchAll(/<node ([^>]*?)\/?>/g)].map(m => { const a = {}; for (const [, k, v] of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) a[k] = v.replace(/&amp;/g, '&').replace(/&#10;/g, ' ').replace(/&quot;/g, '"'); const b = (a.bounds || '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/); a.box = b ? b.slice(1).map(Number) : null; a.label = (a.text || a['content-desc'] || '').trim(); return a; });
};
const top = () => (adb('shell', 'dumpsys', 'activity', 'activities').toString().match(/(?:topResumedActivity|mResumedActivity)[^\n]*/) || [''])[0].trim();
// press the wallet's own buttons for a request (connect, sign); never a money screen; logs every screen's texts
async function walletApprove(mm, doneExpr, maxS = 120) {
  const t0 = Date.now(), seen = [];
  while (Date.now() - t0 < maxS * 1000) {
    const done = await mm.ev(doneExpr);
    if (done === true) return { ok: true, seen };
    const nodes = ui(); const texts = nodes.filter(n => n.label && n.box).map(n => n.label);
    const pkg = nodes[0] && nodes[0].package;
    if (texts.some(t => /\b(buy|deposit|transak|send|swap|bridge|pay with)\b/i.test(t)) && !texts.some(t => /^(connect|confirm|sign)$/i.test(t))) { seen.push({ pkg, texts: texts.slice(0, 40), did: 'money-looking screen: nothing pressed' }); await sleep(3000); continue; }
    const hit = nodes.find(n => n.box && n.enabled !== 'false' && /^(connect|confirm|sign|approve)$/i.test(n.label));
    if (hit) { const x = Math.round((hit.box[0] + hit.box[2]) / 2), y = Math.round((hit.box[1] + hit.box[3]) / 2); adb('shell', 'input', 'tap', String(x), String(y)); seen.push({ pkg, texts: texts.slice(0, 40), did: `tapped "${hit.label}"` }); await sleep(4000); continue; }
    if (seen.length === 0 || seen[seen.length - 1].texts.join('|') !== texts.slice(0, 40).join('|')) seen.push({ pkg, texts: texts.slice(0, 40), did: 'waiting' });
    await sleep(3000);
  }
  return { ok: false, seen };
}
// a trip to X: press the button, let the Cloudflare spam check pass (tap its box if it shows one), until the page is X's
async function toX(c, btnSel, tag, maxS = 90) {
  const r = { tap: await c.tapSel(btnSel) };
  const t0 = Date.now(); let tsTapped = 0;
  while (Date.now() - t0 < maxS * 1000) {
    await sleep(3000);
    const u = String(await c.url());
    if (/(^https:\/\/([a-z]+\.)?(x|twitter)\.com\/)/.test(u)) { r.reachedX = true; r.xUrl = red(u); break; }
    const st = await c.ev(`(function(){var f=document.querySelector('#ts iframe'); var r=f&&f.getBoundingClientRect(); return {iframe:!!f, box:r?[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)]:null, st:[].slice.call(document.querySelectorAll('.status')).map(function(e){return e.innerText.trim()}).filter(Boolean)}})()`);
    r.lastPage = st;
    if (st && st.box && st.box[2] > 0 && tsTapped < 2 && Date.now() - t0 > 12000 * (tsTapped + 1)) {
      // Turnstile's interactive box: its checkbox sits about 30 px from the left edge, mid height
      await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: st.box[0] + 30, y: st.box[1] + st.box[3] / 2, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
      await sleep(80); await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); tsTapped++; r.tsTapped = tsTapped;
    }
  }
  if (r.reachedX) {
    await sleep(8000);
    r.xUrl = red(await c.url());
    r.xText = await c.ev(`(document.body&&document.body.innerText||'').replace(/\\s+/g,' ').trim().slice(0,600)`);
    r.xTitle = await c.ev('document.title');
    r.xInputs = await c.ev(`[].slice.call(document.querySelectorAll('input')).map(function(i){return i.type+':'+(i.name||i.autocomplete||'')})`);
    r.shot = await c.shot(tag + '-x');
  }
  log(tag, r); return r;
}
async function waitFor(c, expr, maxS = 30) { for (let i = 0; i < maxS; i++) { const v = await c.ev(expr); if (v === true) return true; await sleep(1000); } return false; }

// ---------------- run ----------------
const mm = await cdp(BASE, 'straycucks.com', 'mm');
if (!mm) { R.fatal = 'no straycucks page in the wallet browser'; save(); process.exit(1); }
try {
  R.ua = await mm.ev('navigator.userAgent');
  R.viewport = await mm.ev('({w:innerWidth,h:innerHeight,dpr:devicePixelRatio, eth:!!window.ethereum, isMM:!!(window.ethereum&&window.ethereum.isMetaMask)})');
  log('start', { url: red(await mm.url()), ua: R.ua, viewport: R.viewport });
  await waitFor(mm, `!!document.getElementById('loading') && document.getElementById('loading').hidden`, 40);
  // ---- A: signed out
  const A = R.cases.A = {};
  A.page = await mm.ev(VIS(['out', 'in', 'x-inapp', 'x-login', 'signin', 'out-st']));
  A.inappButtons = await mm.ev(BUTTONS('#x-inapp'));
  A.shotNote = await mm.shot('A1-signed-out-note', '#x-inapp');
  if (A.inappButtons && A.inappButtons.find(b => /Copy link/.test(b.text))) { await mm.tapSel('#x-inapp button'); await sleep(1500); A.copyStatus = await mm.ev(`(document.querySelector('#x-inapp .status')||{}).innerText||''`); A.shotCopy = await mm.shot('A2-copy-tapped', '#x-inapp'); }
  await mm.tapSel('#age'); await sleep(500); A.age = await mm.ev(`document.getElementById('age')&&document.getElementById('age').checked`);
  A.trip = await toX(mm, '#x-login', 'A3-signin-x');
  if (A.trip.reachedX) {
    await mm.ev('history.back(), true'); await sleep(10000);
    await waitFor(mm, `/allowlist\\.straycucks\\.com\\/me/.test(location.href) && !!document.getElementById('out-st') && document.getElementById('out-st').innerText.length > 0`, 25);
    A.afterBack = await mm.ev(VIS(['out', 'out-st', 'x-inapp']));
    A.afterBackUrl = red(await mm.url());
    A.shotBack = await mm.shot('A4-after-back', '#out-st');
  }
  A.pass = !!(A.page?.['x-inapp']?.shown && /do(es)? not work inside wallet apps/i.test(A.page['x-inapp'].text) && A.inappButtons?.some(b => /Copy link/.test(b.text)) && A.inappButtons?.some(b => /Open in Chrome/.test(b.text)) && /did not finish/i.test(A.afterBack?.['out-st']?.text || ''));
  log('A', { pass: A.pass });
  // ---- B: wallet sign-in
  const B = R.cases.B = {};
  if (!/\/me$|\/me\?|\/me#/.test(String(await mm.url()))) { await mm.ev(`location.assign(${JSON.stringify(URL0)}), true`); await sleep(8000); }
  await waitFor(mm, `document.getElementById('loading').hidden`, 30);
  await mm.ev(`(function(){var a=document.getElementById('age'); if(a&&!a.checked){a.click()} return true})()`);
  B.tap = await mm.tapSel('#signin');
  B.approve = await walletApprove(mm, `(function(){var i=document.getElementById('in'); return !!(i && !i.hidden)})()`, 150);
  B.page = await mm.ev(VIS(['in', 'out-st', 'w-count', 'wallets', 'x', 'x-new', 'x-a', 'x-ho', 'x-oauth', 'x-a-note', 'x-st']));
  B.shot = await mm.shot('B1-signed-in', '#w-h');
  B.pass = !!B.page?.in?.shown;
  log('B', { pass: B.pass, approve: B.approve.ok });
  if (B.pass) {
    // ---- C: Link X here anyway, then Back
    const C = R.cases.C = {};
    await mm.tapSel('#x-consent'); await sleep(400);
    C.hoBox = await mm.ev(VIS(['x-ho', 'x-ho-why', 'x-ho-make', 'x-oauth', 'x-ho-here']));
    C.shotBox = await mm.shot('C1-handoff-box', '#x-ho');
    C.trip = await toX(mm, '#x-oauth', 'C2-link-here-x');
    if (C.trip.reachedX) {
      await mm.ev('history.back(), true'); await sleep(10000);
      await waitFor(mm, `!!document.getElementById('x-st') && document.getElementById('x-st').innerText.length > 0`, 25);
      C.afterBack = await mm.ev(VIS(['in', 'x-st', 'x-ho']));
      C.shotBack = await mm.shot('C3-after-back', '#x-st');
    }
    C.pass = !!(C.hoBox?.['x-ho']?.shown && /Try Link X here anyway/.test(C.hoBox?.['x-oauth']?.text || '') && /Linking X did not finish/.test(C.afterBack?.['x-st']?.text || ''));
    log('C', { pass: C.pass });
    // ---- D: the handoff link, in Chrome
    const D = R.cases.D = {};
    await waitFor(mm, `document.getElementById('loading').hidden && !document.getElementById('in').hidden`, 20);
    await mm.ev(`(function(){var c=document.getElementById('x-consent'); if(c&&!c.checked) c.click(); return true})()`);
    D.make = await mm.tapSel('#x-ho-make'); await sleep(4000);
    D.link = await mm.ev(VIS(['x-ho-link', 'x-ho-url', 'x-ho-st']));
    D.linkButtons = await mm.ev(BUTTONS('#x-ho-link'));
    if (D.link?.['x-ho-url']) D.link['x-ho-url'].text = red(D.link['x-ho-url'].text);
    const hoUrl = await mm.ev(`document.getElementById('x-ho-url').value`);
    D.shotLink = await mm.shot('D1-handoff-link', '#x-ho-link');
    await mm.tapSel('#x-ho-copy'); await sleep(1500); D.copyStatus = await mm.ev(`document.getElementById('x-ho-st').innerText`);
    D.poll0 = await mm.ev(`fetch('/api/w/x/handoff',{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){return {state:j.state, ok:j.ok}})`);
    D.topBefore = top();
    D.chromeTap = await mm.tapSel('#x-ho-chrome'); await sleep(8000);
    D.topAfterTap = top();
    D.openInChromeWorked = /com\.android\.chrome/.test(D.topAfterTap);
    D.mmAfterTapUrl = red(await mm.url());
    if (!D.openInChromeWorked && /^https:\/\/allowlist\.straycucks\.com\/me\/x-handoff\?c=/.test(String(hoUrl))) {
      // the paste stand-in: open the same link in Chrome by an intent (Copy link + paste)
      adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${hoUrl}'`, 'com.android.chrome'); await sleep(8000);
      D.fallbackIntent = true; D.topAfterFallback = top();
    }
    execFileSync('adb', ['forward', `tcp:${CPORT}`, 'localabstract:chrome_devtools_remote']);
    const ch = await cdp(`http://localhost:${CPORT}`, 'x-handoff', 'chrome');
    if (!ch) { D.chrome = 'no x-handoff tab in Chrome'; writeFileSync(`${OUT}/${LABEL}-D-chrome-adb.png`, adb('exec-out', 'screencap', '-p')); }
    else {
      D.chromeUa = await ch.ev('navigator.userAgent');
      await waitFor(ch, `!!document.getElementById('ho-go') && (!document.getElementById('ho-go').hidden || !document.getElementById('ho-done').hidden)`, 20);
      D.chromePage = await ch.ev(`(function(){var o={}; ['ho-go','ho-done','ho-x','ho-st'].forEach(function(i){var e=document.getElementById(i); o[i]=e?{shown:!e.closest('[hidden]'),text:e.innerText.replace(/\\s+/g,' ').trim().slice(0,500)}:null}); o.body=document.body.innerText.replace(/\\s+/g,' ').trim().slice(0,800); return o})()`);
      D.shotChrome = await ch.shot('D2-chrome-handoff-page', '#ho-go');
      writeFileSync(`${OUT}/${LABEL}-D2-chrome-handoff-adb.png`, adb('exec-out', 'screencap', '-p'));
      D.trip = await toX(ch, '#ho-x', 'D3-chrome-x', 120);
      if (D.trip.reachedX) writeFileSync(`${OUT}/${LABEL}-D3-chrome-x-adb.png`, adb('exec-out', 'screencap', '-p'));
      D.chromeStatus = D.trip.reachedX ? null : await ch.ev(`(document.getElementById('ho-st')||{}).innerText||''`);
      ch.close();
    }
    D.pass = !!(D.link?.['x-ho-link']?.shown && D.linkButtons?.some(b => /Copy link/.test(b.text)) && D.linkButtons?.some(b => /Open in Chrome/.test(b.text)) && D.chromePage?.['ho-go']?.shown && D.trip?.reachedX);
    log('D', { pass: D.pass, openInChromeWorked: D.openInChromeWorked, fallback: !!D.fallbackIntent, reachedX: D.trip?.reachedX, xUrl: D.trip?.xUrl });
    // ---- E: back to the wallet tab: it polls
    const E = R.cases.E = {};
    adb('shell', 'monkey', '-p', 'io.metamask', '-c', 'android.intent.category.LAUNCHER', '1'); await sleep(10000);
    E.top = top();
    E.mmUrl = red(await mm.url());
    if (!/\/me/.test(E.mmUrl) || /x-handoff/.test(E.mmUrl)) { E.note = 'wallet tab left /me; reopened'; await mm.ev(`location.assign(${JSON.stringify(URL0)}), true`); await sleep(10000); }
    await sleep(8000);
    E.page = await mm.ev(VIS(['x-ho-link', 'x-ho-ready', 'x-ho-who', 'x-ho-st', 'x-st']));
    E.poll = await mm.ev(`fetch('/api/w/x/handoff',{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){return {state:j.state, handle:j.handle||null}})`);
    E.shot = await mm.shot('E1-wallet-tab-after-chrome', '#x-ho');
    E.pass = E.poll?.state === 'started' && /Waiting for you to sign in with X/.test(E.page?.['x-ho-st']?.text || '');
    log('E', { pass: E.pass, poll: E.poll });
    // ---- F: abandoned: the link runs out
    if (process.env.SKIP_EXPIRY !== '1') {
      const F = R.cases.F = {};
      const t0 = Date.now();
      while (Date.now() - t0 < 12 * 60e3) { await sleep(20000); const s = await mm.ev(`document.getElementById('x-ho-st').innerText`); if (/ran out/.test(String(s))) break; }
      F.waitedS = Math.round((Date.now() - t0) / 1000);
      F.page = await mm.ev(VIS(['x-ho-link', 'x-ho-ready', 'x-ho-st', 'x-st']));
      F.poll = await mm.ev(`fetch('/api/w/x/handoff',{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){return {state:j.state}})`);
      F.shot = await mm.shot('F1-link-ran-out', '#x-ho');
      F.pass = /That link ran out/.test(F.page?.['x-ho-st']?.text || '') && F.poll?.state === 'none';
      log('F', { pass: F.pass, waitedS: F.waitedS });
    }
    // ---- G: delete the throwaway account
    const G = R.cases.G = {};
    await mm.tapSel('#del'); await sleep(800);
    await mm.ev(`(function(){var i=document.getElementById('del-in'); i.value='DELETE'; i.dispatchEvent(new Event('input')); return true})()`);
    await mm.tapSel('#del-go'); await sleep(6000);
    G.after = await mm.ev(VIS(['out', 'in', 'out-st', 'd-st']));
    G.me = await mm.ev(`fetch('/api/w/me',{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){return {signedIn:j.signedIn}})`);
    G.shot = await mm.shot('G1-deleted', '#out-st');
    log('G', G);
  }
} catch (e) { R.fatal = String(e && e.stack || e); }
save();
console.log(LABEL, 'cases', JSON.stringify(Object.fromEntries(Object.entries(R.cases).map(([k, v]) => [k, v.pass]))));
process.exit(0);
