// rel-lab.mjs (2026-11-15): the room engine releases v121-v123 checked in a real mobile browser, one room url per run.
// Android Chrome over CDP (PROTO=cdp, adb forward to chrome_devtools_remote) or Mobile Safari on the iOS Simulator over
// ios_webkit_debug_proxy (PROTO=wk, WebKit inspector wrapped in Target.sendMessageToTarget). Nothing is written: the only
// wallet is a page-side stub answering eth_accounts with a PUBLIC burner address (HOLDER env) and refusing every other
// request (4001), so no signature, no keep, no transaction can happen.
//   node rel-lab.mjs <out dir> <label> <chair id> [udid (wk)]
// Env: PROTO cdp|wk, HOLDER (0x.., blank = visitor only), BASE (https://straycucks.com), OS_ITEM (an opensea.io item url:
//      open the real OpenSea page instead and read its player frame; cdp only), HARNESS=1 (with OS_ITEM unset: frame
//      /alive/<id> OpenSea-style at https://opensea.io/__device-lab-harness via CDP Fetch, never sent to OpenSea)
// Steps (each with a screen and a JSON record in <label>.json):
//   2d     #2d: engine version, frames, mode, the page data has no 2D taxi ("tx"), TV state
//   dio    #dio: mode dio, TV channel and painted
//   3d     #3d: TV on Fish tank and painted, the menu's Watch TV row; tap Watch TV: the channel bar "Channel 1 of 5",
//          five Next taps (Night sky, Campfire, Rain, Cats, Fish tank), Previous = Cats, the bar fits the screen
//   hidden #3d&tvch=snow and fireflies: back to Fish tank
//   rm     reduced motion (Android: animator_duration_scale 0 = the OS setting Chrome reads; iOS: WebKit
//          Page.overrideUserPreference PrefersReducedMotion): one still picture until Watch TV, then it moves
//   holder (HOLDER set) #2d: the Room editor's "Add to your room" starts with the Room space card (fits line, SVG plan
//          fits the screen, words 15 px+, buttons 48 px+); the toy cab fold's "Show it in the 2D picture" previews
//          ?room=..toy2d:1 and the 2D page data then has the taxi; a visitor (no stub) sees no card
//   taxi   ?room=toy2d:1#2d as a visitor (the preview link): the 2D taxi is in the page data and on screen
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const [OUT, LABEL, CHAIR, UDID] = process.argv.slice(2);
const PROTO = process.env.PROTO || 'cdp', BASE = process.env.BASE || 'https://straycucks.com';
const HOLDER = /^0x[0-9a-f]{40}$/.test(process.env.HOLDER || '') ? process.env.HOLDER : '';
const OS_ITEM = process.env.OS_ITEM || '', HARNESS = process.env.HARNESS === '1';
const PARTS = (process.env.PARTS || '2d,dio,3d,hidden,rm,holder,taxi').split(',');
if (CHAIR === '1085') throw Error('showcase 1085 is read-only');
mkdirSync(OUT, { recursive: true });
const R = { label: LABEL, proto: PROTO, chair: CHAIR, holder: HOLDER || null, steps: [], console: [], exceptions: [], shots: [] };
const save = () => writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify(R, null, 2));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clip = t => { t = String(t || ''); return t.length > 520 ? t.slice(0, 120) + ' ... ' + t.slice(-400) : t; };
const log = (k, v) => { R.steps.push({ k, v }); save(); console.log(LABEL, k, JSON.stringify(v ?? null).slice(0, 500)); };
const adb = (...a) => { try { return execFileSync('adb', a, { timeout: 30000 }).toString(); } catch (e) { return 'ERR ' + e.message.slice(0, 120); } };

