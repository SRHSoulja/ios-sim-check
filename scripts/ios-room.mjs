// ios-room.mjs (2026-11-14): the room computer check in Mobile Safari on an iOS Simulator, through ios_webkit_debug_proxy
// (iwdp -s unix:<webinspectord_sim.socket>, pages on http://localhost:9222/json). WebKit's inspector protocol, wrapped in
// Target.sendMessageToTarget since iOS 12.2. Screens with `xcrun simctl io <udid> screenshot`. Taps are SYNTHETIC
// pointer events dispatched in the page (WebKit's inspector has no Input domain on iOS): they test the engine's logic
// in WebKit, not iOS touch handling; label results that way.
//   node ios-room.mjs <out dir> <label> <udid> <room url (loaded and reloaded in the /alive/ tab)>
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const [OUT, LABEL, UDID, MATCH] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const R = { label: LABEL, steps: [], console: [], shots: [], synthetic: true };
const save = () => writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify(R, null, 2));
const log = (k, v) => { R.steps.push({ k, v }); save(); console.log(LABEL, k, JSON.stringify(v ?? null).slice(0, 400)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// MATCH is the room url itself. Safari keeps the warm-up tab and may take a hash-only openurl as a same-page jump
// (run 43656486913 read the warm-up homepage and the old hash), so: attach to the /alive/ tab, load MATCH there, reload,
// then attach again
let pages = [], pg = null, ws = null, id = 0, target = null; const pending = new Map();
const list = async () => { try { pages = await (await fetch('http://localhost:9222/json', { signal: AbortSignal.timeout(4000) })).json(); } catch (e) { R.listErr = String(e); pages = []; } return pages; };
const attach = async () => {
  for (let t = 0; t < 30; t++) { await list(); pg = pages.filter(p => /\/alive\//.test(p.url || '')).pop(); if (pg) break; await sleep(2000); }
  R.pages = pages.map(p => p.url); if (!pg) { R.fatal = 'no /alive/ page from iwdp'; save(); process.exit(1); }
  target = null; ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; setTimeout(() => bad(new Error('ws timeout')), 10000); });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Target.targetCreated' && m.params.targetInfo.type === 'page') { target = m.params.targetInfo.targetId; return; }
    if (m.method === 'Target.dispatchMessageFromTarget') { const x = JSON.parse(m.params.message); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); } else if (x.method === 'Console.messageAdded') { const c = x.params.message; if (c.level === 'error' || c.level === 'warning') R.console.push({ level: c.level, text: (c.text || '').slice(0, 300) }); } return; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await sleep(1500);
};
await attach();
R.wrapped = !!target;
const send = (method, params = {}, ms = 15000) => new Promise(r => {
  const i = ++id, t = setTimeout(() => { pending.delete(i); r({ timeout: method }); }, ms); pending.set(i, v => { clearTimeout(t); r(v); });
  const inner = { id: i, method, params };
  ws.send(JSON.stringify(target ? { id: ++id + 100000, method: 'Target.sendMessageToTarget', params: { targetId: target, message: JSON.stringify(inner) } } : inner));
});
await send('Console.enable'); await send('Runtime.enable');
const ev = async (expr, ms) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }, ms); if (r.timeout) return { evalErr: 'timeout' }; const x = r.result || {}; if (x.wasThrown) return { evalErr: x.result && (x.result.description || x.result.value) }; return x.result ? x.result.value : { evalErr: JSON.stringify(r.error || r).slice(0, 200) }; };
let n = 0;
const shot = name => { const f = `${OUT}/${LABEL}-${String(++n).padStart(2, '0')}-${name}.png`; try { execFileSync('xcrun', ['simctl', 'io', UDID, 'screenshot', f], { timeout: 30000 }); R.shots.push(f); } catch (e) { R.shots.push(f + ' FAILED'); } save(); };
// synthetic touch tap at client px: pointerdown/up on what is under the point, then a click (buttons get .click())
const TAP = (x, y) => `(()=>{const el=document.elementFromPoint(${x},${y});if(!el)return null;const o={bubbles:true,cancelable:true,composed:true,clientX:${x},clientY:${y},pointerId:7,pointerType:'touch',isPrimary:true,button:0,buttons:1,width:12,height:12,pressure:0.5};
  el.dispatchEvent(new PointerEvent('pointerdown',o));setTimeout(()=>{el.dispatchEvent(new PointerEvent('pointerup',{...o,buttons:0,pressure:0}));el.dispatchEvent(new MouseEvent('click',o))},70);return (el.tagName+'.'+(el.className||'')+'#'+(el.id||'')).slice(0,60)})()`;
