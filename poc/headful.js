const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const PH = 'pr.oxylabs.io', PP = 7777;
const PU = process.env.PXUSER || 'customer-mobile_<REDACTED>-sessid-hf01-sesstime-30';
const PW = process.env.PXPASS || '<REDACTED_PROXY_PASS>';
const AUTH = 'Basic ' + Buffer.from(PU + ':' + PW).toString('base64');
const LP = 8903, CP = 9225;
const TARGET = process.env.TARGET || 'https://www.yelp.com/login';

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
async function j(url, n) { for (let i = 0; i < n; i++) { try { const r = await fetch(url); return await r.json(); } catch (e) { await sleep(500); } } return null; }

(async () => {
  await new Promise(r => relay.listen(LP, '127.0.0.1', r));
  const udd = path.join(os.tmpdir(), 'cdp-hf-' + Date.now());
  const args = [
    '--no-first-run', '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1280,900', '--lang=en-US',
    '--user-data-dir=' + udd,
    '--proxy-server=http://127.0.0.1:' + LP,
    '--remote-debugging-port=' + CP,
    TARGET
  ];
  if (process.env.HEADLESS === '1') args.unshift('--headless=new');
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args, { stdio: 'ignore' });

  const ver = await j('http://127.0.0.1:' + CP + '/json/version', 40);
  if (!ver) { console.log('{"ok":false,"err":"cdp"}'); chrome.kill(); relay.close(); return; }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener('message', ev => { try { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } } catch (e) {} });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params) => new Promise(resolve => { const mid = ++id; pend.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });

  await sleep(6000);
  const t = await send('Target.getTargets');
  let sid = null;
  if (t && t.result) { const pg = t.result.targetInfos.find(x => x.type === 'page'); if (pg) { const a = await send('Target.attachToTarget', { targetId: pg.targetId, flatten: true }); if (a && a.result) sid = a.result.sessionId; } }
  const ev = expr => new Promise(resolve => {
    const mid = Math.floor(Math.random() * 1e9);
    const h = e => { try { const m = JSON.parse(e.data); if (m.id === mid) { ws.removeEventListener('message', h); resolve(m.result && m.result.result ? m.result.result.value : null); } } catch (e) {} };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true }, sessionId: sid }));
    setTimeout(() => resolve(null), 12000);
  });

  const expr = `JSON.stringify({href:location.href,title:document.title,len:document.documentElement.outerHTML.length,ua:navigator.userAgent,wd:!!navigator.webdriver})`;
  let last = '';
  for (let i = 0; i < 12; i++) {
    const s = await ev(expr);
    last = s;
    console.log('T' + i + ' ' + s);
    try { const o = JSON.parse(s); if (o && o.len > 100000) break; } catch (e) {}
    await sleep(4000);
  }

  const ck = await send('Storage.getCookies', {});
  const list = (ck && ck.result && ck.result.cookies) ? ck.result.cookies : [];
  const out = list.map(c => ({ name: c.name, value: c.value, domain: c.domain, len: c.value.length }));
  console.log('COOKIES ' + JSON.stringify(out));

  try { ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { relay.close(); } catch (e) {}
  setTimeout(() => process.exit(0), 1000);
})();