// ---------------------------------------------------------------- transport
// WebKit drops a session's overrides and bootstrap script when the socket closes (run 43750276866: reduce stayed false),
// so attach() sends them again on every new socket
let PREF = null, BOOT = null;
let ws = null, id = 0, target = null, tgUrl = ''; const pending = new Map(); const ctxs = []; const frames = new Map();
const HURL = 'https://opensea.io/__device-lab-harness';
const HARNESS_HTML = src => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenSea-style player</title><style>body{margin:0;background:#121212;color:#ddd;font:14px system-ui}iframe{display:block;width:100vw;height:100vw;border:0;background:#000}p{padding:8px 12px}</style></head><body><iframe id="f" sandbox="allow-scripts" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" src="${src.replace(/"/g, '&quot;')}"></iframe><p>OpenSea-style frame</p><div style="height:2600px">more of the page</div></body></html>`;
const pages = async () => { try { return await (await fetch('http://localhost:9222/json', { signal: AbortSignal.timeout(5000) })).json(); } catch (e) { return []; } };
const onMsg = ev => {
  let m = JSON.parse(ev.data);
  if (PROTO === 'wk') {
    if (m.method === 'Target.targetCreated' && m.params.targetInfo.type === 'page') { target = m.params.targetInfo.targetId; return; }
    if (m.method === 'Target.dispatchMessageFromTarget') m = JSON.parse(m.params.message);
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? { error: m.error }); pending.delete(m.id); return; }
  const p = m.params || {}, sid = m.sessionId || '';
  switch (m.method) {
    case 'Console.messageAdded': { const c = p.message; if (c.level === 'error' || c.level === 'warning') R.console.push({ level: c.level, text: clip(c.text), url: c.url || '' }); break; }
    case 'Runtime.consoleAPICalled': if (p.type === 'error' || p.type === 'warning') R.console.push({ level: p.type, text: clip((p.args || []).map(a => a.value ?? a.description ?? a.type).join(' ')), url: p.stackTrace?.callFrames?.[0]?.url || '' }); break;
    case 'Runtime.exceptionThrown': R.exceptions.push({ text: p.exceptionDetails?.text, desc: (p.exceptionDetails?.exception?.description || '').slice(0, 300), url: p.exceptionDetails?.url || '' }); break;
    case 'Log.entryAdded': if (p.entry.level === 'error') R.console.push({ level: 'log-' + p.entry.source, text: clip(p.entry.text), url: p.entry.url || '' }); break;
    case 'Runtime.executionContextCreated': ctxs.push({ sid, id: p.context.id, frameId: p.context.auxData?.frameId, isDefault: p.context.auxData?.isDefault, origin: p.context.origin }); break;
    case 'Runtime.executionContextsCleared': for (let i = ctxs.length - 1; i >= 0; i--) if (ctxs[i].sid === sid) ctxs.splice(i, 1); break;
    case 'Page.frameNavigated': frames.set(p.frame.id, p.frame.url); break;
    case 'Target.attachedToTarget': { const s = p.sessionId; send('Runtime.enable', {}, s); send('Page.enable', {}, s); send('Page.getFrameTree', {}, s).then(ft => { if (ft?.frameTree) frames.set(ft.frameTree.frame.id, ft.frameTree.frame.url); }); send('Runtime.runIfWaitingForDebugger', {}, s); break; }
    case 'Fetch.requestPaused':
      if (p.request.url.startsWith(HURL)) send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }], body: Buffer.from(HARNESS_HTML(`${BASE}/alive/${CHAIR}#${process.env.HHASH || 'perf'}`)).toString('base64') });
      else send('Fetch.continueRequest', { requestId: p.requestId });
      break;
  }
};
function send(method, params = {}, sid, ms = 20000) {
  return new Promise(r => {
    const i = ++id, t = setTimeout(() => { pending.delete(i); r({ timeout: method }); }, ms); pending.set(i, v => { clearTimeout(t); r(v); });
    const inner = { id: i, method, params }; if (sid) inner.sessionId = sid;
    ws.send(JSON.stringify(PROTO === 'wk' && target ? { id: ++id + 100000, method: 'Target.sendMessageToTarget', params: { targetId: target, message: JSON.stringify(inner) } } : inner));
  });
}
const attach = async match => {
  try { ws && ws.close(); } catch (e) { /* fine */ }
  let pg = null;
  for (let t = 0; t < 30 && !pg; t++) { const all = (await pages()).filter(p => !p.type || p.type === 'page'); pg = all.filter(p => match.test(p.url || '')).pop() || (PROTO === 'cdp' ? all[0] : null); if (!pg) await sleep(2000); }
  if (!pg) { R.fatal = 'no page target for ' + match; save(); process.exit(1); }
  tgUrl = pg.url; target = null; ctxs.length = 0;
  ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; setTimeout(() => bad(new Error('ws timeout')), 10000); });
  ws.onmessage = onMsg; await sleep(1500);
  if (PROTO === 'wk') { await send('Console.enable'); await send('Runtime.enable'); if (PREF) R.motionOverride = await send('Page.overrideUserPreference', { name: 'PrefersReducedMotion', value: PREF }); if (BOOT) await send('Page.setBootstrapScript', { source: BOOT }); }
  else { for (const d of ['Runtime', 'Page', 'Log']) await send(d + '.enable'); await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }); }
};
const frameCtx = () => { const hit = ctxs.filter(c => c.isDefault && /straycucks\.com\/alive\//.test(frames.get(c.frameId) || '')); return hit[hit.length - 1] || null; };
let IN_FRAME = false;
const ev = async (expr, ms = 15000) => {
  const params = { expression: expr, returnByValue: true };
  let c = null;
  if (IN_FRAME) { for (let i = 0; i < 20 && !(c = frameCtx()); i++) await sleep(500); if (!c) return { evalErr: 'no room frame context' }; params.contextId = c.id; }
  const r = await send('Runtime.evaluate', params, c ? c.sid || undefined : undefined, ms);
  if (r?.timeout) return { evalErr: 'timeout' };
  if (r?.wasThrown || r?.exceptionDetails) return { evalErr: (r.result && (r.result.description || r.result.value)) || r.exceptionDetails?.text };
  return r?.result ? r.result.value : { evalErr: JSON.stringify(r).slice(0, 200) };
};
// async in-page work: start it, poll window.__rel (WebKit's evaluate does not await promises)
const evA = async (body, ms = 30000) => { await ev(`(()=>{window.__rel=undefined;(async()=>{${body}})().then(v=>{window.__rel={v}},e=>{window.__rel={e:String(e)}});return 1})()`); const t = Date.now(); for (;;) { const r = await ev('window.__rel'); if (r && (r.v !== undefined || r.e)) return r.e ? { evalErr: r.e } : r.v; if (Date.now() - t > ms) return { evalErr: 'async timeout' }; await sleep(500); } };
let n = 0;
const shot = async name => {
  const f = `${OUT}/${LABEL}-${String(++n).padStart(2, '0')}-${name}`;
  if (PROTO === 'wk') { try { execFileSync('xcrun', ['simctl', 'io', UDID, 'screenshot', f + '.png'], { timeout: 30000 }); R.shots.push(f + '.png'); } catch (e) { R.shots.push(f + '.png FAILED'); } }
  else {
    try { writeFileSync(f + '-adb.png', execFileSync('adb', ['exec-out', 'screencap', '-p'], { timeout: 30000, maxBuffer: 64 << 20 })); R.shots.push(f + '-adb.png'); } catch (e) { R.shots.push(f + '-adb.png FAILED'); }
    const s = await send('Page.captureScreenshot', { format: 'png' }, undefined, 30000); if (s?.data) { writeFileSync(f + '-cdp.png', Buffer.from(s.data, 'base64')); R.shots.push(f + '-cdp.png'); }
  }
  save();
};
// a tap: Android = a real touch at the element's middle (CDP Input), iOS = synthetic pointer events + click (no Input domain)
const tap = async sel => {
  const box = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,r.width,r.height]})()`);
  if (!Array.isArray(box)) return { tapped: false, sel };
  await sleep(400);
  const b2 = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});const r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()`);
  if (PROTO === 'cdp' && !IN_FRAME) {
    const [x, y] = b2; await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(80); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;const o={bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y,pointerId:7,pointerType:'touch',isPrimary:true,button:0,buttons:1};e.dispatchEvent(new PointerEvent('pointerdown',o));e.dispatchEvent(new PointerEvent('pointerup',{...o,buttons:0}));e.click();return 1})()`);
  return { tapped: true, sel, at: b2.map(Math.round), size: box.slice(2).map(Math.round) };
};
const nav = async url => {
  await ev('(()=>{try{sessionStorage.clear()}catch(e){}return 1})()');
  if (PROTO === 'cdp') { await send('Page.navigate', { url: 'about:blank' }); await sleep(1200); await send('Page.navigate', { url }); await sleep(3000); return; }
  await ev(`(()=>{location.href=${JSON.stringify(url)};return 1})()`); await sleep(2500);
  if (url.includes('#')) await ev('(()=>{location.reload();return 1})()').catch(() => {});
  await sleep(8000); await attach(/\/alive\//);
};

// ---------------------------------------------------------------- page probes
const ENG = `(()=>{const s=[...document.scripts].map(s=>s.src).find(s=>/\\/alive\\/v\\d+\\/engine\\.js/.test(s));return s?s.match(/v\\d+/)[0]:null})()`;
const SC = `(()=>{const s=window.__sc;return s?{frames:s.frames,mode:s.mode,sheet:s.sheet||null}:null})()`;
const TV = `(()=>{const t=window.__tvch?window.__tvch.get():null;const w=document.querySelector('[data-sc=watch-tv] small');const bar=document.querySelector('[data-sc=tv-ch]');const r=bar&&bar.getBoundingClientRect();return {tv:t,row:w?w.textContent:null,bar:bar&&r.height>0?bar.innerText.replace(/\\s+/g,' ').slice(0,120):null,barBox:bar&&r.height>0?[Math.round(r.left),Math.round(r.right),Math.round(r.top),Math.round(r.bottom)]:null}})()`;
const PIC = `(()=>{const p=window.__tvc&&window.__tvc.px;if(!p||!p.canvas)return null;let s;try{s=p.canvas.toDataURL()}catch(e){return 'taint'}let h=5381;for(let i=0;i<s.length;i+=7)h=((h*33)^s.charCodeAt(i))>>>0;return h.toString(16)+':'+s.length})()`;
const DATA = `(()=>{const t=[...document.scripts].map(s=>s.textContent).find(x=>/StrayAlive\\(\\{/.test(x))||'';return {tx:/"tx":\\{/.test(t),tvc:(t.match(/"tvc":"([a-z]+)"/)||[])[1]||null,ho:(t.match(/"ho":"(0x[0-9a-f]{40})"/)||[])[1]||null}})()`;
const PROBE = `(()=>({ua:navigator.userAgent,iw:innerWidth,ih:innerHeight,dpr:devicePixelRatio,coarse:matchMedia('(pointer: coarse)').matches,reduce:matchMedia('(prefers-reduced-motion: reduce)').matches,href:location.href}))()`;
const OVERFLOW = `(()=>({sw:document.documentElement.scrollWidth,iw:innerWidth,errText:((document.body&&document.body.innerText)||'').match(/(could not start|something went wrong|error)[^\\n]{0,80}/i)?.[0]||null}))()`;
const ready = async (want, s = 60) => { let sc = null; for (let i = 0; i < s; i++) { sc = await ev(SC); if (sc && !sc.evalErr && sc.frames > 5 && (!want || sc.mode === want)) break; await sleep(1000); } return sc; };
const tvWait = async (s = 60) => { let t = null; for (let i = 0; i < s; i++) { t = await ev(TV); if (t?.tv && (t.tv.drawn || t.tv.ch === 'cats')) break; await sleep(1000); } return t; };
const STUB = A => `(()=>{const A=${JSON.stringify([A])};const eth={isMetaMask:true,on(){},removeListener(){},async request({method}){if(method==='eth_accounts')return A;if(method==='eth_chainId')return '0x1237';const e=new Error('device lab stub: asks for nothing');e.code=4001;throw e}};try{Object.defineProperty(window,'ethereum',{value:eth,configurable:true})}catch(e){window.ethereum=eth}return !!window.EvmWallet&&window.EvmWallet.list().length})()`;
const watchTv = async () => { const a = await tap('.scf'); await sleep(900); const b = await tap('[data-sc=watch-tv]'); await sleep(9000); return { menu: a, watch: b }; };
const motion = async v => { if (PROTO === 'cdp') { R.motionVia = 'adb settings animator_duration_scale'; for (const k of ['animator_duration_scale', 'transition_animation_scale', 'window_animation_scale']) adb('shell', 'settings', 'put', 'global', k, v ? '1' : '0'); } else { R.motionVia = 'WebKit Page.overrideUserPreference'; PREF = v ? null : 'Reduce'; R.motionOverride = await send('Page.overrideUserPreference', v ? { name: 'PrefersReducedMotion' } : { name: 'PrefersReducedMotion', value: 'Reduce' }); } };

// ---------------------------------------------------------------- the real OpenSea item page / the harness frame
if (OS_ITEM || HARNESS) {
  await attach(/./);
  if (HARNESS) await send('Fetch.enable', { patterns: [{ urlPattern: HURL + '*' }] });
  await motion(true);
  await nav(OS_ITEM || HURL); await sleep(25000);
  R.top = await ev(PROBE); log('top', R.top);
  const tree = await send('Page.getFrameTree'); const walk = (f, out = []) => { if (!f) return out; out.push(f.frame.url); (f.childFrames || []).forEach(c => walk(c, out)); return out; };
  R.frameUrls = [...new Set([...walk(tree?.frameTree), ...frames.values()])]; log('frames', R.frameUrls);
  await shot('top');
  IN_FRAME = true;
  const c = frameCtx(); log('roomFrame', c ? { origin: c.origin, url: frames.get(c.frameId) } : null);
  if (c) {
    R.engine = await ev(ENG); R.sc = await ready(null, 60); R.tvState = await tvWait(60); R.pic = await ev(PIC); await sleep(2500); R.pic2 = await ev(PIC);
    R.storageBlocked = await ev(`(()=>{try{sessionStorage.getItem('x');return false}catch(e){return true}})()`);
    log('player', { engine: R.engine, sc: R.sc, tv: R.tvState, moving: R.pic !== R.pic2, storageBlocked: R.storageBlocked });
    IN_FRAME = false; await ev('scrollTo(0,1800)'); await sleep(2500); IN_FRAME = true;
    const away = await ev(TV), q1 = await ev(PIC); await sleep(2500); const q2 = await ev(PIC);
    log('scrolledAway', { tv: away?.tv, still: q1 === q2 }); await shot('scrolled');
    IN_FRAME = false; await ev('scrollTo(0,0)'); await sleep(3000); IN_FRAME = true;
    const back = await ev(TV), q3 = await ev(PIC); await sleep(2500); const q4 = await ev(PIC);
    log('scrolledBack', { tv: back?.tv, moving: q3 !== q4 }); await shot('back');
  }
  log('done', { console: R.console.length, exceptions: R.exceptions.length }); ws.close(); process.exit(0);
}

// ---------------------------------------------------------------- the room page
const U = (q, h) => `${BASE}/alive/${CHAIR}${q || ''}#${h}`;
await attach(PROTO === 'wk' ? /\/alive\// : /./);
await motion(true);
if (PARTS.includes('2d')) {
  await nav(U('', '2d&perf')); const sc = await ready('2d');
  log('2d', { probe: await ev(PROBE), engine: await ev(ENG), sc, data: await ev(DATA), tv: await ev(TV), layout: await ev(OVERFLOW) }); await shot('2d');
}
if (PARTS.includes('dio')) {
  await nav(U('', 'dio&perf')); const sc = await ready('dio', 90); const tv = await tvWait(60); await sleep(4000);
  log('dio', { engine: await ev(ENG), sc, tv, layout: await ev(OVERFLOW) }); await shot('dio');
}
if (PARTS.includes('3d')) {
  await nav(U('', '3d&perf')); const sc = await ready('3d', 90); const tv0 = await tvWait(60); await sleep(3000);
  const p1 = await ev(PIC); await sleep(2500); const p2 = await ev(PIC);
  log('3d', { engine: await ev(ENG), probe: await ev(PROBE), sc, tv: tv0, moving: p1 !== p2, pics: [p1, p2] }); await shot('3d');
  const w = await watchTv(); const b0 = await ev(TV); log('watchTv', { taps: w, after: b0 }); await shot('3d-watch-bar');
  const seen = [];
  for (let k = 0; k < 5; k++) { const t = await tap('[data-sc=tv-ch-next]'); await sleep(1800); seen.push({ tap: t.tapped, name: await ev(`(document.querySelector('[data-sc=tv-ch] [data-k=name]')||{}).textContent||null`), tv: (await ev(TV))?.tv?.ch }); if (k === 0 || k === 2) await shot('3d-next' + (k + 1)); }
  await tap('[data-sc=tv-ch-prev]'); await sleep(1200);
  log('channels', { seen, prev: await ev(`(document.querySelector('[data-sc=tv-ch] [data-k=name]')||{}).textContent||null`), bar: await ev(TV), layout: await ev(OVERFLOW) });
}
if (PARTS.includes('hidden')) for (const h of ['snow', 'fireflies']) {
  await nav(U('', '3d&perf&tvch=' + h)); await ready('3d', 90); const t = await tvWait(45); log('hidden-' + h, t);
}
if (PARTS.includes('rm')) {
  await motion(false); await nav(U('', '3d&perf')); const sc = await ready('3d', 90); const t = await tvWait(60); await sleep(3000);
  const a = await ev(PIC); await sleep(3000); const b = await ev(PIC);
  log('reduced', { probe: await ev(PROBE), sc, tv: t?.tv, still: a === b, pics: [a, b] }); await shot('rm-before-watch');
  const w = await watchTv(); const c = await ev(PIC); await sleep(3000); const d = await ev(PIC);
  log('reducedWatch', { taps: w, tv: (await ev(TV))?.tv, moving: c !== d, pics: [c, d] }); await shot('rm-after-watch');
  await motion(true);
}
if (PARTS.includes('holder')) {
  await nav(U('', '2d&perf')); await ready('2d');
  // visitor first (no stub): no card
  await ev(`window.__sc&&window.__sc.edit('room')`); await sleep(2500);
  const vis = await ev(`(()=>{const c=document.querySelector('[data-sc=room-space]');return {card:!!c,shown:!!c&&!c.hidden&&c.getBoundingClientRect().height>0}})()`);
  log('visitorCard', vis); await shot('visitor-editor');
  if (HOLDER) {
    const boot = PROTO === 'cdp' ? await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB(HOLDER) }) : await send('Page.setBootstrapScript', { source: (BOOT = STUB(HOLDER)) });
    R.stubBoot = boot;
    await nav(U('', '2d&perf')); await ready('2d');
    const listed = await ev(`(()=>({eth:!!window.ethereum,list:window.EvmWallet?window.EvmWallet.list().length:null}))()`); await sleep(500);
    await ev(`window.__sc&&window.__sc.edit('room')`); await sleep(3000);
    const card = await ev(`(()=>{const c=document.querySelector('[data-sc=room-space]');if(!c)return {card:false};c.scrollIntoView({block:'start'});const h=[...document.querySelectorAll('h3')].find(x=>x.textContent==='Add to your room');const s=c.querySelector('svg');const r=s&&s.getBoundingClientRect();
      return {card:true,shown:!c.hidden&&c.getBoundingClientRect().height>0,firstUnderHeading:!!h&&h.nextElementSibling===c,title:(c.querySelector('h3')||{}).textContent||null,
        fits:(c.querySelector('[data-sc=room-fits]')||{}).textContent||null,mix:(c.querySelector('[data-sc=room-mix]')||{}).textContent||null,help:(c.querySelector('[data-sc=room-help]')||{}).textContent||null,
        sizes:[...c.querySelectorAll('p,h3,button')].map(e=>parseFloat(getComputedStyle(e).fontSize)),btns:[...c.querySelectorAll('button')].map(e=>{const b=e.getBoundingClientRect();return [Math.round(b.width),Math.round(b.height)]}),
        svg:s?{rects:s.querySelectorAll('rect').length,w:Math.round(r.width),h:Math.round(r.height),fits:r.left>=-0.5&&r.right<=innerWidth+0.5}:null}})()`);
    await sleep(800); log('holderCard', { stubListed: listed, ...card }); await shot('holder-room-space');
    await ev(`(()=>{const s=document.querySelector('[data-sc=room-plan]')||document.querySelector('[data-sc=room-space] svg');s&&s.scrollIntoView({block:'center'});return 1})()`); await sleep(800); await shot('holder-room-plan');
    // the toy cab fold's 2D switch
    const fold = await ev(`(()=>{const d=document.querySelector('details[data-room-item=toy]');if(!d)return {fold:false};d.open=true;const b=d.querySelector('[data-sc=toy2d-switch]');b&&b.scrollIntoView({block:'center'});const r=b&&b.getBoundingClientRect();return {fold:true,switch:b?b.textContent:null,pressed:b?b.getAttribute('aria-pressed'):null,size:r?[Math.round(r.width),Math.round(r.height)]:null,font:b?parseFloat(getComputedStyle(b).fontSize):null}})()`);
    await sleep(600); log('taxiFold', fold); await shot('holder-taxi-switch');
    if (fold.switch) {
      const before = await ev('location.href'); const t = await tap('[data-sc=toy2d-switch]'); await sleep(6000);
      if (PROTO === 'wk') await attach(/\/alive\//);
      const after = await ev('location.href'); await ready(null, 40);
      log('taxiSwitched', { tap: t, before, after, room: (() => { try { return new URL(after).searchParams.get('room'); } catch (e) { return null; } })(), data: await ev(DATA) });
      await ev(`(()=>{const d=document.querySelector('details[data-room-item=toy]');if(d){d.open=true;d.querySelector('[data-sc=toy2d-switch]')?.scrollIntoView({block:'center'})}return 1})()`); await sleep(800);
      log('taxiSwitchNow', await ev(`(()=>{const b=document.querySelector('[data-sc=toy2d-switch]');return b?[b.textContent,b.getAttribute('aria-pressed')]:null})()`)); await shot('holder-taxi-on');
    }
  }
}
if (R.stubBoot) { if (PROTO === 'cdp') await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: R.stubBoot.identifier }); else { BOOT = null; await send('Page.setBootstrapScript', {}); } }
if (PARTS.includes('taxi')) {
  await nav(U('?room=toy2d:1', '2d&perf')); const sc = await ready('2d'); await sleep(2500);
  log('taxiPreview', { sc, data: await ev(DATA), href: await ev('location.href') }); await shot('taxi-2d');
}
log('done', { console: R.console.length, exceptions: R.exceptions.length });
try { ws.close(); } catch (e) { /* fine */ }
process.exit(0);
