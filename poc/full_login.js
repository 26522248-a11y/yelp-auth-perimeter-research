const http = require('http');
const net = require('net');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const N = parseInt(process.env.N || '3', 10);
const EMAIL = process.env.EMAIL || 'qa.probe7.5657@example.com';
const PASS = process.env.PASS || 'Str0ngPass!2026x';
const OUT = process.env.OUT || 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\2\\opencode\\full.jsonl';

const PH = 'pr.oxylabs.io', PP = 7777;
const SESS = 'flx' + Math.floor(Math.random() * 100000);
const PU = 'customer-mobile_<REDACTED>-sessid-' + SESS + '-sesstime-60';
const PW = '<REDACTED_PROXY_PASS>';
const AUTH = 'Basic ' + Buffer.from(PU + ':' + PW).toString('base64');
const LP = 8960, CP = 9280;

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
  const udd = path.join(os.tmpdir(), 'cdp-fl-' + Date.now());
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled',
    '--window-size=1100,800', '--lang=en-US', '--user-data-dir=' + udd,
    '--proxy-server=http://127.0.0.1:' + LP, '--remote-debugging-port=' + CP,
    'https://www.yelp.com/login'
  ], { stdio: 'ignore' });

  const ver = await j('http://127.0.0.1:' + CP + '/json/version', 40);
  if (!ver) { rec({ err: 'cdp' }); chrome.kill(); relay.close(); return; }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const posts = new Map(); const finished = [];
  ws.addEventListener('message', ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === 'Network.requestWillBeSent') {
      const r = m.params.request;
      if (r.method === 'POST' && /\/login/.test(r.url)) posts.set(m.params.requestId, { url: r.url, postData: r.postData || '' });
    } else if (m.method === 'Network.loadingFinished') {
      if (posts.has(m.params.requestId)) {
        finished.push(m.params.requestId);
        const p = posts.get(m.params.requestId);
        sendS('Network.getResponseBody', { requestId: m.params.requestId }).then(rb => {
          try { if (rb && rb.result && rb.result.body) p.body = rb.result.base64Encoded ? Buffer.from(rb.result.body, 'base64').toString('utf8') : rb.result.body; } catch (e) {}
        }).catch(() => {});
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
  await sendS('Page.enable'); await sendS('Network.enable', {});

  for (let i = 1; i <= N; i++) {
    let ok = false;
    for (let a = 0; a < 4 && !ok; a++) {
      await sendS('Page.navigate', { url: 'https://www.yelp.com/login/' });
      for (let k = 0; k < 16; k++) {
        await sleep(1500);
        const s = await ev(`JSON.stringify({f:!!document.getElementById('ajax-login'),l:document.documentElement.outerHTML.length})`);
        try { const o = JSON.parse(s); if (o && o.f && o.l > 400000) { ok = true; break; } } catch (e) {}
      }
    }
    if (!ok) { rec({ i, err: 'nothydrated' }); continue; }

    const before = finished.length;
    await ev(`(async function(){
      var f=document.getElementById('ajax-login');
      if(f && f.offsetParent===null){ var t=document.querySelector('.login-with-password-link'); if(t){ t.click(); await new Promise(function(r){setTimeout(r,700);}); } }
      f=document.getElementById('ajax-login'); if(!f) return 0;
      var e=f.querySelector('input[name=email]'), p=f.querySelector('input[name=password]');
      var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      e.focus(); setter.call(e, '${EMAIL}'); e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));
      p.focus(); setter.call(p, '${PASS}'); p.dispatchEvent(new Event('input',{bubbles:true})); p.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(function(r){setTimeout(r,200);});
      f.querySelector('button[type=submit]').click();
      return 1;
    })()`);
    await sleep(11000);

    const state = await ev(`JSON.stringify({href:location.href,title:document.title,hasLogin:!!document.getElementById('ajax-login'),alert:(document.querySelector('.alert-message')||{}).textContent||'',body:document.body.innerText.slice(0,80)})`);
    const prof = await ev(`(async()=>{ try { const r=await fetch('/profile',{credentials:'include'}); return r.status; } catch(e){ return -1; } })()`);
    const resp = [];
    for (const rid of finished.slice(before)) {
      const p = posts.get(rid);
      resp.push({ url: p.url, body: (p.body || '').replace(/\s+/g, ' ').slice(0, 160) });
    }
    await sendS('Page.navigate', { url: 'https://business.yelp.com/' });
    await sleep(6000);
    const biz = await ev(`JSON.stringify({href:location.href,title:document.title,body:document.body.innerText.slice(0,120)})`);
    await sendS('Page.navigate', { url: 'https://terms.yelp.com/wp-admin/' });
    await sleep(6000);
    const terms = await ev(`JSON.stringify({href:location.href,title:document.title,body:document.body.innerText.slice(0,120)})`);
    rec({ i, state, profileStatus: prof, resp, biz, terms });
    console.log('FL' + i + ' ' + JSON.stringify({ state, profileStatus: prof, resp }));
  }

  try { ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { relay.close(); } catch (e) {}
  setTimeout(() => process.exit(0), 1000);
})();

