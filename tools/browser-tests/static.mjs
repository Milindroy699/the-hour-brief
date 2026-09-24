// Static file server for the repo root, plus /__audio/* that serves a generated recording directory with
// Range support and a control endpoint (/__ctl?manifest=ok|404|mismatch&audio=ok|404) for failure tests.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.xml': 'application/xml', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };

export function start({ port = 8788, audioDir }) {
  const ctl = { manifest: 'ok', audio: 'ok' };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, body, type = 'text/plain') => { res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }); res.end(body); };
    if (u.pathname === '/__ctl') { Object.assign(ctl, Object.fromEntries(u.searchParams)); return send(200, JSON.stringify(ctl)); }
    if (u.pathname.startsWith('/__audio/')) {
      const rel = u.pathname.slice('/__audio/'.length);
      const file = path.join(audioDir, rel);
      const isManifest = rel.endsWith('manifest.json');
      if (!file.startsWith(audioDir) || !fs.existsSync(file)) return send(404, 'nf');
      if (isManifest) {
        if (ctl.manifest === '404') return send(404, 'nf');
        const m = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (ctl.manifest === 'mismatch') m.modes.quick.cues = m.modes.quick.cues.filter((c) => c.id !== 'story:ai-2');
        return send(200, JSON.stringify(m), 'application/json');
      }
      if (ctl.audio === '404') return send(404, 'nf');
      const buf = fs.readFileSync(file);
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (range) {
        const a = range[1] ? Number(range[1]) : 0, b = range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
        res.writeHead(206, { 'Content-Type': 'audio/mpeg', 'Content-Range': `bytes ${a}-${b}/${buf.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1, 'Access-Control-Allow-Origin': '*' });
        return res.end(buf.subarray(a, b + 1));
      }
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Content-Length': buf.length, 'Access-Control-Allow-Origin': '*' });
      return res.end(buf);
    }
    let p = path.join(ROOT, decodeURIComponent(u.pathname));
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!p.startsWith(ROOT) || !fs.existsSync(p)) return send(404, 'nf');
    send(200, fs.readFileSync(p), TYPES[path.extname(p)] || 'application/octet-stream');
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, ctl, url: `http://127.0.0.1:${port}` })));
}
