// Turns an edition page into the spoken script: the same units, in the same order and with the
// same wording rules as the on-device Listen mode (listen.js), so both voices read the same thing.
//   quick: intro, each section's takeaway, each story's headline + takeaway, outro
//   full:  intro, each section's takeaway, each story's headline + summary + labelled takeaway, outro
import * as cheerio from 'cheerio';

export function speakable(t) {
  return String(t || '')
    .replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, ' ')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s*[→›»]\s*/g, ' ')
    .replace(/\s+[—–]\s+/g, ', ')
    .replace(/~/g, 'about ')
    .replace(/\s+/g, ' ')
    .trim();
}
const stop = (t) => (/[.!?…]["'”’)\]]*$/.test(t) ? t : t + '.');

// Text of a node without its "Takeaway" label or the reading-time badge.
function clean($, node) {
  const c = $(node).clone();
  c.find('.takeaway-label, .lane-time').remove();
  return speakable(c.text());
}

// First sentences of a paragraph, up to `max` characters (fallback for stories without a takeaway).
function firstWords(text, max) {
  const sentences = text.match(/[\s\S]*?[.!?…]["'”’)\]]*(?:\s+|$)/g) || [text];
  let out = '';
  for (const s of sentences) {
    const next = out ? out + ' ' + s.trim() : s.trim();
    if (out && next.length > max) break;
    out = next;
  }
  return out;
}

export function editionMeta(html) {
  const $ = cheerio.load(html);
  const iso = $('[data-edition-date]').first().attr('data-edition-date') || '';
  const n = /Edition\s+0*(\d+)/i.exec($('.edition').first().text());
  return { date: /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : '', number: n ? Number(n[1]) : 0 };
}

export function buildUnits(html, mode = 'quick') {
  const $ = cheerio.load(html);
  const { date, number } = editionMeta(html);
  let when = '';
  if (date) {
    when = new Date(date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  const units = [{ id: 'intro', kind: 'intro', lane: 'The Hour Brief', title: 'Today’s brief',
    text: `The Hour Brief${number ? ', edition ' + number : ''}${when ? ', ' + when : ''}.` }];

  $('section.lane').each((_, lane) => {
    if (!$(lane).find('.item[data-story-id]').length) return;      // e.g. the quiz section: nothing to read
    const laneId = $(lane).attr('id') || '';
    const tag = clean($, $(lane).find('.lane-tag').first()) || 'This section';
    const lt = $(lane).find('.lane-takeaway').first();
    units.push({ id: 'lane:' + laneId, kind: 'lane', lane: tag, title: tag,
      text: stop(tag) + (lt.length ? ' ' + stop(clean($, lt)) : '') });

    $(lane).find('.item[data-story-id]').each((__, it) => {
      const head = speakable($(it).find('h3').first().text());
      if (!head) return;
      const tk = $(it).find('p.takeaway').first();
      const body = $(it).find('p').filter((___, p) => !$(p).hasClass('takeaway')).map((___, p) => speakable($(p).text())).get().join(' ');
      const parts = [stop(head)];
      if (mode === 'full') {
        if (body) parts.push(stop(body));
        if (tk.length) parts.push('Takeaway. ' + stop(clean($, tk)));
      } else if (tk.length) parts.push(stop(clean($, tk)));
      else if (body) parts.push(firstWords(body, 230));
      units.push({ id: 'story:' + $(it).attr('data-story-id'), kind: 'story', lane: tag, title: head, text: parts.join(' ') });
    });
  });

  units.push({ id: 'outro', kind: 'outro', lane: 'The Hour Brief', title: 'That’s the brief',
    text: $('#quiz').length ? 'That is today’s brief. Try the quiz below to see what stuck.' : 'That is today’s brief. See you tomorrow.' });
  return units;
}

// The text APIs accept a limited length per request: split on sentence ends, never mid-sentence.
export function splitForApi(text, max = 2400) {
  if (text.length <= max) return [text];
  const out = [];
  let cur = '';
  for (const s of text.match(/[\s\S]*?[.!?…]["'”’)\]]*(?:\s+|$)/g) || [text]) {
    if (cur && (cur + s).length > max) { out.push(cur.trim()); cur = ''; }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