const PINCH = `(async()=>{const c=[...document.querySelectorAll('canvas')].filter(c=>getComputedStyle(c).display!=='none').sort((a,b)=>b.width*b.height-a.width*a.height)[0];const r=c.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height*0.45;
  const P=(id,x,y,t,b)=>c.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:id,pointerType:'touch',isPrimary:id===11,buttons:b,button:0}));
  P(11,cx-130,cy,'pointerdown',1);P(12,cx+130,cy,'pointerdown',1);for(let i=1;i<=12;i++){const d=130-100*i/12;P(11,cx-d,cy,'pointermove',1);P(12,cx+d,cy,'pointermove',1);await new Promise(r=>setTimeout(r,30))}
  P(11,cx-30,cy,'pointerup',0);P(12,cx+30,cy,'pointerup',0);return 'ok'})()`;
const SC = `(()=>{const s=window.__sc;return s?{frames:s.frames,mode:s.mode,sheet:s.sheet}:null})()`;
const COMP = `(()=>{const q=(window.__pois?window.__pois():[]).find(q=>q.id==='computer');if(!q)return null;const m=window.__roomItems.project({x:q.c[0],y:q.c[1],d:q.c[2]});return m&&m.map(Math.round)})()`;
R.loadedFrom = await ev('location.href');
await ev(`(()=>{const u=${JSON.stringify(MATCH)};if(location.href!==u)location.href=u;setTimeout(()=>location.reload(),300);return 1})()`);
try { ws.close(); } catch (e) { /* fine */ }
await sleep(9000); await attach(); await send('Console.enable'); await send('Runtime.enable');
R.href = await ev('location.href'); log('href', R.href);
let sc = null; for (let i = 0; i < 60; i++) { sc = await ev(SC); if (sc && sc.frames > 5) break; await sleep(1000); }
log('ready', sc);
R.probe = await ev(`(()=>{const c=document.createElement('canvas');c.setAttribute('content','drawable');const W1=window.WebGLRenderingContext&&WebGLRenderingContext.prototype,W2=window.WebGL2RenderingContext&&WebGL2RenderingContext.prototype;
  let framed;try{framed=window.top!==window&&window.top.location.origin!==location.origin}catch(e){framed=true}
  return {ua:navigator.userAgent,canvasContent:c.content===undefined?'undefined':c.content,updateElementGeometry:typeof HTMLCanvasElement.prototype.updateElementGeometry,texElementSubImage2D_gl1:typeof (W1&&W1.texElementSubImage2D),texElementSubImage2D_gl2:typeof (W2&&W2.texElementSubImage2D),framed,hash:location.hash,iw:innerWidth,ih:innerHeight,dpr:devicePixelRatio,coarse:matchMedia('(pointer: coarse)').matches}})()`);
