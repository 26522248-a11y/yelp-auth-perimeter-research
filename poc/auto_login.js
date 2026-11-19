const http = require('http');
const net = require('net');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const PH = 'pr.oxylabs.io', PP = 7777;
const PU = process.env.PXUSER || 'customer-mobile_<REDACTED>-sessid-hf02-sesstime-30';
const PW = process.env.PXPASS || '<REDACTED_PROXY_PASS>';
const AUTH = 'Basic ' + Buffer.from(PU + ':' + PW).toString('base64');
const LP = 8904, CP = 9226;
const SHOT = process.env.SHOT || 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\2\\opencode\\challenge.png';

const relay = http.createServer((req, res) => {
  try {
    const u = new URL(req.url);
    const pr = http.request({ host: u.hostname, port: u.port || 80, method: req.method, path: u.pathname + u.search, headers: Object.assign({}, req.headers, { host: u.host }) }, r2 => { res.writeHead(r2.statusCode, r2.headers); r2.pipe(res); });
    pr.on('error', () => res.destroy()); req.pipe(pr);
  } catch (e) { res.destroy(); }
});
relay.on('connect', (req, cs, head) => {
  const s = net.connect(PP, PH, () => s.write('CONNECT ' + req.url + ' HTTP/1.1\r\nHost: ' + req.url + '\r\nProxy-Authorization: ' + AUTH + '\r\n\r\n'));
  let buf = Buffer.alloc(0);
  function onData(d) {
    buf = Buffer.concat([buf, d]);
    const i = buf.indexOf('\r\n\r\n'); if (i < 0) return;
    s.removeListener('data', onData);
    const rest = buf.slice(i + 4);
    const m = buf.slice(0, i).toString().match(/^HTTP\/1\.[01]\s+(\d+)/);
    if (!m || parseInt(m[1], 10) !== 200) { try { cs.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch (e) {} s.destroy(); return; }
    cs.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (rest.length) cs.write(rest);
    s.pipe(cs); cs.pipe(s);
    if (head && head.length) s.write(head);
    s.on('error', () => cs.destroy()); cs.on('error', () => s.destroy());
  }
  s.on('data', onData);
  s.on('error', () => { try { cs.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch (e) {} });
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function j(u, n) { for (let i = 0; i < n; i++) { try { const r = await fetch(u); return await r.json(); } catch (e) { await sleep(500); } } return null; }

(async () => {
  await new Promise(r => relay.listen(LP, '127.0.0.1', r));
  const udd = path.join(os.tmpdir(), 'cdp-hf2-' + Date.now());
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--no-first-run', '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1366,950', '--lang=en-US',
    '--user-data-dir=' + udd,
    '--proxy-server=http://127.0.0.1:' + LP,
    '--remote-debugging-port=' + CP,
    'https://www.yelp.com/login'
  ], { stdio: 'ignore' });

  const ver = await j('http://127.0.0.1:' + CP + '/json/version', 40);
  if (!ver) { console.log('{"ok":false,"err":"cdp"}'); chrome.kill(); relay.close(); return; }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener('message', ev => { try { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } } catch (e) {} });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (m, p) => new Promise(resolve => { const mid = ++id; pend.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method: m, params: p || {} })); });

  await sleep(9000);
  const t = await send('Target.getTargets');
  let sid = null;
  if (t && t.result) { const pg = t.result.targetInfos.find(x => x.type === 'page'); if (pg) { const a = await send('Target.attachToTarget', { targetId: pg.targetId, flatten: true }); if (a && a.result) sid = a.result.sessionId; } }
  const ev = e => new Promise(resolve => {
    const mid = Math.floor(Math.random() * 1e9);
    const h = x => { try { const m = JSON.parse(x.data); if (m.id === mid) { ws.removeEventListener('message', h); resolve(m.result && m.result.result ? m.result.result.value : null); } } catch (err) {} };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression: e, returnByValue: true, awaitPromise: true }, sessionId: sid }));
    setTimeout(() => resolve(null), 15000);
  });

  console.log('AFTER_DD ' + await ev(`JSON.stringify({href:location.href,title:document.title,len:document.documentElement.outerHTML.length})`));

  for (const p of ['/login/', '/login/']) {
    await ev(`location.href='https://www.yelp.com${p}'`).catch(() => {});
    await sleep(3500);
  }
  console.log('ON_LOGIN ' + await ev(`JSON.stringify({href:location.href,title:document.title,len:document.documentElement.outerHTML.length,form:!!document.getElementById('ajax-login')})`));

  await ev(`(function(){var f=document.getElementById('ajax-login');if(!f)return 'noform';var e=f.querySelector('input[name=email]'),p=f.querySelector('input[name=password]');e.value='qa.probe7.5657@example.com';p.value='WrongPass999!';e.dispatchEvent(new Event('input',{bubbles:true}));p.dispatchEvent(new Event('input',{bubbles:true}));var b=f.querySelector('button[type=submit]');b.click();return 'clicked';})()`);
  await sleep(12000);

  const st = await ev(`JSON.stringify({
    href: location.href,
    ifr: Array.prototype.map.call(document.querySelectorAll('iframe'),function(f){return (f.src||'').slice(0,120)}).filter(function(s){return /hcaptcha/i.test(s)}),
    tok: (document.querySelector('[name="h-captcha-response"]')||{}).value || '',
    tok2: (document.querySelector('[name="g-recaptcha-response"]')||{}).value || '',
    alert: (document.querySelector('.alert-message')||{}).textContent || '',
    showCaptcha: !!(document.querySelector('.login-captcha iframe')||document.querySelector('.login-captcha div'))
  })`);
  console.log('AFTER_SUBMIT ' + st);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot && shot.result && shot.result.data) { fs.writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64')); console.log('SHOT ' + SHOT); }

  const ck = await send('Storage.getCookies', {});
  const list = (ck && ck.result && ck.result.cookies) ? ck.result.cookies : [];
  console.log('COOKIES ' + JSON.stringify(list.map(c => ({ name: c.name, len: c.value.length }))));

  try { ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { relay.close(); } catch (e) {}
  setTimeout(() => process.exit(0), 1000);
})();
