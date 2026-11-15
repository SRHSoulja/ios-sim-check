// ui-walk.mjs (2026-11-14): walk an Android app's first-run screens with uiautomator, tapping the first button whose
// text matches a priority list, ticking unticked checkboxes and typing a password into empty password fields.
// Every step saves <prefix>-NN.png (adb screencap) and <prefix>-NN.txt (the visible texts and what was tapped).
//   node ui-walk.mjs <prefix> <max steps> <stop regex>
// Env: APP (package: if another app comes up, press Back), PW (password for password fields; the workflow makes a random one per run, never stored), WALK (JSON array of
// regex strings, the tap priority list; default: wallet onboarding words).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [PREFIX, MAX = '30', STOP = '^$'] = process.argv.slice(2);
const adb = (...a) => execFileSync('adb', a, { maxBuffer: 64e6, timeout: 30000 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
// (order matters: the 'Create a new wallet' sheet keeps that button under 'Use Secret Recovery Phrase', and the first walk
// tapped it again and landed on 'Continue with Google', run 43655798764)
const WALK = (process.env.WALK ? JSON.parse(process.env.WALK) : [
  '^i understand$', '^use secret recovery phrase$', '^create (a )?new wallet$', '^i agree$', '^agree$', '^accept$', '^no thanks$', '^create password$',
  '^remind me later$', '^skip$', '^skip account security', '^done$', '^open wallet$', '^got it$', '^not now$', '^maybe later$',
  '^continue$', '^confirm$', '^ok$', '^close$', '^next$', '^let.s go$', '^dismiss$', '^get started$',
]).map(s => new RegExp(s, 'i'));
const stop = new RegExp(STOP, 'i');
const parse = xml => [...xml.matchAll(/<node ([^>]*?)\/?>/g)].map(m => {
  const a = {}; for (const [, k, v] of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) a[k] = v.replace(/&amp;/g, '&').replace(/&#10;/g, ' ').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  const b = (a.bounds || '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/); a.box = b ? b.slice(1).map(Number) : null; a.label = (a.text || a['content-desc'] || '').trim(); return a;
});
const centre = n => [Math.round((n.box[0] + n.box[2]) / 2), Math.round((n.box[1] + n.box[3]) / 2)];
const tap = n => { const [x, y] = centre(n); adb('shell', 'input', 'tap', String(x), String(y)); return [x, y]; };
let lastSig = '', same = 0; const typed = new Set();
for (let i = 1; i <= Number(MAX); i++) {
  const n = String(i).padStart(2, '0');
  let nodes = [];
  try { adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml'); nodes = parse(adb('shell', 'cat', '/sdcard/ui.xml').toString()); } catch (e) { /* a busy screen: try again */ }
  try { writeFileSync(`${PREFIX}-${n}.png`, adb('exec-out', 'screencap', '-p')); } catch (e) { /* fine */ }
  const texts = nodes.filter(x => x.label && x.box).map(x => x.label);
  const pkg = nodes[0] && nodes[0].package;
  const note = [`step ${n} package=${pkg}`, 'texts: ' + JSON.stringify(texts.slice(0, 60))];
  if (texts.some(t => stop.test(t))) { note.push('STOP matched'); writeFileSync(`${PREFIX}-${n}.txt`, note.join('\n')); console.log(note.join(' | ')); break; }
  // left the app (a Google sign-in, a browser): Back, never type into someone else's screen
  if (process.env.APP && pkg && pkg !== process.env.APP && !/launcher|systemui/.test(pkg)) { adb('shell', 'input', 'keyevent', '4'); note.push('left ' + process.env.APP + ': pressed Back'); writeFileSync(`${PREFIX}-${n}.txt`, note.join('\n')); console.log(note.join(' | ').slice(0, 600)); await sleep(2000); continue; }
  const sig = texts.join('|'); same = sig === lastSig ? same + 1 : 0; lastSig = sig;
  const did = [];
  // password fields first (empty ones), then unticked boxes, then the priority buttons
  // password fields: password="true", or (MetaMask's React Native fields expose no password flag, run 43657732643) an
  // EditText whose text is its hint ("New password", "Re-enter new password"); each box typed once
  for (const f of nodes.filter(x => x.box && x.enabled !== 'false' && (x.password === 'true' || (/EditText/.test(x.class || '') && /password/i.test((x.text || '') + ' ' + (x.hint || '') + ' ' + (x['resource-id'] || '')))))) {
    const key = f.box.join(','); if (typed.has(key)) continue; typed.add(key);
    tap(f); await sleep(400); adb('shell', 'input', 'text', process.env.PW || 'Throwaway-' + Date.now()); did.push('typed password'); await sleep(400);
  }
  if (did.length) { try { adb('shell', 'input', 'keyevent', '111'); } catch (e) { /* no keyboard */ } }
  for (const c of nodes.filter(x => x.checkable === 'true' && x.checked === 'false' && x.box && x.enabled !== 'false')) { tap(c); did.push('ticked ' + (c.label || c['resource-id'] || 'box')); await sleep(300); }
  if (!did.length || same > 0) {
    let hit = null;
    for (const re of WALK) { hit = nodes.find(x => x.box && x.enabled !== 'false' && re.test(x.label)); if (hit) break; }
    if (hit && same < 3) { did.push('tapped "' + hit.label + '" at ' + tap(hit).join(',')); }
    else {
      // nothing to press (or pressing did nothing): scroll the biggest scrollable thing (terms that must be read to the end)
      const sc = nodes.filter(x => x.scrollable === 'true' && x.box).sort((a, b) => (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]) - (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]))[0];
      const bx = sc ? sc.box : [0, 400, 1080, 2000], x = Math.round((bx[0] + bx[2]) / 2);
      adb('shell', 'input', 'swipe', String(x), String(bx[3] - 60), String(x), String(bx[1] + 60), '250'); did.push('swiped up');
    }
  }
  note.push('did: ' + JSON.stringify(did)); writeFileSync(`${PREFIX}-${n}.txt`, note.join('\n')); console.log(note.join(' | ').slice(0, 900));
  await sleep(2500);
}