log('probe', R.probe); shot('loaded');
// menu -> DIORAMA (button clicks), close the menu
log('menu', await ev(`(()=>{const p=document.querySelector('[data-sc=room-menu-pill]');if(!p)return 'no pill';p.click();return 'opened'})()`)); await sleep(1500); shot('menu-open');
log('dio', await ev(`(()=>{const b=document.querySelector('[data-mode=dio]');if(!b)return 'no button';b.click();return 'clicked'})()`)); await sleep(1500);
await ev(`(()=>{const p=document.querySelector('[data-sc=room-menu-pill]');if(p&&p.getAttribute('aria-expanded')==='true')p.click()})()`);
for (let i = 0; i < 60; i++) { await sleep(1000); sc = await ev(SC); if (sc && sc.mode === 'dio' && i > 6) break; }
R.hpc = await ev(`(()=>{const s=window.__hpc;return s?{painted:s.painted,live:s.live,err:s.lastError}:{hpc:typeof s,el:!!document.getElementById('sc-pchtml'),dioFail:((document.body.innerText||'').match(/Diorama could not start[^\\n]*/)||[null])[0]}})()`);
log('diorama', { sc, hpc: R.hpc }); shot('diorama');
// frame times (rAF over 6 s, polled: WebKit's evaluate does not await promises here)
await ev(`(()=>{window.__ft=null;const d=[];let last=performance.now();const T0=last,f0=(window.__sc||{}).frames||0;const st=t=>{d.push(t-last);last=t;if(t-T0<6000)requestAnimationFrame(st);else{d.sort((a,b)=>a-b);const q=p=>+d[Math.min(d.length-1,Math.floor(p*d.length))].toFixed(1);window.__ft={n:d.length,fps:+(d.length/((t-T0)/1000)).toFixed(1),p50:q(0.5),p95:q(0.95),max:+d[d.length-1].toFixed(1),engineFrames:((window.__sc||{}).frames||0)-f0}}};requestAnimationFrame(st)})()`);
await sleep(7500); R.framesRoom = await ev('window.__ft'); log('framesRoom', R.framesRoom);
let cm = await ev(COMP); R.find = [];
const on = m => m && m[0] > 4 && m[1] > 4 && m[0] < (R.probe.iw || 390) - 4 && m[1] < (R.probe.ih || 700) - 60;
for (let g = 0; g < 3 && !on(cm); g++) { await ev(PINCH); await sleep(4000); cm = await ev(COMP); R.find.push({ g, computer: cm }); log('find', { g, computer: cm }); }
// two orbit drags (90 px each, as on Android and the VE) so the computer faces the camera: from behind a tap finds nothing
const DRAG = `(async()=>{const c=[...document.querySelectorAll('canvas')].filter(c=>getComputedStyle(c).display!=='none').sort((a,b)=>b.width*b.height-a.width*a.height)[0];const r=c.getBoundingClientRect(),x0=r.left+r.width*0.25,y=r.top+r.height*0.4;
  const P=(x,t,b)=>c.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:21,pointerType:'touch',isPrimary:true,buttons:b,button:0}));
  P(x0,'pointerdown',1);for(let i=1;i<=12;i++){P(x0+90*i/12,'pointermove',1);await new Promise(r=>setTimeout(r,40))}P(x0+90,'pointerup',0);return 'ok'})()`;
for (let k = 0; k < Number(process.env.DRAGS || 2) && on(cm); k++) { await ev(DRAG); await sleep(3000); cm = await ev(COMP); R.find.push({ drag: k + 1, computer: cm, cam: await ev('window.__sc.cam()') }); log('drag', R.find[R.find.length - 1]); }
for (let i = 0; i < 10; i++) { await sleep(1200); const c2 = await ev(COMP); const still = Array.isArray(c2) && Array.isArray(cm) && Math.abs(c2[0] - cm[0]) < 2 && Math.abs(c2[1] - cm[1]) < 2; cm = c2; if (still) break; }
if (on(cm)) {
  shot('zoomed-out');
  R.tapEl = await ev(TAP(cm[0], cm[1])); log('tap', { at: cm, el: R.tapEl });
  let res = null; for (let i = 0; i < 30; i++) { await sleep(700); sc = await ev(SC); const z = await ev('window.__hpc&&window.__hpc.z?window.__hpc.z.on:null'); if (sc && sc.sheet) { res = 'sheet:' + sc.sheet; break; } const card = await ev(`(()=>{const e=document.querySelector('[data-sc=item-sheet]');return e&&e.getBoundingClientRect().height>0?(e.innerText||'').replace(/\\s+/g,' ').slice(0,120):null})()`); if (card && typeof card === 'string') { res = 'item-card:' + card; break; } if (z) { res = 'closeup'; break; } }
  R.tapResult = res || 'nothing'; log('tapResult', R.tapResult); await sleep(1500); shot(res ? res.split(':')[0] : 'after-tap');
  if (R.tapResult.startsWith('item-card')) {
    log('openComputer', await ev(`(()=>{const b=[...document.querySelectorAll('[data-sc=item-sheet] button, [data-sc=item-sheet] a')].find(b=>/open computer/i.test(b.textContent));if(!b)return 'no button';b.scrollIntoView({block:'center'});b.click();return 'clicked'})()`));
    await sleep(2500); R.openComputerSheet = (await ev(SC))?.sheet || null; log('openComputerSheet', R.openComputerSheet); shot('computer-panel');
  }
  R.sheetText = await ev(`(()=>{const s=document.querySelector('[data-obj]');return s?(s.innerText||'').slice(0,300):null})()`); log('sheetText', R.sheetText);
} else log('computerOffScreen', cm);
log('done', { console: R.console.length });
ws.close(); process.exit(0);
