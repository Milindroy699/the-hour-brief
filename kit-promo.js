// The daily promo video (owner, 2026-11-23): a fresh AI-video prompt every day for Veo (Gemini / Flow), Kling, Sora or
// Runway, plus everything to finish the video in an editor: a voiceover line, on-screen text, the app screenshots and an
// end card with a QR to the app (brand/promo/, made by tools/brand/promo-assets.mjs). Mounted by the post kit's
// "Promo video" tab (share-kit.html#promo).
// Rotation: 14 scenes (each tied to one feature) x 4 looks x 5 camera moves, picked by the day, so the prompt is new every
// day and the same scene comes back in a different look. AI video can't draw the real app or text reliably, so prompts ask
// for neither: the real app arrives in the edit, as screenshots and the end card.
(function () {
  'use strict';
  var SCENES = [
    { name: 'Morning local train', feature: 'the 7-minute brief', hook: 'Your commute just got smarter',
      scene: 'A young Indian woman in a kurta stands in a crowded Mumbai local train at sunrise, holding the overhead rail with one hand and her phone in the other. She reads, then smiles slightly, as if she just understood something.',
      sound: 'train wheels on the rails, distant announcements' },
    { name: 'Chai at the tapri', feature: 'the 7-minute brief', hook: 'Chai, and the news that mattered',
      scene: 'Early morning at a roadside chai stall in an Indian city. A man in his thirties in a crisp shirt holds a small glass of steaming chai in one hand and scrolls his phone with the other, steam drifting past.',
      sound: 'chai being poured, light street ambience, a scooter passing' },
    { name: 'Office league', feature: 'office leagues', hook: 'Who reads the news best in your office?',
      scene: 'Three colleagues in a bright Bengaluru tech office pantry lean over one phone, then two of them look at their own phones and laugh in friendly rivalry, one raising a fist in mock victory.',
      sound: 'office hum, coffee machine, laughter' },
    { name: 'Metro with earphones', feature: 'audio', hook: 'Hands busy? Listen to it',
      scene: 'A college student with wireless earbuds sits in a clean Delhi Metro carriage, eyes half closed, nodding as he listens, phone resting in his hand, city lights sliding past the window.',
      sound: 'metro hum, a soft door chime' },
    { name: 'Balcony morning', feature: 'the 7-minute brief', hook: 'Seven minutes. Fully caught up.',
      scene: 'A middle-aged Indian father on a balcony full of potted plants at dawn, a cup of filter coffee beside him, reads his phone calmly as the city wakes up below.',
      sound: 'birds, distant traffic, a cup set down on a table' },
    { name: 'Hostel quiz', feature: 'the daily quiz', hook: 'Can you get 5 out of 5?',
      scene: 'Four friends in a college hostel room crowd around one phone on a bed, tense for a second, then erupt in cheers and high-fives as if someone just got every answer right.',
      sound: 'excited voices, a cheer, laughter (no clear words)' },
    { name: 'Auto-rickshaw ride', feature: 'the 7-minute brief', hook: 'Caught up before you get there',
      scene: 'A young professional woman rides in the back of an auto-rickshaw through a busy Indian street in the morning, reading her phone, the city blurring by, then looks up with a confident expression.',
      sound: 'auto-rickshaw engine, horns in the distance' },
    { name: 'Founder before the meeting', feature: 'Voices long reads', hook: 'Think like the best minds, weekly',
      scene: 'A startup founder in a glass-walled meeting room checks her phone, nods to herself, then walks to a whiteboard and starts writing with energy, colleagues looking up.',
      sound: 'marker on whiteboard, quiet office' },
    { name: 'Market open', feature: 'Indian markets', hook: 'Know the market before it opens',
      scene: 'A young investor at a home desk before 9 a.m., laptop showing soft out-of-focus chart colours, glances at his phone, then leans back with a relaxed half-smile and sips tea.',
      sound: 'quiet room, a clock ticking, a cup set down' },
    { name: 'After the run', feature: 'audio', hook: 'Your run, with the morning news',
      scene: 'A woman finishing a morning run on a seaside promenade in Mumbai slows to a walk, earbuds in, glances at her phone and smiles, the sea glowing behind her.',
      sound: 'waves, seagulls, footsteps slowing' },
    { name: 'Breakfast table', feature: 'leagues with friends', hook: 'Breakfast, and a friendly rivalry',
      scene: 'A young couple at a breakfast table with parathas and chai, each on their phone, one turns the screen to the other with a playful smug grin, the other laughs and shakes their head.',
      sound: 'cutlery, laughter, morning kitchen' },
    { name: 'Airport gate', feature: 'the 7-minute brief', hook: 'Board fully briefed',
      scene: 'A businesswoman at an Indian airport gate at dawn, rolling bag beside her, reads her phone with focus as planes taxi outside the big window, then stands as boarding begins.',
      sound: 'airport announcements in the distance, rolling suitcase' },
    { name: 'Sunday slow morning', feature: 'the Sunday recap', hook: 'Missed the week? Get it in one read',
      scene: 'A relaxed Sunday morning: a man on a sofa in a sunlit living room, feet up, a folded newspaper set aside on the table, reading his phone with a calm, satisfied look.',
      sound: 'soft fan, birds outside, pages rustling' },
    { name: 'Streak before bed', feature: 'streaks and badges', hook: 'Don’t break the streak',
      scene: 'Late evening, a young woman in a dim bedroom lit by a warm lamp remembers something, picks up her phone, taps quickly, then sets it down with a satisfied smile and a small fist pump.',
      sound: 'quiet room, a soft phone tap' },
  ];
  var LOOKS = [
    'cinematic, shallow depth of field, warm golden-hour light, subtle film grain',
    'documentary style, handheld, natural light, true-to-life colour',
    'clean modern commercial look, soft light with gentle violet and gold accents',
    'bright, airy and optimistic, high-key light, crisp detail',
  ];
  var CAMERAS = ['slow push-in toward the person', 'gentle handheld follow at shoulder height', 'slow orbit around the person', 'static close-up, then a slow pull-back', 'low angle slowly rising to eye level'];
  var SITE = 'https://the-hour-brief.vercel.app';
  var APP = SITE + '/app?src=promo-video';

  function dayIndex(date) { return Math.floor(Date.parse(date + 'T00:00:00Z') / 864e5); }
  function trimHeadline(t, n) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; }

  function build(s) {
    var date = s.date, d = dayIndex(date);
    var sc = SCENES[d % SCENES.length], look = LOOKS[Math.floor(d / SCENES.length) % LOOKS.length], cam = CAMERAS[d % CAMERAS.length];
    var alt = SCENES[(d + 5) % SCENES.length];
    var headline = trimHeadline(s.insight || s.headline || '', 110);
    var rules = 'The phone screen glows softly but nothing on it is readable. No text, captions, subtitles, logos or watermarks anywhere in the frame. Real Indian setting, people look natural and unposed.';
    var prompt = 'Vertical 9:16 video, 8 seconds, photorealistic. ' + sc.scene + ' Camera: ' + cam + '. Look: ' + look + '. ' + rules + ' Sound: ' + sc.sound + '; no music, no spoken words.';
    var insert = 'Vertical 9:16 video, 5 seconds, photorealistic macro close-up. ' + 'A hand holds a phone; a thumb swipes and taps; the screen gives off a soft violet glow, reflected on the fingers; a small golden sparkle of light flickers once, like a reward. ' + 'Camera: slow push-in. Look: ' + look + '. ' + rules + ' Sound: a soft tap, a gentle chime.';
    var vo = sc.hook + '. The Hour Brief: the AI, business and market news that actually mattered, in seven minutes. Free on iPhone and Android.';
    var overlays = [
      '0–2 s:  ' + sc.hook,
      '2–5 s:  7-minute brief · audio · daily quiz',
      '5–8 s:  Today: ' + trimHeadline(headline, 70),
      '8–10 s: an app screenshot (' + featureShot(sc.feature) + ')',
      '10–13 s: end card with the QR (endcard-9x16.png)',
    ].join('\n');
    var caption = sc.hook + '. The Hour Brief gives you the AI, business and Indian market news that mattered, in 7 minutes, with a daily quiz. Free on iPhone & Android 👉 ' + APP + '\n\n#news #AI #stockmarket #india #startups';
    return { scene: sc, look: look, cam: cam, alt: alt, prompt: prompt, insert: insert, vo: vo, overlays: overlays, caption: caption };
  }
  function featureShot(f) {
    return /quiz/.test(f) ? 'screens/02-quiz.png' : /streak|badge|league/.test(f) ? 'screens/03-badges.png' : /audio/.test(f) ? 'screens/04-listen.png' : /Voices/.test(f) ? 'screens/05-voices.png' : 'screens/01-cards.png';
  }

  var CSS = '.pk-block{margin:18px 0 0}.pk-block h3{margin:0 0 6px;font-size:1rem}.pk-tag{display:inline-block;padding:3px 10px;border-radius:999px;background:var(--paper);border:1px solid var(--line);font-size:.8rem;color:var(--soft);margin:0 6px 6px 0}' +
    '.pk-assets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:8px}.pk-assets a{display:flex;flex-direction:column;gap:4px;text-decoration:none;color:var(--ink);font-size:.78rem}' +
    '.pk-assets img{width:100%;border-radius:10px;border:1px solid var(--line);background:#14122b}.pk-steps li{margin:6px 0}';

  function mount(root, s, copy) {
    if (!s) { root.innerHTML = '<p class="meta">Loading today’s post kit…</p>'; return; }
    if (root.dataset.day === s.date) return;
    root.dataset.day = s.date;
    if (!document.getElementById('pk-css')) { var st = document.createElement('style'); st.id = 'pk-css'; st.textContent = CSS; document.head.appendChild(st); }
    var p = build(s);
    root.innerHTML = '';
    var h = function (tag, attrs, kids) { var e = document.createElement(tag); for (var k in attrs || {}) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); } (kids || []).forEach(function (c) { if (c) e.appendChild(c); }); return e; };
    var box = function (title, text, rows, btnLabel) {
      var ta = h('textarea', { readonly: '', 'aria-label': title, style: 'min-height:' + rows + 'em' }); ta.value = text;
      var b = h('button', { type: 'button', text: btnLabel || 'Copy' }); b.addEventListener('click', function () { copy(text); });
      return h('div', { class: 'pk-block' }, [h('h3', { text: title }), ta, h('div', { class: 'row' }, [b])]);
    };
    root.appendChild(h('h2', { text: 'Promo video · ' + p.scene.name }));
    root.appendChild(h('p', { class: 'meta', text: 'A new scene every day. Today it shows ' + p.scene.feature + '. About 15 minutes from prompt to post.' }));
    root.appendChild(h('div', {}, [h('span', { class: 'pk-tag', text: 'Look: ' + p.look.split(',')[0] }), h('span', { class: 'pk-tag', text: 'Camera: ' + p.cam })]));
    root.appendChild(box('1. Video prompt (8 seconds)', p.prompt, 9, 'Copy prompt'));
    root.appendChild(box('2. Close-up insert (optional, 5 seconds)', p.insert, 6, 'Copy insert prompt'));
    var steps = h('ol', { class: 'pk-steps' });
    ['Paste the prompt into Veo (Gemini app or labs.google/flow), Kling, Hailuo, Sora or Runway. Make 2–3 versions, keep the best. Vertical 9:16.',
      'Open CapCut (or InShot): a 9:16 project. Put in the clip, the close-up if you made one, then one app screenshot for 2 seconds and the end card for 3 seconds (below).',
      'Add the on-screen text and the voiceover (CapCut’s text to speech, or your own voice). Quiet music under it.',
      'Export 1080p. Post as an Instagram Reel, a YouTube Short and your WhatsApp status, with the caption below.'].forEach(function (t) { steps.appendChild(h('li', { text: t })); });
    root.appendChild(h('div', { class: 'pk-block' }, [h('h3', { text: '3. Put it together' }), steps]));
    root.appendChild(box('4. Voiceover', p.vo, 4, 'Copy voiceover'));
    root.appendChild(box('5. On-screen text (add in the editor)', p.overlays, 7, 'Copy text'));
    var assets = h('div', { class: 'pk-assets' });
    [['endcard-9x16.png', 'End card 9:16 (Reels, Shorts)'], ['endcard-1x1.png', 'End card 1:1'], ['endcard-16x9.png', 'End card 16:9 (YouTube)'],
      ['screens/01-cards.png', 'Cards'], ['screens/02-quiz.png', 'Daily quiz'], ['screens/03-badges.png', 'Badges and streaks'],
      ['screens/04-listen.png', 'Audio'], ['screens/05-voices.png', 'Voices'], ['screens/06-list.png', 'Every story, with its source'], ['qr.png', 'QR alone (to /app?src=promo-video)']].forEach(function (a) {
      var url = '/brand/promo/' + a[0];
      assets.appendChild(h('a', { href: url, download: 'hour-brief-' + a[0].replace(/\//g, '-') }, [h('img', { src: url, alt: '', loading: 'lazy' }), document.createTextNode(a[1] + ' ↓')]));
    });
    root.appendChild(h('div', { class: 'pk-block' }, [h('h3', { text: '6. App screenshots and end cards (the same every day)' }), h('p', { class: 'hint', style: 'margin:0 0 6px', text: 'Tap to download. The QR opens the store page for the phone that scans it, and counts installs from your videos as “promo-video” in the growth report.' }), assets]));
    root.appendChild(box('7. Caption for posting', p.caption, 6, 'Copy caption'));
  }
  window.HBPromo = { mount: mount, build: build };
})();
