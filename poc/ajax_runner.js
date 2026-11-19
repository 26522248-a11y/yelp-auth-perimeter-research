const http = require('http');
const net = require('net');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const BID = parseInt(process.env.BID || '0', 10);
const N = parseInt(process.env.N || '6', 10);
const OUT = process.env.OUT || ('C:\\Users\\Administrator\\AppData\\Local\\Temp\\2\\opencode\\ajax_' + BID + '.jsonl');

const PH = 'pr.oxylabs.io', PP = 7777;
const SESS = 'aj' + BID + 'x' + Math.floor(Math.random() * 100000);
const CC = process.env.CC || 'us';
const PU = 'customer-mobile_<REDACTED>-cc-' + CC + '-sessid-' + SESS + '-sesstime-60';
const PW = '<REDACTED_PROXY_PASS>';
const AUTH = 'Basic ' + Buffer.from(PU + ':' + PW).toString('base64');
const LP = 8950 + BID, CP = 9270 + BID;

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
function rec(o) { fs.appendFileSync(OUT, JSON.stringify(o) + '\n'); }

(async () => {
  fs.writeFileSync(OUT, '');
  await new Promise(r => relay.listen(LP, '127.0.0.1', r));
  const udd = path.join(os.tmpdir(), 'cdp-aj-' + BID + '-' + Date.now());
  const cargs = [
    '--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled',
    '--window-size=1100,800', '--lang=en-US', '--user-data-dir=' + udd
  ];
  if (process.env.NOPROXY !== '1') cargs.push('--proxy-server=http://127.0.0.1:' + LP);
  cargs.push('--remote-debugging-port=' + CP, 'https://www.yelp.com/login');
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', cargs, { stdio: 'ignore' });

  const ver = await j('http://127.0.0.1:' + CP + '/json/version', 40);
  if (!ver) { rec({ bid: BID, err: 'cdp' }); chrome.kill(); relay.close(); return; }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const posts = new Map();      // requestId -> {url, postData, seq, status}
  const finished = [];           // order of finished POST requestIds

  ws.addEventListener('message', ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === 'Network.requestWillBeSent') {
      const r = m.params.request;
      if (r.method === 'POST' && /\/login/.test(r.url)) {
        posts.set(m.params.requestId, { url: r.url, postData: r.postData || '', seq: posts.size + 1, ts: Date.now() });
      }
    } else if (m.method === 'Network.responseReceived') {
      const p = posts.get(m.params.requestId);
      if (p) p.status = m.params.response.status;
    } else if (m.method === 'Network.loadingFinished') {
      if (posts.has(m.params.requestId)) {
        finished.push(m.params.requestId);
        const p = posts.get(m.params.requestId);
        sendS('Network.getResponseBody', { requestId: m.params.requestId }).then(rb => {
          try {
            if (rb && rb.result && rb.result.body) {
              p.body = rb.result.base64Encoded ? Buffer.from(rb.result.body, 'base64').toString('utf8') : rb.result.body;
            }
          } catch (e) {}
          p.fetched = true;
        }).catch(() => { p.fetched = true; });
      }
    }
  });

  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (mth, p) => new Promise(resolve => { const mid = ++id; pend.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method: mth, params: p || {} })); });
  const sendS = (mth, p) => new Promise(resolve => { const mid = ++id; pend.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method: mth, params: p || {}, sessionId: sid })); });

  await sleep(9000);
  const t = await send('Target.getTargets');
  let sid = null;
  if (t && t.result) { const pg = t.result.targetInfos.find(x => x.type === 'page'); if (pg) { const a = await send('Target.attachToTarget', { targetId: pg.targetId, flatten: true }); if (a && a.result) sid = a.result.sessionId; } }
  const ev = e => new Promise(resolve => {
    const mid = Math.floor(Math.random() * 1e9);
    const h = x => { try { const m = JSON.parse(x.data); if (m.id === mid) { ws.removeEventListener('message', h); resolve(m.result && m.result.result ? m.result.result.value : null); } } catch (err) {} };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression: e, returnByValue: true, awaitPromise: true }, sessionId: sid }));
    setTimeout(() => resolve(null), 45000);
  });

  await sendS('Page.enable');
  await sendS('Network.enable', {});

  let ddok = false;
  for (let k = 0; k < 15; k++) {
    await sleep(2000);
    const s = await ev(`JSON.stringify({l:document.documentElement.outerHTML.length,t:document.title,h:location.href})`);
    try { const o = JSON.parse(s); if (o && o.l > 200000 && /Log In/i.test(o.t || '')) { ddok = true; break; } } catch (e) {}
  }
  rec({ bid: BID, ddok });

  let hydrated = false;
  for (let a = 0; a < 3 && !hydrated; a++) {
    await send('Page.navigate', { url: 'https://www.yelp.com/login/' });
    for (let k = 0; k < 16; k++) {
      await sleep(1500);
      const s = await ev(`JSON.stringify({f:!!document.getElementById('ajax-login'),l:document.documentElement.outerHTML.length})`);
      try { const o = JSON.parse(s); if (o && o.f && o.l > 400000) { hydrated = true; break; } } catch (e) {}
    }
  }
  rec({ bid: BID, hydrated, sess: SESS });
  if (!hydrated) { chrome.kill(); relay.close(); return; }

  for (let i = 1; i <= N; i++) {
    const em = 'qa.aj' + BID + 'x' + i + '.' + Math.floor(Math.random() * 90000 + 10000) + '@example.com';
    const before = posts.size;
    for (let attempt = 0; attempt < 3; attempt++) {
      await ev(`(async function(){
        var f=document.getElementById('ajax-login');
        if(f && f.offsetParent===null){ var t=document.querySelector('.login-with-password-link'); if(t){ t.click(); await new Promise(function(r){setTimeout(r,700);}); } }
        f=document.getElementById('ajax-login'); if(!f) return 0;
        var e=f.querySelector('input[name=email]'), p=f.querySelector('input[name=password]');
        var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
        if(e){ e.focus(); setter.call(e, '${em}'); e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); }
        if(p){ p.focus(); setter.call(p, 'AjPw${i}Ww!'); p.dispatchEvent(new Event('input',{bubbles:true})); p.dispatchEvent(new Event('change',{bubbles:true})); }
        await new Promise(function(r){setTimeout(r,200);});
        var b=f.querySelector('button[type=submit]'); if(b){ b.click(); return 1; }
        return 0;
      })()`);
      await sleep(5000);
      if (posts.size > before) break;
      await sleep(2000);
    }
  }
  await sleep(6000);

  const list = [];
  for (const rid of finished) {
    const p = posts.get(rid);
    let body = p.body || '';
    if (!body) {
      const rb = await sendS('Network.getResponseBody', { requestId: rid });
      if (rb && rb.result && rb.result.body) {
        try { body = rb.result.base64Encoded ? Buffer.from(rb.result.body, 'base64').toString('utf8') : rb.result.body; } catch (e) {}
      }
    }
    const alert = (body.match(/<p class="alert-message">\s*([\s\S]*?)\s*<\/p>/) || [])[1] || '';
    const em = (p.postData.match(/email=([^&]+)/) || [])[1] || '';
    list.push({ seq: p.seq, url: p.url, status: p.status || 0, em: decodeURIComponent(em), alert: alert.replace(/\s+/g, ' ').trim().slice(0, 120), len: body.length, raw: body.replace(/\s+/g, ' ').slice(0, 260) });
  }
  rec({ bid: BID, posts: list });
  rec({ bid: BID, done: true });

  try { ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { relay.close(); } catch (e) {}
  setTimeout(() => process.exit(0), 1000);
})();



