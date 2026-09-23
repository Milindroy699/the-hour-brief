// Builds the daily channel post (Telegram + WhatsApp) from the latest published edition.
const { CANON, esc, loadEdition, editionInfo } = require('./_edition');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function prettyDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  if (!m) return '';
  const wd = DAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  return `${wd} ${+m[3]} ${MONTHS[+m[2] - 1]}`;
}

function quizCount(html) {
  const m = /<script type="application\/json" id="quiz-data">([\s\S]*?)<\/script>/.exec(html);
  if (!m) return 0;
  try { return ((JSON.parse(m[1]) || {}).questions || []).length; } catch (e) { return 0; }
}

async function buildDigest() {
  const html = await loadEdition('latest');
  if (!html) return null;
  const info = editionInfo(html, 300);
  if (!info.d) return null;
  const n = quizCount(html);
  const editionUrl = `${CANON}/e/${info.d}`;
  const quizUrl = `${CANON}/archive/${info.d}.html?utm_source=digest&utm_medium=channel#quiz`;
  const head = `The Hour Brief · Edition ${info.n}`;
  const when = prettyDate(info.d);
  const lanes = [
    ['🤖', 'AI & Tech', info.lanes.ai],
    ['💼', 'Product & Business', info.lanes.biz],
    ['📈', 'Stock Market', info.lanes.mkt],
  ].filter((l) => l[2]);
  const quizLine = n ? `Today’s ${n}-question quiz — about a minute` : '';

  const telegram = [
    `📰 <b>${esc(head)}</b>`,
    `<i>${esc(when)}</i>`,
    '',
    ...lanes.flatMap(([icon, name, t]) => [`${icon} <b>${esc(name)}</b>`, esc(t), '']),
    ...(n ? [`🧠 <b>${esc(quizLine)}</b>`, `<a href="${esc(quizUrl)}">Play the quiz</a>`, ''] : []),
    `📖 <a href="${esc(editionUrl)}">Read the full edition</a>`,
  ].join('\n');

  const plainLines = (bold) => [
    `📰 ${bold(head)} · ${when}`,
    '',
    ...lanes.flatMap(([icon, name, t]) => [`${icon} ${bold(name)}`, t, '']),
    ...(n ? [`🧠 ${quizLine}: ${quizUrl}`, ''] : []),
    `📖 Full edition: ${editionUrl}`,
  ].join('\n');

  return {
    edition: info.n,
    date: info.d,
    quizQuestions: n,
    editionUrl,
    quizUrl,
    image: `${CANON}/api/og?${new URLSearchParams({ type: 'edition', n: info.n, d: info.d, ai: info.lanes.ai || '', biz: info.lanes.biz || '', mkt: info.lanes.mkt || '' }).toString()}`,
    telegram,
    whatsapp: plainLines((s) => `*${s}*`),
    plain: plainLines((s) => s),
  };
}

module.exports = { buildDigest, prettyDate };
