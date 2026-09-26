// Minimal headless-Chrome driver over the DevTools protocol (macOS Chrome path). Used by the browser tests here.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
export async function launch(port = 9333) {
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`,
     '--user-data-dir=/tmp/hb-chrome-' + Date.now(), '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.find(t => t.type === 'page')) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else listeners.forEach(f => f(d)); };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const errors = [];
  listeners.push(d => {
    if (d.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('console.error ' + d.params.args.map(a => a.value || a.description).join(' '));
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error' && !/favicon|404/.test(d.params.entry.text + d.params.entry.url)) errors.push('log ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
  });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  const api = {
    errors, send,
    async viewport(w, h, mobile = true, dark = false) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile });
      await send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    },
    async goto(url, wait = 1200) { await send('Page.navigate', { url }); await new Promise(r => setTimeout(r, wait)); },
    async ev(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
      return r.result?.result?.value;
    },
    async preload(src) { const r = await send('Page.addScriptToEvaluateOnNewDocument', { source: src }); return r.result.identifier; },
    async unpreload(id) { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id }); },
    // A real touch drag (compositor scroll, so scroll-snap and momentum apply). xDistance/yDistance follow the DevTools
    // convention: a positive distance moves the finger to the right/down.
    async swipe(x, y, xDistance, yDistance = 0, speed = 900) {
      await send('Input.synthesizeScrollGesture', { x, y, xDistance, yDistance, gestureSourceType: 'touch', speed, preventFling: false });
    },
    async shot(file) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); },
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    close() { try { ws.close(); } catch (e) {} chrome.kill(); },
  };
  return api;
}
