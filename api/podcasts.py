# Podcast highlights: serves episodes to the frontend (GET), and — when hit by the
# cron job with the routine secret — ingests new episodes from the tracked YouTube
# channels (podcasts.config.json), summarizing each with a cheap Claude model.
# Python, not Node, specifically because yt-dlp (the only reliable way left to pull
# YouTube's auto-captions; see mobile/README.md) has no good JS equivalent.
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

KV_URL = os.environ.get('KV_REST_API_URL')
KV_TOKEN = os.environ.get('KV_REST_API_TOKEN')
ROUTINE_SECRET = os.environ.get('ROUTINE_SECRET')
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY')
TIME_BUDGET_SECONDS = 45
CONFIG_PATH = os.path.join(os.path.dirname(__file__), '..', 'podcasts.config.json')


def kv(*args):
    req = urllib.request.Request(
        KV_URL,
        data=json.dumps(list(args)).encode(),
        headers={'Authorization': f'Bearer {KV_TOKEN}', 'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read()).get('result')


def http_get(url, headers=None, timeout=15):
    req = urllib.request.Request(url, headers=headers or {'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def parse_rss(xml_bytes):
    xml = xml_bytes.decode('utf-8', errors='replace')
    entries = re.findall(r'<entry>.*?</entry>', xml, re.S)
    out = []
    for e in entries:
        vid = re.search(r'<yt:videoId>([^<]+)</yt:videoId>', e)
        title = re.search(r'<title>([^<]*)</title>', e)
        published = re.search(r'<published>([^<]+)</published>', e)
        if vid and title and published:
            out.append({'videoId': vid.group(1), 'title': title.group(1), 'published': published.group(1)})
    return out


def fetch_transcript(video_id):
    """Returns plain transcript text, or None if unavailable. Never raises."""
    out_base = f'/tmp/cap_{video_id}_{int(time.time())}'
    try:
        subprocess.run(
            [sys.executable, '-m', 'yt_dlp', '--skip-download', '--write-auto-sub',
             '--sub-lang', 'en', '--sub-format', 'vtt', '--impersonate', 'chrome',
             '-o', out_base, f'https://www.youtube.com/watch?v={video_id}'],
            check=True, timeout=55, capture_output=True,
        )
    except Exception:
        return None
    vtt_path = out_base + '.en.vtt'
    if not os.path.exists(vtt_path):
        return None
    try:
        raw = open(vtt_path, encoding='utf-8', errors='replace').read()
    finally:
        try:
            os.remove(vtt_path)
        except OSError:
            pass
    lines = []
    prev = None
    for line in raw.split('\n'):
        line = line.strip()
        if not line or line == 'WEBVTT' or '-->' in line:
            continue
        if re.match(r'^\d+$', line) or line.startswith('Kind:') or line.startswith('Language:'):
            continue
        line = re.sub(r'<[^>]+>', '', line)  # strip inline VTT tags (e.g. karaoke timing)
        if line and line != prev:
            lines.append(line)
            prev = line
    text = ' '.join(lines)
    return text if len(text) > 200 else None


def summarize(transcript, title, show):
    """Returns {'highlights': [...], 'quote': '...'} or None on failure (caller should retry later)."""
    transcript = transcript[:60000]  # keep well under context/cost limits; episodes run long
    prompt = (
        f'This is the auto-generated transcript of a podcast episode. Show: "{show}". '
        f'Episode title: "{title}".\n\n'
        'Write 4-6 concise highlight bullets: the most substantive, specific points made '
        '(not filler, sponsor reads, or intros), for a business/tech/product reader skimming '
        'for value, one or two sentences each, in your own words. Optionally include one short '
        'verbatim standout quote (a sentence or two) if there is a genuinely quotable line — '
        'otherwise leave it empty.\n\n'
        'Respond with ONLY valid JSON, no markdown fences, no commentary: '
        '{"highlights": ["...", "..."], "quote": "..."}\n\n'
        f'Transcript:\n{transcript}'
    )
    req = urllib.request.Request(
        'https://api.anthropic.com/v1/messages',
        data=json.dumps({
            'model': 'claude-haiku-5-5',
            'max_tokens': 1024,
            'messages': [{'role': 'user', 'content': prompt}],
        }).encode(),
        headers={
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=50) as r:
            data = json.loads(r.read())
        text = data['content'][0]['text'].strip()
        text = re.sub(r'^```(json)?|```$', '', text, flags=re.M).strip()
        parsed = json.loads(text)
        highlights = [str(h) for h in parsed.get('highlights', []) if str(h).strip()]
        if not highlights:
            return None
        return {'highlights': highlights, 'quote': str(parsed.get('quote') or '')}
    except Exception:
        return None


def run_ingestion():
    start = time.time()
    channels = json.load(open(CONFIG_PATH))['channels']
    report = {'channelsChecked': 0, 'newVideos': 0, 'summarized': 0, 'skippedNoCaptions': 0,
              'deferred': 0, 'errors': []}

    for ch in channels:
        if time.time() - start > TIME_BUDGET_SECONDS:
            report['deferred'] += 1
            continue
        report['channelsChecked'] += 1
        try:
            entries = parse_rss(http_get(f"https://www.youtube.com/feeds/videos.xml?channel_id={ch['channelId']}"))
        except Exception as e:
            report['errors'].append(f"{ch['show']}: RSS fetch failed ({e})")
            continue

        title_filter = ch.get('titleFilter')
        if title_filter:
            entries = [e for e in entries if title_filter.lower() in e['title'].lower()]

        for entry in entries[:3]:
            if time.time() - start > TIME_BUDGET_SECONDS:
                report['deferred'] += 1
                break
            vid = entry['videoId']
            already = kv('SISMEMBER', f"podcast:seen:{ch['channelId']}", vid)
            if already == 1:
                continue

            report['newVideos'] += 1
            transcript = fetch_transcript(vid)
            if not transcript:
                report['skippedNoCaptions'] += 1
                kv('SADD', f"podcast:seen:{ch['channelId']}", vid)  # permanent: won't succeed later either
                continue

            result = summarize(transcript, entry['title'], ch['show'])
            if not result:
                report['deferred'] += 1
                continue  # transient (API hiccup) — don't mark seen, retry next run

            published_ms = 0
            try:
                import datetime
                published_ms = int(datetime.datetime.fromisoformat(
                    entry['published'].replace('Z', '+00:00')).timestamp() * 1000)
            except Exception:
                published_ms = int(time.time() * 1000)

            kv('HSET', f'podcast:episode:{vid}',
               'channelName', ch['show'], 'show', ch['show'], 'title', entry['title'],
               'url', f'https://www.youtube.com/watch?v={vid}',
               'thumbnail', f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg',
               'publishedAt', entry['published'],
               'highlights', json.dumps(result['highlights']),
               'quote', result['quote'])
            kv('ZADD', 'podcast:episodes', str(published_ms), vid)
            kv('SADD', f"podcast:seen:{ch['channelId']}", vid)
            report['summarized'] += 1

    kv('ZREMRANGEBYRANK', 'podcast:episodes', '0', '-201')
    report['durationSeconds'] = round(time.time() - start, 1)
    return report


def read_episodes(limit):
    ids = kv('ZREVRANGE', 'podcast:episodes', '0', str(limit - 1)) or []
    episodes = []
    for vid in ids:
        flat = kv('HGETALL', f'podcast:episode:{vid}') or []
        h = dict(zip(flat[0::2], flat[1::2]))
        if not h.get('title'):
            continue
        try:
            highlights = json.loads(h.get('highlights', '[]'))
        except Exception:
            highlights = []
        episodes.append({
            'id': vid,
            'channelName': h.get('channelName', ''),
            'show': h.get('show', ''),
            'title': h.get('title', ''),
            'url': h.get('url') or f'https://www.youtube.com/watch?v={vid}',
            'thumbnail': h.get('thumbnail', ''),
            'publishedAt': h.get('publishedAt', ''),
            'highlights': highlights,
            'quote': h.get('quote', ''),
        })
    return episodes


class handler(BaseHTTPRequestHandler):
    def _json(self, status, payload, cache=False):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        if cache:
            self.send_header('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.end_headers()

    def do_GET(self):
        if not KV_URL or not KV_TOKEN:
            self._json(500, {'error': 'storage not configured'})
            return

        qs = parse_qs(urlparse(self.path).query)
        cron_secret = (qs.get('cron') or [None])[0]
        auth_header = self.headers.get('Authorization', '')

        is_cron = bool(ROUTINE_SECRET) and (
            cron_secret == ROUTINE_SECRET or auth_header == f'Bearer {ROUTINE_SECRET}'
        )
        if is_cron:
            if not ANTHROPIC_API_KEY:
                self._json(500, {'error': 'ANTHROPIC_API_KEY not configured'})
                return
            try:
                report = run_ingestion()
                self._json(200, {'ok': True, **report})
            except Exception as e:
                self._json(500, {'ok': False, 'error': str(e)})
            return

        limit = min(int((qs.get('limit') or ['30'])[0] or 30), 100)
        episodes = read_episodes(limit)
        self._json(200, {'episodes': episodes}, cache=True)
