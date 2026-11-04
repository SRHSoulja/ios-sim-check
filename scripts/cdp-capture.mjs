// usage: node cdp-capture.mjs <url> <seconds> <out.json>
// Attaches to Chrome's devtools socket (adb forward tcp:9222), reloads the tab for the given URL and records
// console messages, uncaught exceptions, browser log entries and failed/4xx/5xx network requests.
const [url, secs, out] = process.argv.slice(2);
import { writeFileSync } from 'node:fs';
const res = { url, errors: [], warnings: [], exceptions: [], log: [], network: [], info: {} };
const save = () => writeFileSync(out, JSON.stringify(res, null, 2));
let targets = [];
for (let t = 0; t < 10 && !targets.length; t++) {
  try { targets = (await (await fetch('http://localhost:9222/json')).json()).filter(x => x.type === 'page'); } catch {}
  if (!targets.length) await new Promise(r => setTimeout(r, 1500));
}
if (!targets.length) { res.info.fatal = 'no devtools page target'; save(); process.exit(1); }
const host = new URL(url).host;
const tg = targets.find(x => (x.url || '').includes(host)) || targets[0];
res.info.target = tg.url;
const ws = new WebSocket(tg.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const reqs = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
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
for (const d of ['Runtime', 'Log', 'Network', 'Page']) await send(d + '.enable');
await send('Page.reload', { ignoreCache: true });
await new Promise(r => setTimeout(r, Number(secs) * 1000));
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value;
res.info.title = await ev('document.title');
res.info.href = await ev('location.href');
res.info.innerWidth = await ev('innerWidth');
res.info.innerHeight = await ev('innerHeight');
res.info.dpr = await ev('devicePixelRatio');
res.info.ua = await ev('navigator.userAgent');
res.info.webgl = await ev("(()=>{try{const g=document.createElement('canvas').getContext('webgl');return g?g.getParameter(g.RENDERER):'none'}catch(e){return String(e)}})()");
res.info.bodyTextStart = await ev('(document.body&&document.body.innerText||"").slice(0,300)');
save(); ws.close(); process.exit(0);
