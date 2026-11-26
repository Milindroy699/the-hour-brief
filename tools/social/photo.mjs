// Real pictures for the story slides (owner, 2026-11-26: "showing the brand or the person … like Audiline"). Only freely
// licensed photos, from the lead image of the subject's English Wikipedia article (Wikimedia Commons), each shown with its
// credit and licence on the slide; never news-agency photos (their photographers own them) and never AI likenesses of real
// people. No free photo: the story keeps its illustration.
//   entityFor(story)   the main person or company in a story (the Workers AI model), as a Wikipedia article title
//   freePhoto(title)   { url, buf, credit, license, page } or null
const UA = 'TheHourBrief/1.0 (https://the-hour-brief.vercel.app/contact.html)';
const FREE = /^(cc0|cc[ -]by(-sa)?([ -][\d.]+)?|public domain|pd\b|pd-|godl)/i;   // GODL-India: India's open government licence

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
const strip = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

export async function freePhoto(title) {
  if (!title) return null;
  let sum;
  try { sum = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`); } catch (e) { return null; }
  if (!sum || sum.type === 'disambiguation' || !sum.originalimage || !sum.originalimage.source) return null;
  const file = decodeURIComponent(sum.originalimage.source.split('?')[0].split('/').pop());
  if (!/\.(jpe?g)$/i.test(file)) return null;                       // photos only (logos are SVG/PNG and read poorly this big)
  if (sum.originalimage.width < 500 || sum.originalimage.height < 500) return null;
  let info;
  try {
    const q = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=${encodeURIComponent('File:' + file)}&prop=imageinfo&iiprop=extmetadata|url&iiurlwidth=1080`);
    const page = Object.values((q.query && q.query.pages) || {})[0];
    if (!page || page.missing !== undefined || !page.imageinfo) return null;   // not on Commons: a non-free (fair-use) file
    info = page.imageinfo[0];
  } catch (e) { return null; }
  const m = info.extmetadata || {};
  const license = strip(m.LicenseShortName && m.LicenseShortName.value);
  if (!FREE.test(license) || /non-free|fair use/i.test(license)) return null;
  const artist = strip(m.Artist && m.Artist.value).replace(/^(photo(graph(er)?)?|credit)(\s*by)?\s*:?\s*/i, '').slice(0, 60) || 'Unknown';
  const url = info.thumburl || info.url;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return { url, buf, license, artist, page: sum.content_urls && sum.content_urls.desktop && sum.content_urls.desktop.page, credit: `Photo: ${artist} / Wikimedia Commons, ${license}` };
  } catch (e) { return null; }
}

// The main person in a story, as the exact English Wikipedia title (or null). People only: for a company, Wikipedia's lead
// picture is often an office building or a logo, which would mislead or read poorly, so companies keep their illustration. Asks the same Workers AI model as the picture ideas.
export async function entityFor(story) {
  const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
  if (!token || !account) return null;
  for (const model of ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct']) {
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_tokens: 60, temperature: 0, messages: [
          { role: 'system', content: 'You name the one real, well-known PERSON a news headline is about, as the exact title of their English Wikipedia article (for example "Jensen Huang", "Sundar Pichai", "Nirmala Sitharaman"). Reply with only the title. Reply NONE if no single named person is central to the story (a company, a market, an index, a policy or a trend).' },
          { role: 'user', content: `Headline: ${story.head}\nWhy it matters: ${story.take || ''}` },
        ] }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json();
      const t = String((j.result && j.result.response) || '').split('\n')[0].replace(/^["'\s]+|["'.\s]+$/g, '');
      if (!t || /^none$/i.test(t) || t.length > 60) return null;
      return t;
    } catch (e) { /* the next model */ }
  }
  return null;
}

if (process.argv[1] && process.argv[1].endsWith('photo.mjs') && process.argv[2]) {
  for (const t of process.argv.slice(2)) { const p = await freePhoto(t); console.log(t, '->', p ? `${p.credit} (${p.buf.length} bytes) ${p.url}` : 'no free photo'); }
}
