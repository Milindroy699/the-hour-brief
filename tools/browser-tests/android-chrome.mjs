// Drives Chrome on the Android emulator (same engine as the app's WebView) over DevTools, for checks headless desktop Chrome cannot make.
// Setup: boot the AVD, then:
//   adb root; adb shell "echo '_ --disable-fre --no-first-run --no-default-browser-check' > /data/local/tmp/chrome-command-line"; adb shell chmod 755 /data/local/tmp/chrome-command-line
//   adb shell am set-debug-app --persistent com.android.chrome; adb shell am start -a android.intent.action.VIEW -d about:blank -n com.android.chrome/com.google.android.apps.chrome.Main
//   adb forward tcp:9222 localabstract:chrome_devtools_remote
// Then: const c = await attach(); await c.preload(NATIVE stub); await c.goto(url); await c.ev('...'). Found the swipe-card overshoot this way.
export async function attach() {
  const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  return {
    send,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    async ev(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text }; return r.result?.result?.value; },
    async goto(url, wait = 2500) { await send('Page.navigate', { url }); await new Promise((r) => setTimeout(r, wait)); },
    async preload(src) { return (await send('Page.addScriptToEvaluateOnNewDocument', { source: src })).result.identifier; },
    close() { try { ws.close(); } catch (e) {} },
  };
}
