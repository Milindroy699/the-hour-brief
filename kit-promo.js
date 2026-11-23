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
    // About 20 words: what a voice says comfortably in 8 seconds.
    var hook = /[.?!]$/.test(sc.hook) ? sc.hook : sc.hook + '.';
    var vo = hook + ' The Hour Brief: the news that actually mattered, every morning. Free on iPhone and Android.';
    var prompt = [
      'Vertical 9:16 video, 8 seconds, photorealistic, ' + look + '.',
      'Seconds 0 to 6: ' + sc.scene + ' Camera: ' + cam + '.',
      'For the first two seconds, short white on-screen text in a clean sans-serif reads: ' + sc.hook,
      'Seconds 6 to 8: the shot moves smoothly into the final frame provided (the app\u2019s end card with a QR code) and holds on it, unchanged.',
      'Narration, a warm, confident Indian English voice, unhurried: "' + vo + '"',
      'Sound: ' + sc.sound + ' under the narration, then a soft, uplifting music sting on the end card.',
      'The phone screen glows softly but nothing on it is readable. No other text, no logos, no watermarks. Real Indian setting, people natural and unposed.',
    ].join('\n');
    var simple = prompt.replace(/Seconds 6 to 8:[^\n]*\n/, '').replace('8 seconds', '8 seconds').replace(/ then a soft, uplifting music sting on the end card\./, ' and a soft, uplifting music sting at the end.');
    var caption = sc.hook + (/[.?!]$/.test(sc.hook) ? ' ' : '. ') + 'The Hour Brief gives you the AI, business and Indian market news that mattered, in 7 minutes, with a daily quiz. Free on iPhone & Android 👉 ' + APP + '\n\n#news #AI #stockmarket #india #startups';
    return { scene: sc, look: look, cam: cam, prompt: prompt, simple: simple, vo: vo, caption: caption, shot: featureShot(sc.feature) };
  }
  function featureShot(f) {
    return /quiz/.test(f) ? 'screens/02-quiz.png' : /streak|badge|league/.test(f) ? 'screens/03-badges.png' : /audio/.test(f) ? 'screens/04-listen.png' : /Voices/.test(f) ? 'screens/05-voices.png' : 'screens/01-cards.png';
  }

  var CSS = '.pk-block{margin:18px 0 0}.pk-block h3{margin:0 0 6px;font-size:1rem}.pk-tag{display:inline-block;padding:3px 10px;border-radius:999px;background:var(--paper);border:1px solid var(--line);font-size:.8rem;color:var(--soft);margin:0 6px 6px 0}' +
    '.pk-assets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:8px}.pk-assets a{display:flex;flex-direction:column;gap:4px;text-decoration:none;color:var(--ink);font-size:.78rem}' +
    '.pk-assets img{width:100%;border-radius:10px;border:1px solid var(--line);background:#14122b}.pk-steps li{margin:6px 0}.pk-steps a{color:inherit;font-weight:600;text-decoration:underline;text-underline-offset:2px}';

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
    root.appendChild(h('p', { class: 'meta', text: 'One Veo 3 prompt makes the whole video: the scene, the voiceover, the sound and a title, ending on your QR end card. A new scene every day (today: ' + p.scene.feature + ').' }));
    var steps = h('ol', { class: 'pk-steps' });
    [['Download the end card below.', null],
      ['Open ', 'https://labs.google/fx/tools/flow', 'Google Flow', ', choose Veo 3, Frames to Video, portrait 9:16, and add the end card as the last frame.'],
      ['Paste the prompt and generate. Make two or three, keep the best, download it.', null],
      ['Post it as a Reel, a Short and your WhatsApp status with the caption.', null]].forEach(function (t) {
      var li = h('li');
      li.appendChild(document.createTextNode(t[0]));
      if (t[1]) { var a = h('a', { href: t[1], target: '_blank', rel: 'noopener', text: t[2] }); li.appendChild(a); li.appendChild(document.createTextNode(t[3])); }
      steps.appendChild(li);
    });
    root.appendChild(h('div', { class: 'pk-block' }, [steps]));
    root.appendChild(box('Veo 3 prompt', p.prompt, 13, 'Copy prompt'));
    var ec = '/brand/promo/endcard-9x16.png';
    root.appendChild(h('div', { class: 'pk-block' }, [h('h3', { text: 'Last frame: the end card' }),
      h('a', { href: ec, download: 'hour-brief-endcard-9x16.png', style: 'display:inline-block;max-width:160px' }, [h('img', { src: ec, alt: 'End card with the QR code', style: 'width:100%;border-radius:10px;border:1px solid var(--line)' })]),
      h('div', { class: 'row' }, [h('a', { class: 'btn primary', href: ec, download: 'hour-brief-endcard-9x16.png', text: 'Download end card' })])]));
    root.appendChild(box('Caption', p.caption, 6, 'Copy caption'));
    // Everything else, for when Frames to Video isn't available (e.g. the Gemini app) or for a longer edit
    var more = h('details', { class: 'pk-block' }, [h('summary', { text: 'More: without Flow, other sizes, app screenshots' })]);
    more.appendChild(box('Prompt without the end-card frame (Gemini app, Kling, Sora)', p.simple, 10, 'Copy'));
    more.appendChild(h('p', { class: 'hint', text: 'Then add the end card as the last 3 seconds in CapCut or InShot.' }));
    var assets = h('div', { class: 'pk-assets' });
    [['endcard-1x1.png', 'End card 1:1'], ['endcard-16x9.png', 'End card 16:9'], ['qr.png', 'QR alone'],
      ['screens/01-cards.png', 'Cards'], ['screens/02-quiz.png', 'Daily quiz'], ['screens/03-badges.png', 'Badges and streaks'],
      ['screens/04-listen.png', 'Audio'], ['screens/05-voices.png', 'Voices'], ['screens/06-list.png', 'Every story, with its source']].forEach(function (a) {
      var url = '/brand/promo/' + a[0];
      assets.appendChild(h('a', { href: url, download: 'hour-brief-' + a[0].replace(/\//g, '-') }, [h('img', { src: url, alt: '', loading: 'lazy' }), document.createTextNode(a[1] + ' ↓')]));
    });
    more.appendChild(assets);
    more.appendChild(h('p', { class: 'hint', text: 'The QR opens the right store for whoever scans it and counts installs from your videos as “promo-video”.' }));
    root.appendChild(more);
  }
  window.HBPromo = { mount: mount, build: build };
})();
