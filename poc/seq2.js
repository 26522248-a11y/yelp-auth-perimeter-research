const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const PH = 'pr.oxylabs.io', PP = 7777;
const PU = process.env.PXUSER || 'customer-mobile_<REDACTED>-sessid-hf05-sesstime-30';
const PW = process.env.PXPASS || '<REDACTED_PROXY_PASS>';
const AUTH = 'Basic ' + Buffer.from(PU + ':' + PW).toString('base64');
const LP = 8907, CP = 9229;
const N = parseInt(process.env.N || '5', 10);

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
  const udd = path.join(os.tmpdir(), 'cdp-s2-' + Date.now());
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

  await sleep(10000);
  const t = await send('Target.getTargets');
  let sid = null;
  if (t && t.result) { const pg = t.result.targetInfos.find(x => x.type === 'page'); if (pg) { const a = await send('Target.attachToTarget', { targetId: pg.targetId, flatten: true }); if (a && a.result) sid = a.result.sessionId; } }
  const ev = e => new Promise(resolve => {
    const mid = Math.floor(Math.random() * 1e9);
    const h = x => { try { const m = JSON.parse(x.data); if (m.id === mid) { ws.removeEventListener('message', h); resolve(m.result && m.result.result ? m.result.result.value : null); } } catch (err) {} };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression: e, returnByValue: true, awaitPromise: true }, sessionId: sid }));
    setTimeout(() => resolve(null), 30000);
  });

  console.log('LOAD ' + await ev(`JSON.stringify({href:location.href,title:document.title,len:document.documentElement.outerHTML.length,form:!!document.getElementById('ajax-login')})`));

  await ev(`location.href='https://www.yelp.com/login/'`);
  await sleep(5000);
  for (let k = 0; k < 10; k++) {
    const f = await ev(`!!document.getElementById('ajax-login')`);
    if (f === true) break;
    await sleep(1500);
  }
  console.log('PAGE ' + await ev(`JSON.stringify({href:location.href,title:document.title,len:document.documentElement.outerHTML.length,form:!!document.getElementById('ajax-login')})`));

  const results = [];
  for (let i = 1; i <= N; i++) {
    await send('Page.navigate', { url: 'https://www.yelp.com/login/' });
    let hydrated = false;
    for (let k = 0; k < 25; k++) {
      await sleep(1500);
      const s = await ev(`JSON.stringify({f:!!document.getElementById('ajax-login'),l:document.documentElement.outerHTML.length})`);
      try { const o = JSON.parse(s); if (o && o.f && o.l > 500000) { hydrated = true; break; } } catch (e) {}
    }
    if (!hydrated) {
      results.push({ i, err: 'nothydrated' });
      console.log('ATT' + i + ' NOTHYDRATED');
      continue;
    }
    let last = { alert: '', tokLen: 0, href: '' };
    for (let r = 0; r < 2; r++) {
      await ev(`(function(){var f=document.getElementById('ajax-login');var e=f.querySelector('input[name=email]'),p=f.querySelector('input[name=password]');e.value='qa.probe7.5657@example.com';p.value='WrongPw${i}Xy!';e.dispatchEvent(new Event('input',{bubbles:true}));p.dispatchEvent(new Event('input',{bubbles:true}));f.querySelector('button[type=submit]').click();return 1;})()`);
      await sleep(12000);
      const st = await ev(`JSON.stringify({alert:(document.querySelector('.alert-message')||{}).textContent||'',tok:((document.querySelector('[name="h-captcha-response"]')||{}).value||'').length,href:location.href})`);
      let o = {}; try { o = JSON.parse(st); } catch (e) { o = {}; }
      last = { alert: (o.alert || '').replace(/\s+/g, ' ').trim(), tokLen: o.tok, href: o.href };
      if (last.alert) break;
    }
    results.push({ i, alert: last.alert, tokLen: last.tokLen, href: last.href });
    console.log('ATT' + i + ' ' + JSON.stringify(results[results.length - 1]));
  }

  console.log('SUMMARY ' + JSON.stringify(results));

  try { ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { relay.close(); } catch (e) {}
  setTimeout(() => process.exit(0), 1000);
})();
