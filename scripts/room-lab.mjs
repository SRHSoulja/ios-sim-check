// room-lab.mjs (2026-11-14): drive a Stray Cucks room page over raw CDP the way a phone user would, and record what
// happened. Works on Android Chrome / Chromium / a WebView (adb forward to its devtools socket) and on a desktop Chrome
// (EMULATE=1: 390x844 DPR 2 touch, e.g. the VE's Chrome over ve-tunnel.sh). Node 22 (global WebSocket, fetch).
//   node room-lab.mjs <cdp base, e.g. http://localhost:9222> <out dir> <label> <url>
// Env: TARGET_MATCH=<text> pick the page target whose url contains it (a wallet's in-app browser), HARNESS=1 open the url inside an OpenSea-style frame (sandbox="allow-scripts" + OpenSea's allow list, served by
//      CDP Fetch on https://opensea-harness.test/), ADB=1 also take emulator screencaps (adb exec-out screencap -p),
//      NOFACE=1 tap the computer as soon as it is on screen (even from behind), CPU=<n> CDP CPU throttling (n x slower),
//      EMULATE=1 phone metrics on a desktop Chrome, NEWTAB=1 open a new target (desktop), READY_S (default 90) seconds.
// Steps: load, feature probe (the engine's own three checks), open "+ Room menu", tap DIORAMA, close the menu, wait for
// the Diorama, probe the live monitor (window.__hpc, needs #perf in the url), tap the computer's middle (from
// window.__pois + __roomItems.project, or the live surface's middle), wait for the close-up (__hpc.z.k == 1) or the
// Computer sheet (__sc.sheet), measure frame times (rAF deltas and engine frames over 6 s), read the close-up's text
// sizes, "‹ Room" and "+ Room menu" boxes, tap "‹ Room" and check the way back. Screens at every step: <label>-NN-<step>.png
// (Chrome's own frame) and, with ADB=1, <label>-NN-<step>-adb.png (the emulator display). All results in <label>.json.
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const [BASE, OUT, LABEL, URL0] = process.argv.slice(2);
const HARNESS = process.env.HARNESS === '1', EMU = process.env.EMULATE === '1', ADB = process.env.ADB === '1';
const READY_S = Number(process.env.READY_S || 90);
mkdirSync(OUT, { recursive: true });
const R = { label: LABEL, url: URL0, harness: HARNESS, emulate: EMU, steps: [], errors: [], exceptions: [], shots: [] };
const save = () => writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify(R, null, 2));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (k, v) => { R.steps.push({ k, v }); save(); console.log(LABEL, k, JSON.stringify(v ?? null).slice(0, 400)); };
const HARNESS_HTML = src => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenSea-style player</title><style>body{margin:0;background:#121212;color:#ddd;font:14px system-ui}iframe{display:block;width:100vw;height:100vw;border:0;background:#000}p{padding:8px 12px}</style></head>
<body><iframe id="f" sandbox="allow-scripts" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" src="${src.replace(/"/g, '&quot;')}"></iframe>
<p>OpenSea-style frame: sandbox="allow-scripts", allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"</p></body></html>`;

// ---- target
let tg;
for (let t = 0; t < 15 && !tg; t++) {
  try {
    if (process.env.NEWTAB === '1' && t === 0) tg = await (await fetch(BASE + '/json/new?about:blank', { method: 'PUT', signal: AbortSignal.timeout(8000) })).json();
    else { const all = (await (await fetch(BASE + '/json', { signal: AbortSignal.timeout(5000) })).json()).filter(x => x.type === 'page'); R.targets = all.map(x => x.url); tg = (process.env.TARGET_MATCH && all.find(x => x.url.includes(process.env.TARGET_MATCH))) || all[0]; }
  } catch (e) { R.targetErr = String(e); }
  if (!tg) await sleep(2000);
}
if (!tg) { R.fatal = 'no page target'; save(); process.exit(1); }
R.target = tg.url;
const ws = new WebSocket(tg.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; setTimeout(() => bad(new Error('ws open timeout')), 10000); });
let id = 0; const pending = new Map();
const send = (method, params = {}, sid, ms = 20000) => new Promise(r => { const i = ++id; const t = setTimeout(() => { pending.delete(i); r({ timeout: method }); }, ms); pending.set(i, v => { clearTimeout(t); r(v); }); const m = { id: i, method, params }; if (sid) m.sessionId = sid; ws.send(JSON.stringify(m)); });
const ctxs = []; const frames = new Map();
ws.onmessage = async ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? { error: m.error }); pending.delete(m.id); return; }
  const p = m.params || {}, sid = m.sessionId || '';
  switch (m.method) {
    case 'Runtime.executionContextCreated': ctxs.push({ sid, id: p.context.id, frameId: p.context.auxData?.frameId, isDefault: p.context.auxData?.isDefault, origin: p.context.origin }); break;
    case 'Runtime.executionContextDestroyed': { const i = ctxs.findIndex(c => c.sid === sid && c.id === p.executionContextId); if (i >= 0) ctxs.splice(i, 1); break; }
    case 'Runtime.executionContextsCleared': for (let i = ctxs.length - 1; i >= 0; i--) if (ctxs[i].sid === sid) ctxs.splice(i, 1); break;
    case 'Page.frameNavigated': frames.set(p.frame.id, p.frame.url); break;
    case 'Runtime.consoleAPICalled': if (p.type === 'error' || p.type === 'assert') R.errors.push({ sid: !!sid, text: (p.args || []).map(a => a.value ?? a.description ?? a.type).join(' ').slice(0, 300) }); break;
    case 'Runtime.exceptionThrown': R.exceptions.push({ sid: !!sid, text: p.exceptionDetails?.text, desc: (p.exceptionDetails?.exception?.description || '').slice(0, 300) }); break;
    case 'Target.attachedToTarget': {
      const s = p.sessionId; R.oopif = (R.oopif || 0) + 1;
      send('Runtime.enable', {}, s); send('Page.enable', {}, s); send('Page.getFrameTree', {}, s).then(ft => { if (ft?.frameTree) frames.set(ft.frameTree.frame.id, ft.frameTree.frame.url); });
      send('Runtime.runIfWaitingForDebugger', {}, s); break; }
    case 'Fetch.requestPaused':
      if (/^https:\/\/opensea-harness\.test\//.test(p.request.url)) send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }], body: Buffer.from(HARNESS_HTML(URL0)).toString('base64') });
      else send('Fetch.continueRequest', { requestId: p.requestId });
      break;
  }
};
for (const d of ['Runtime', 'Page', 'Log']) await send(d + '.enable');
await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
if (EMU) {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}
if (process.env.CPU) { R.cpuThrottle = Number(process.env.CPU); await send('Emulation.setCPUThrottlingRate', { rate: R.cpuThrottle }); }
if (HARNESS) await send('Fetch.enable', { patterns: [{ urlPattern: 'https://opensea-harness.test/*' }] });
// the room's frame: the top page, or (HARNESS) the frame whose url is the room's
const roomCtx = () => {
  if (!HARNESS) return null;
  const hit = ctxs.filter(c => c.isDefault && /straycucks\.com\/alive\//.test(frames.get(c.frameId) || ''));
  return hit[hit.length - 1] || null;
};
const evalIn = async (expr, ms = 15000) => {
  let c = null;
  if (HARNESS) { for (let i = 0; i < 20 && !(c = roomCtx()); i++) await sleep(500); if (!c) return { evalErr: 'no room frame context' }; }
  const params = { expression: expr, returnByValue: true, timeout: ms - 1000 };
  if (c) params.contextId = c.id;
  const r = await send('Runtime.evaluate', params, c ? c.sid || undefined : undefined, ms);
  if (r?.timeout) return { evalErr: 'timeout' };
  if (r?.exceptionDetails) return { evalErr: (r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 300) };
  return r?.result?.value;
};
const evalTop = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true }))?.result?.value;
// the room frame's offset in the top page (0,0 without HARNESS)
const off = async () => HARNESS ? (await evalTop("(()=>{const r=document.getElementById('f').getBoundingClientRect();return [r.left,r.top]})()")) || [0, 0] : [0, 0];
let shotN = 0;
const shot = async name => {
  const n = String(++shotN).padStart(2, '0'), base = `${OUT}/${LABEL}-${n}-${name}`;
  const s = await send('Page.captureScreenshot', { format: 'png' }, undefined, 60000);
  if (s?.data) { writeFileSync(base + '.png', Buffer.from(s.data, 'base64')); R.shots.push(base + '.png'); } else R.shots.push(base + '.png FAILED ' + JSON.stringify(s).slice(0, 120));
  if (ADB) { try { writeFileSync(base + '-adb.png', execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64e6, timeout: 20000 })); R.shots.push(base + '-adb.png'); } catch (e) { R.shots.push(base + '-adb.png FAILED'); } }
  save();
};
// a real touch tap through the browser's input pipeline, at room-frame CSS px
const tap = async (x, y) => {
  const [ox, oy] = await off(), X = x + ox, Y = y + oy;
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: X, y: Y, id: 1, radiusX: 6, radiusY: 6, force: 1 }] });
  await sleep(70);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return [Math.round(X), Math.round(Y)];
};
const rectOf = sel => evalIn(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect(),cs=getComputedStyle(e);return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2,display:cs.display,vis:cs.visibility,op:cs.opacity,text:(e.textContent||'').trim().slice(0,40),font:cs.fontSize,shown:r.width>0&&r.height>0&&cs.display!=='none'&&cs.visibility!=='hidden'&&+cs.opacity>0.05}})()`);
const SC = `(()=>{const s=window.__sc;if(!s)return null;return {frames:s.frames,mode:s.mode,sheet:s.sheet,screen:s.screen}})()`;
const HPC = `(()=>{const s=window.__hpc;if(!s)return {hpc:typeof s,el:!!document.getElementById('sc-pchtml')};const z=s.z||{};
  const P=(x,y)=>{const e=s.M.elements,X=e[0]*x+e[4]*y+e[12],Y=e[1]*x+e[5]*y+e[13],W=e[3]*x+e[7]*y+e[15];return [X/W,Y/W]};
  const c=[[0,0],[s.EW,0],[s.EW,s.EH],[0,s.EH]].map(q=>P(...q).map(Math.round));
  return {hpc:'object',painted:s.painted,shown:s.shown,front:s.front,live:s.live,err:s.lastError,EW:s.EW,EH:s.EH,z:{on:z.on,k:z.k!=null?+z.k.toFixed(3):null},corners:c,mid:P(s.EW/2,s.EH/2).map(Math.round),
    onScreenW:Math.round(Math.hypot(c[1][0]-c[0][0],c[1][1]-c[0][1]))}})()`;

// ---- 1 load
const t0 = Date.now();
await send('Page.navigate', { url: HARNESS ? 'https://opensea-harness.test/' : URL0 });
let sc = null;
for (let i = 0; i < READY_S; i++) { await sleep(1000); sc = await evalIn(SC, 8000); if (sc && sc.frames > 5) break; }
log('ready', { sc, secs: Math.round((Date.now() - t0) / 1000) });
R.probe = await evalIn(`(()=>{const c=document.createElement('canvas');c.setAttribute('content','drawable');
  const W1=window.WebGLRenderingContext&&WebGLRenderingContext.prototype,W2=window.WebGL2RenderingContext&&WebGL2RenderingContext.prototype;
  let framed;try{framed=window.top!==window&&window.top.location.origin!==location.origin}catch(e){framed=true}
  return {ua:navigator.userAgent,canvasContent:c.content===undefined?'undefined':c.content,updateElementGeometry:typeof HTMLCanvasElement.prototype.updateElementGeometry,
    texElementSubImage2D_gl1:typeof (W1&&W1.texElementSubImage2D),texElementSubImage2D_gl2:typeof (W2&&W2.texElementSubImage2D),drawElementImage:typeof (window.CanvasRenderingContext2D&&CanvasRenderingContext2D.prototype.drawElementImage),
    framed,origin:location.origin,hash:location.hash,iw:innerWidth,ih:innerHeight,dpr:devicePixelRatio,coarse:matchMedia('(pointer: coarse)').matches,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches}})()`);
R.probe.engineWouldGoLive = R.probe && R.probe.canvasContent === 'drawable' && R.probe.updateElementGeometry === 'function' && (R.probe.texElementSubImage2D_gl1 === 'function' || R.probe.texElementSubImage2D_gl2 === 'function') && !R.probe.framed;
log('probe', R.probe);
await shot('loaded');

// ---- 2 Diorama through the menu
const pill = await rectOf('[data-sc=room-menu-pill]');
log('pill', pill);
if (sc && sc.mode !== 'dio' && pill) {
  await tap(pill.cx, pill.cy); await sleep(1200);
  const dioB = await rectOf('[data-mode=dio]');
  log('dioButton', dioB);
  await shot('menu-open');
  if (dioB && dioB.shown) { await tap(dioB.cx, dioB.cy); await sleep(1500); }
  const p2 = await rectOf('[data-sc=room-menu-pill]');
  const exp = await evalIn(`document.querySelector('[data-sc=room-menu-pill]')?.getAttribute('aria-expanded')`);
  if (exp === 'true' && p2) { await tap(p2.cx, p2.cy); await sleep(800); }
}
let hp = null;
for (let i = 0; i < READY_S; i++) {
  await sleep(1000); sc = await evalIn(SC, 8000); hp = await evalIn(HPC, 8000);
  if (sc && sc.mode === 'dio' && (await evalIn('!!window.__dio'))) { if (!hp || hp.hpc !== 'object' || hp.painted || i > 40) { if (i > 4) break; } }
}
await sleep(3000); hp = await evalIn(HPC); sc = await evalIn(SC);
log('diorama', { sc, hpc: hp, dioFailed: await evalIn(`(document.body.innerText||'').match(/Diorama could not start[^\\n]*/)?.[0]||null`) });
await shot('diorama');

// ---- 3 frame times in the room view
const FT = `new Promise(res=>{const d=[];let last=performance.now();const f0=(window.__sc||{}).frames||0;const T0=last;
  const step=t=>{d.push(t-last);last=t;if(t-T0<6000)requestAnimationFrame(step);else{d.sort((a,b)=>a-b);const q=p=>+d[Math.min(d.length-1,Math.floor(p*d.length))].toFixed(1);
  res({n:d.length,fps:+(d.length/((t-T0)/1000)).toFixed(1),p50:q(0.5),p95:q(0.95),max:+d[d.length-1].toFixed(1),engineFrames:((window.__sc||{}).frames||0)-f0,perf:window.__perf?{calls:window.__perf.calls,tris:Math.round(window.__perf.tris||0)}:null})}};requestAnimationFrame(step)})`;
const ftEval = async () => { const r = await send('Runtime.evaluate', { expression: FT, awaitPromise: true, returnByValue: true, ...(HARNESS && roomCtx() ? { contextId: roomCtx().id } : {}) }, HARNESS && roomCtx() ? roomCtx().sid || undefined : undefined, 30000); return r?.result?.value ?? r; };
R.framesRoom = await ftEval(); log('framesRoom', R.framesRoom);

// ---- 4 tap the computer
const comp = await evalIn(`(()=>{const q=(window.__pois?window.__pois():[]).find(q=>q.id==='computer');if(!q)return {why:'no __pois computer (needs #perf)'};const m=window.__roomItems&&window.__roomItems.project({x:q.c[0],y:q.c[1],d:q.c[2]});return {c:q.c,m:m&&m.map(Math.round)}})()`);
log('computer', comp);
const vp = [R.probe?.iw || 390, R.probe?.ih || 844];
const onScr = m => m && m[0] > 4 && m[1] > 4 && m[0] < vp[0] - 4 && m[1] < vp[1] - 60;
// a pinch (two real touch points) about the view's middle: from d0 to d1 px apart (d1 < d0: fingers together = zoom out)
const pinch = async (d0, d1, cy) => {
  const [ox, oy] = await off(), cx = vp[0] / 2 + ox, Y = cy + oy, N = 12;
  const pts = d => [{ x: cx - d / 2, y: Y, id: 1, radiusX: 6, radiusY: 6, force: 1 }, { x: cx + d / 2, y: Y, id: 2, radiusX: 6, radiusY: 6, force: 1 }];
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
  for (let i = 1; i <= N; i++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + ((d1 - d0) * i) / N) }); await sleep(40); }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const drag1 = async (x0, y0, dx, dy) => {
  const [ox, oy] = await off(), N = 12, pt = (x, y) => [{ x: x + ox, y: y + oy, id: 1, radiusX: 6, radiusY: 6, force: 1 }];
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0, y0) });
  for (let i = 1; i <= N; i++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + (dx * i) / N, y0 + (dy * i) / N) }); await sleep(40); }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const COMP = `(()=>{const q=(window.__pois?window.__pois():[]).find(q=>q.id==='computer');if(!q)return null;const m=window.__roomItems.project({x:q.c[0],y:q.c[1],d:q.c[2]});return m&&m.map(Math.round)})()`;
// the opening phone frame may not show the computer: zoom out with pinches (as a visitor would), then orbit if needed
R.find = [];
let cm = comp && comp.m;
const facing = h => process.env.NOFACE === '1' || !h || h.hpc !== 'object' || h.front;   // the live screen (when there is one) must face the camera
let pinches = 0;
for (let g = 0; g < 14 && !(onScr(cm) && facing(hp)); g++) {
  let gest = 'drag'; if (!onScr(cm) && pinches < 3) { pinches++; gest = 'pinch-out'; await pinch(260, 60, vp[1] * 0.45); } else await drag1(vp[0] * 0.25, vp[1] * 0.4, Number(process.env.DRAG_DX || 90), 0);
  for (let i = 0; i < 20; i++) { await sleep(800); if ((await evalIn(SC))?.frames) break; }
  await sleep(2500); cm = await evalIn(COMP); hp = await evalIn(HPC);
  R.find.push({ g, gesture: gest, front: hp && hp.front, computer: cm, cam: await evalIn('window.__sc.cam()'), monitorW: hp && hp.front ? hp.onScreenW : null });
  log('find', R.find[R.find.length - 1]);
}
if (R.find.length) await shot('zoomed-out');
hp = await evalIn(HPC);
let at = hp && hp.hpc === 'object' && hp.front && hp.mid && onScr(hp.mid) ? hp.mid : cm;
R.monitorOnScreenW = hp && hp.front ? hp.onScreenW : null;
if (at && !onScr(at)) { log('computerOffScreen', at); at = null; }
if (at) {
  await evalIn(`(()=>{const m=document.createElement('div');m.className='tapmark';m.style.cssText='position:fixed;left:${at[0] - 14}px;top:${at[1] - 14}px;width:24px;height:24px;border:3px solid #3fe0ff;border-radius:50%;z-index:99;pointer-events:none';document.body.appendChild(m)})()`);
  await shot('before-tap'); await evalIn(`document.querySelectorAll('.tapmark').forEach(m=>m.remove())`);
  R.tapAt = await tap(at[0], at[1]);
  let res = null;
  for (let i = 0; i < 60; i++) {
    await sleep(700); hp = await evalIn(HPC, 8000); sc = await evalIn(SC, 8000);
    if (sc && sc.sheet) { res = 'sheet:' + sc.sheet; break; }
    if (hp && hp.z && hp.z.on && hp.z.k === 1 && hp.live) { res = 'closeup'; break; }
  }
  R.tapResult = res || 'nothing'; log('tapResult', { res: R.tapResult, sc, hpc: hp });
  await sleep(1500); await shot(res === 'closeup' ? 'closeup' : res ? 'sheet' : 'after-tap');
  if (res === 'closeup') {
    R.framesCloseup = await ftEval(); log('framesCloseup', R.framesCloseup);
    R.closeupUi = {
      back: await rectOf('[data-sc=pc-back]'), pill: await rectOf('[data-sc=room-menu-pill]'),
      text: await evalIn(`(()=>{const s=window.__hpc,f=s&&s.el.querySelector('iframe'),d=f&&f.contentDocument;if(!d)return {why:'no same-origin frame doc'};
        const P=(x,y)=>{const e=s.M.elements,X=e[0]*x+e[4]*y+e[12],Y=e[1]*x+e[5]*y+e[13],W=e[3]*x+e[7]*y+e[15];return [X/W,Y/W]};
        const a=P(0,0),b=P(s.EW,0),scale=Math.hypot(b[0]-a[0],b[1]-a[1])/s.EW;const seen=new Map();
        for(const e of d.querySelectorAll('body *')){const t=[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(' ').trim();if(!t)continue;const r=e.getBoundingClientRect();if(r.width<1||r.bottom<0||r.top>s.EH)continue;
          const fs=parseFloat(getComputedStyle(e).fontSize);const k=fs.toFixed(1);if(!seen.has(k))seen.set(k,{cssPx:fs,onScreenPx:+(fs*scale).toFixed(1),sample:t.slice(0,40),n:0});seen.get(k).n++}
        return {scale:+scale.toFixed(3),sizes:[...seen.values()].sort((x,y)=>x.cssPx-y.cssPx),scrollH:d.documentElement.scrollHeight,EH:s.EH}})()`),
    };
    log('closeupUi', R.closeupUi);
    const b = R.closeupUi.back;
    if (b && b.shown) {
      await tap(b.cx, b.cy);
      for (let i = 0; i < 40; i++) { await sleep(600); hp = await evalIn(HPC, 8000); if (hp && hp.z && !hp.z.on && hp.z.k === 0) break; }
      R.backResult = { hpc: hp, back: await rectOf('[data-sc=pc-back]') }; log('back', R.backResult);
      await sleep(1000); await shot('back-in-room');
    }
  } else if (res && res.startsWith('sheet')) {
    R.sheetText = await evalIn(`(()=>{const s=document.querySelector('.on[data-obj]')||document.querySelector('[data-obj]');return s?(s.innerText||'').slice(0,400):null})()`);
    log('sheetText', R.sheetText);
  }
}
R.secs = Math.round((Date.now() - t0) / 1000);
log('done', { errors: R.errors.length, exceptions: R.exceptions.length, oopif: R.oopif || 0 });
ws.close(); process.exit(0);
