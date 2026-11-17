// android-real.mjs (2026-11-17): the arcade + pinball played inside the REAL OpenSea item page on Android Chrome.
// Playwright connectOverCDP to the emulator's Chrome (adb forward 9222); taps are real CDP touches at the element's middle
// (Input.dispatchTouchEvent), screenshots by CDP and by adb screencap. Env: ITEM (opensea item url), OUT (dir). Read-only.
import { createRequire } from "node:module"; const { chromium } = createRequire(process.cwd() + "/scripts/")("playwright-core");
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const ITEM = process.env.ITEM, OUT = process.env.OUT || 'shots/real', MAXG = Number(process.env.GAMES || 2);
mkdirSync(OUT, { recursive: true });
const out = []; const say = s => { out.push(s); console.log(s); writeFileSync(OUT + '/result.txt', out.join('\n')); };
const ok = (c, w) => say((c ? 'ok   ' : 'FAIL ') + w);
const b = await chromium.connectOverCDP('http://localhost:9222');
const ctx = b.contexts()[0], page = ctx.pages()[0] || await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const cons = []; page.on('console', m => { if (m.type() === 'error' || /Refused|Content Security/.test(m.text())) cons.push((m.location()?.url || '').slice(0, 70) + ' ' + m.text().slice(0, 200)); });
page.on('pageerror', e => cons.push('pageerror ' + String(e).slice(0, 200)));
let popups = 0; ctx.on('page', () => popups++);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await sleep(250); } return null; };
let n = 0;
const shot = async name => { const f = `${OUT}/${String(++n).padStart(2, '0')}-${name}`; try { writeFileSync(f + '-adb.png', execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 })); } catch (e) { say('screencap failed ' + e.message.slice(0, 80)); } };
const tap = async loc => { await loc.scrollIntoViewIfNeeded().catch(() => {}); const bx = await loc.boundingBox(); if (!bx) throw Error('no box'); const x = bx.x + bx.width / 2, y = bx.y + bx.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(90); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
const hold = async (loc, ms) => { const bx = await loc.boundingBox(); const x = bx.x + bx.width / 2, y = bx.y + bx.height * 0.55;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(ms); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
const room = () => page.frames().find(f => /^https:\/\/straycucks\.com\/alive\/\d+/.test(f.url()));
const inner = re => page.frames().find(f => re.test(f.url()));
const R = page.frameLocator('iframe.os-item-media');
await page.goto(ITEM, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => say('goto ' + e.message.slice(0, 100)));
await sleep(8000);
say('title: ' + await page.title()); say('ua: ' + await page.evaluate(() => navigator.userAgent)); say('viewport: ' + await page.evaluate(() => innerWidth + 'x' + innerHeight + ' dpr ' + devicePixelRatio));
say('iframes: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('iframe')].map(f => f.outerHTML.slice(0, 260)))));
await shot('item');
const rm = await until(() => room() && room().evaluate(() => window.__sc && window.__sc.frames > 0), 60000);
ok(!!rm, 'room frame running inside the real item page');
if (!rm) { await shot('no-room'); say('CONSOLE ' + JSON.stringify(cons.slice(0, 8))); process.exit(1); }
say('room origin ' + await room().evaluate(() => self.origin) + ', mode ' + await room().evaluate(() => window.__sc.mode));
const openRow = async obj => {
  if (await room().evaluate(() => window.__sc.sheet)) { await tap(R.locator('[data-sc=close]')); await sleep(600); }
  if (!(await R.locator('[data-sc=room-obj][data-obj="' + obj + '"]').isVisible())) { await tap(R.locator('.scf')); await sleep(800); await shot('menu'); }
  await tap(R.locator('[data-sc=room-obj][data-obj="' + obj + '"]'));
};
const listRe = /^https:\/\/straycucks\.com\/framed\/arcade\/(\?|$)/;
await openRow('arcade');
let lf = await until(() => { const f = inner(listRe); return f && f.evaluate(() => document.querySelectorAll('a.game').length > 0).catch(() => false); }, 25000); lf = inner(listRe);
const games = lf ? await lf.evaluate(() => [...document.querySelectorAll('a.game')].map(a => ({ href: a.getAttribute('href'), name: a.querySelector('b').textContent }))) : [];
ok(games.length > 0, 'arcade list from the framed copy: ' + games.length + ' games'); await shot('arcade-list');
const picks = [0, Math.min(5, games.length - 1)].slice(0, MAXG);
for (const i of picks) {
  const g = games[i]; if (!g) continue; const slug = g.href.replace(/\.html.*$/, '');
  const lfi = inner(listRe); if (!lfi) { ok(false, g.name + ': list not showing'); break; }
  await tap(lfi.locator('a.game').nth(i));
  const gf = await until(() => { const f = inner(new RegExp('/framed/arcade/' + slug + '\\.html')); return f && f.evaluate(() => !!window.__arcade).then(v => v && f).catch(() => null); }, 25000);
  if (!ok(!!gf, g.name + ': opens in the same frame')) { await shot('fail-' + slug); continue; }
  const m0 = await gf.evaluate(() => window.__arcade.mode); await shot(slug + '-title');
  await tap(gf.locator('canvas#screen'));
  const st = await until(() => gf.evaluate(() => window.__arcade.mode !== 'title' && window.__arcade.mode), 6000);
  for (let k = 0; k < 4; k++) { await tap(gf.locator('canvas#screen')).catch(() => {}); await sleep(400); }
  const af = await gf.evaluate(() => ({ mode: window.__arcade.mode, score: window.__arcade.score, fps: Math.round(window.__arcade.fps || 0) }));
  ok(m0 === 'title' && !!st, g.name + ': tap starts it (' + m0 + ' -> ' + st + '), then ' + JSON.stringify(af)); await shot(slug + '-playing');
  await tap(R.locator('[data-sc=back]'));
  const back = await until(() => { const f = inner(listRe); return f && f.evaluate(() => document.querySelectorAll('a.game').length).catch(() => 0); }, 15000);
  ok(!!back, g.name + ': "< Games" puts the list back (' + back + ')');
}
await openRow('pinball');
const pf = await until(() => { const f = inner(/\/framed\/pinball\//); return f && f.evaluate(() => !!(window.__pb && window.__pb.game)).then(v => v && f).catch(() => null); }, 25000);
if (ok(!!pf, 'pinball opens from its framed copy')) {
  const ph0 = await pf.evaluate(() => window.__pb.game.phase); await shot('pinball-before');
  const cv = pf.locator('#pb'); await hold(cv, 700);
  const ph1 = await until(() => pf.evaluate(() => window.__pb.game.phase !== 'plunger' && window.__pb.game.phase), 6000);
  ok(ph0 === 'plunger' && !!ph1, 'a touch hold launches the ball (' + ph0 + ' -> ' + ph1 + ')'); await sleep(700); await shot('pinball-play');
  const other = (await room().evaluate(() => [...document.querySelectorAll('[data-table]')].map(x => x.dataset.table))).find(t => t !== 'stray');
  if (other) { await tap(R.locator('[data-table="' + other + '"]')); const t2 = await until(() => { const f = inner(new RegExp('table=' + other)); return f && f.evaluate(() => window.__pb && window.__pb.T.id).catch(() => null); }, 15000); ok(t2 === other, 'table switch to ' + other + ' (' + t2 + ')'); await sleep(800); await shot('pinball-' + other); }
}
await tap(R.locator('[data-sc=close]')).catch(() => {}); await sleep(600);
ok(popups === 0, 'no popup (' + popups + ')');
say('CONSOLE (' + cons.length + '): ' + JSON.stringify([...new Set(cons)].slice(0, 12)));
process.exit(0);
