// Serves podcast highlights to the frontend. Read-only — the scheduled routine that
// finds new episodes and writes highlights talks to Redis directly, not through this
// endpoint. See mobile/README.md (Podcast highlights) for how ingestion works.
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kv(command) {
  const path = command.map((c) => encodeURIComponent(c)).join('/');
  const res = await fetch(`${KV_URL}/${path}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  return (await res.json()).result;
}

function toObj(flat) {
  const obj = {};
  for (let i = 0; i + 1 < (flat || []).length; i += 2) obj[flat[i]] = flat[i + 1];
  return obj;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  if (!KV_URL || !KV_TOKEN) {
    res.status(500).json({ error: 'storage not configured' });
    return;
  }

  const limit = Math.min(parseInt((req.query || {}).limit, 10) || 30, 100);
  const ids = (await kv(['ZREVRANGE', 'podcast:episodes', '0', String(limit - 1)])) || [];

  const episodes = await Promise.all(
    ids.map(async (id) => {
      const flat = await kv(['HGETALL', `podcast:episode:${id}`]);
      const h = toObj(flat);
      if (!h.title) return null;
      let highlights = [];
      try { highlights = JSON.parse(h.highlights || '[]'); } catch (e) { highlights = []; }
      return {
        id,
        channelName: h.channelName || '',
        show: h.show || '',
        title: h.title,
        url: h.url || `https://www.youtube.com/watch?v=${id}`,
        thumbnail: h.thumbnail || '',
        publishedAt: h.publishedAt || '',
        highlights,
        quote: h.quote || '',
      };
    })
  );

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.status(200).json({ episodes: episodes.filter(Boolean) });
};
