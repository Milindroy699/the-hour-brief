// Public, read-only: today's channel post text (used by /share-kit.html). Contains only published content.
const { buildDigest } = require('./_digest');

module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.status(405).json({ error: 'method not allowed' }); return; }
  const d = await buildDigest();
  if (!d) { res.status(502).json({ error: 'could not read the latest edition' }); return; }
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.status(200).json(d);
};
