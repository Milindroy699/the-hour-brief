# Reward art

Made in Nano Banana Pro from the Playbook prompts (owner, 21 Nov 2026); the original sheets are in `source/`.
Cut out by `tools/brand/rewards_cutout.py` (transparent WebP; re-run it after replacing a source sheet).

- `badges/` 256 px round medallions: first, perfect, streak3, streak7, streak30, regular, sharp, champion (the eight the
  app has), listener, voices, earlybird, century (+ century-alt), and `locked` (the plain hourglass, for locked badges).
- `medals/` 320 px quiz result tiers: perfect (gold, 5/5), sharp (silver, 4/5), solid (bronze, 3/5), keepgoing (0-2).
- `flames/` 256 px streak stages: spark (1-2 days), flame (3-6), blaze (7-29), inferno (30-99), legend (100+).
- `scenes/` 480 px square illustrations on their own pale paper (white 3D objects can't be cut out): saved-empty,
  no-league, offline, quiz-done, sign-in. Show them in a rounded tile; in dark mode the tile stays light.
- `icons/` 256 px: hourglass, brief, reminder, world.
- `confetti/` 64 px pieces (a00..., b00...) for the perfect-score and milestone bursts, animated in CSS.
