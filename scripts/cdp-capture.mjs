// usage: node cdp-capture.mjs <url> <seconds> <out.json>
// Attaches to Chrome's devtools socket (adb forward tcp:9222), reloads the tab for the given URL and records
// console messages, uncaught exceptions, browser log entries and failed/4xx/5xx network requests.
// Canvas/WebGL probe (added 2026-11-04 to tell "page drew nothing" from "emulator showed nothing"):
//   - a script injected before the page's own records every canvas getContext call (type, attributes, null or not),
//     webglcontextlost/restored/creationerror events, and counts WebGL draw calls with count>0 vs count 0.
//     It forces preserveDrawingBuffer:true on WebGL contexts so the pixels can be read back (PRESERVE=0 to turn off).
//   - after the wait: every canvas with its size, CSS box, display, and a pixel sample (2D: getImageData;
//     WebGL: readPixels) giving lit-pixel count and distinct colours; window.__sc (alive engine) frames/mode;
//     unmasked GL renderer/version; and a CDP Page.captureScreenshot saved beside out.json as <name>-cdp.png
//     (Chrome's own composited frame, independent of the emulator display that adb screencap reads).
// chrome:// pages: the whole body text is kept (bodyText), e.g. chrome://gpu feature status.
const [url, secs, out] = process.argv.slice(2);
import { writeFileSync } from 'node:fs';
const res = { url, errors: [], warnings: [], exceptions: [], log: [], network: [], info: {} };
const save = () => writeFileSync(out, JSON.stringify(res, null, 2));
let targets = [];
for (let t = 0; t < 10 && !targets.length; t++) {
  try { targets = (await (await fetch('http://localhost:9222/json', { signal: AbortSignal.timeout(5000) })).json()).filter(x => x.type === 'page'); } catch {}
  if (!targets.length) await new Promise(r => setTimeout(r, 1500));
}
if (!targets.length) { res.info.fatal = 'no devtools page target'; save(); process.exit(1); }
const u0 = new URL(url), host = u0.host;
const hit = targets.find(x => (x.url || '').includes(host)), tg = hit || targets[0];
res.info.target = tg.url;
const ws = new WebSocket(tg.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; setTimeout(() => bad(new Error('ws open timeout')), 10000); });
let id = 0; const pending = new Map();
// every call has a timeout (a hung evaluate or screenshot on old Chrome stalled the whole job, 2026-11-04): it resolves
// { timeout: method } and the stage is noted in info.stages, so the JSON always says how far it got
const send = (method, params = {}, ms = 15000) => new Promise(r => { const i = ++id; const t = setTimeout(() => { pending.delete(i); r({ timeout: method }); }, ms); pending.set(i, v => { clearTimeout(t); r(v); }); ws.send(JSON.stringify({ id: i, method, params })); });
const stage = s => { (res.info.stages ||= []).push(s); save(); };
const reqs = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? { error: m.error }); pending.delete(m.id); return; }
  const p = m.params || {};
  switch (m.method) {
    case 'Runtime.consoleAPICalled': {
      const text = (p.args || []).map(a => a.value ?? a.description ?? a.type).join(' ');
      if (p.type === 'error' || p.type === 'assert') res.errors.push({ text, at: p.stackTrace?.callFrames?.[0] });
      else if (p.type === 'warning') res.warnings.push({ text });
      break; }
    case 'Runtime.exceptionThrown': res.exceptions.push({ text: p.exceptionDetails?.text, desc: p.exceptionDetails?.exception?.description, url: p.exceptionDetails?.url, line: p.exceptionDetails?.lineNumber }); break;
    case 'Log.entryAdded': if (['error', 'warning'].includes(p.entry.level)) res.log.push({ level: p.entry.level, text: p.entry.text, url: p.entry.url }); break;
    case 'Network.requestWillBeSent': reqs.set(p.requestId, p.request.url); break;
    case 'Network.loadingFailed': res.network.push({ failed: p.errorText, url: reqs.get(p.requestId) }); break;
    case 'Network.responseReceived': if (p.response.status >= 400) res.network.push({ status: p.response.status, url: p.response.url }); break;
  }
};
const PRESERVE = process.env.PRESERVE !== '0';
const HOOK = `(()=>{if(window.__probe)return;const R=window.__probe={ctx:[],lost:0,restored:0,createErr:[],draws:0,zeroDraws:0};
const og=HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext=function(t,a){
  let aa=a;if(${PRESERVE}&&/webgl/.test(t)){aa=Object.assign({},a||{},{preserveDrawingBuffer:true});}
  const r=og.call(this,t,aa);
  try{if(!this.__pt&&R.ctx.length<60){R.ctx.push({t,attrs:a?JSON.stringify(a):'',ok:!!r,w:this.width,h:this.height,inDoc:this.isConnected});
    if(r)this.__pt=t;
    this.addEventListener('webglcontextlost',()=>R.lost++);this.addEventListener('webglcontextrestored',()=>R.restored++);
    this.addEventListener('webglcontextcreationerror',e=>R.createErr.push(e.statusMessage||'creationerror'));}}catch(e){}
  return r};
for(const P of [window.WebGLRenderingContext,window.WebGL2RenderingContext]){if(!P)continue;
  for(const m of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){const o=P.prototype[m];if(!o)continue;
    P.prototype[m]=function(...x){const c=m.startsWith('drawArrays')?x[2]:x[1];const ic=m.endsWith('Instanced')?x[x.length-1]:1;if(c>0&&ic>0)R.draws++;else R.zeroDraws++;return o.apply(this,x)}}}
})()`;
const PROBE = `(()=>{const o={sc:null,probe:window.__probe||null,canvases:[],gl:null};
try{const s=window.__sc;if(s)o.sc={frames:s.frames,mode:s.mode,sheet:s.sheet,screen:s.screen}}catch(e){o.sc=String(e)}
const sample=(get,w,h)=>{let lit=0,n=0;const cols=new Set();const st=Math.max(1,Math.floor(Math.sqrt(w*h/40000)));
  for(let y=0;y<h;y+=st)for(let x=0;x<w;x+=st){const p=get(x,y);n++;if(p[3]>0){lit++;if(cols.size<300)cols.add(p[0]+','+p[1]+','+p[2])}}return{sampled:n,lit,colours:cols.size}};
for(const c of document.querySelectorAll('canvas')){const r=c.getBoundingClientRect(),cs=getComputedStyle(c);
  const e={id:c.id,cls:String(c.className).slice(0,40),w:c.width,h:c.height,css:[r.x,r.y,r.width,r.height].map(Math.round),display:cs.display,visibility:cs.visibility,opacity:cs.opacity,ctx:c.__pt||null};
  try{if(c.__pt==='2d'&&c.width*c.height>0&&c.width*c.height<=16e6){const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;e.px=sample((x,y)=>{const i=(y*c.width+x)*4;return[d[i],d[i+1],d[i+2],d[i+3]]},c.width,c.height)}
    else if(c.__pt&&/webgl/.test(c.__pt)){const g=c.getContext(c.__pt);e.lostNow=g.isContextLost();e.db=[g.drawingBufferWidth,g.drawingBufferHeight];e.attrs=g.getContextAttributes();
      const W=g.drawingBufferWidth,H=g.drawingBufferHeight,b=new Uint8Array(W*H*4);g.readPixels(0,0,W,H,g.RGBA,g.UNSIGNED_BYTE,b);
      e.px=sample((x,y)=>{const i=(y*W+x)*4;return[b[i],b[i+1],b[i+2],b[i+3]]},W,H);e.glErr=g.getError()}}catch(er){e.pxErr=String(er)}
  o.canvases.push(e)}
try{const c=document.createElement('canvas');const g2=!!c.getContext('webgl2');const c1=document.createElement('canvas');const g=c1.getContext('webgl');
  if(g){const x=g.getExtension('WEBGL_debug_renderer_info');o.gl={webgl2:g2,renderer:g.getParameter(g.RENDERER),vendor:g.getParameter(g.VENDOR),version:g.getParameter(g.VERSION),glsl:g.getParameter(g.SHADING_LANGUAGE_VERSION),maxTex:g.getParameter(g.MAX_TEXTURE_SIZE),unmaskedRenderer:x?g.getParameter(x.UNMASKED_RENDERER_WEBGL):null,unmaskedVendor:x?g.getParameter(x.UNMASKED_VENDOR_WEBGL):null};
  const l=g.getExtension('WEBGL_lose_context');if(l)l.loseContext()}else o.gl={webgl2:g2,webgl:false}}catch(e){o.gl=String(e)}
return o})()`;
for (const d of ['Runtime', 'Log', 'Network', 'Page']) await send(d + '.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
// the intent opened the page: reload it so the hook runs first. No tab for it (chrome:// URLs are refused by intent): navigate there.
if (hit) await send('Page.reload', { ignoreCache: true }); else { res.info.navigated = true; await send('Page.navigate', { url }); }
await new Promise(r => setTimeout(r, Number(secs) * 1000));
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, timeout: 10000 });
  if (r?.timeout) return 'EVAL TIMEOUT'; return r?.result?.value ?? (r?.exceptionDetails ? 'EVAL ERROR ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) : undefined); };
stage('waited');
res.info.title = await ev('document.title');
res.info.href = await ev('location.href');
res.info.innerWidth = await ev('innerWidth');
res.info.innerHeight = await ev('innerHeight');
res.info.dpr = await ev('devicePixelRatio');
res.info.ua = await ev('navigator.userAgent');
res.info.webgl = await ev("(()=>{try{const g=document.createElement('canvas').getContext('webgl');return g?g.getParameter(g.RENDERER):'none'}catch(e){return String(e)}})()");
res.info.bodyTextStart = await ev('(document.body&&document.body.innerText||"").slice(0,300)');
if (u0.protocol === 'chrome:') res.info.bodyText = await ev('(document.body&&document.body.innerText||"").slice(0,12000)');
else { stage('info'); res.probe = await ev(PROBE); stage('probe'); }
try {
  const shot = await send('Page.captureScreenshot', { format: 'png' }, 20000);
  if (shot?.data) writeFileSync(out.replace(/\.json$/, '-cdp.png'), Buffer.from(shot.data, 'base64'));
  else res.info.cdpShot = 'failed ' + JSON.stringify(shot).slice(0, 200);
} catch (e) { res.info.cdpShot = 'failed ' + e; }
stage('done'); ws.close(); process.exit(0);
