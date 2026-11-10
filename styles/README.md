One file per reference author: `<author-slug>.md`, referenced from `leaders.config.json`
via a creator's `styleAuthor` field (the slug, e.g. `ben-thompson`).

Each file is built once, interactively, from sample articles the author provides —
not generated automatically. It should capture: voice/tone, typical sentence
rhythm and structure, recurring devices or framings, vocabulary quirks, and 1-2
short illustrative excerpts for few-shot grounding. `api/leaders.js` reads these
files at generation time and includes them in the prompt when writing a roundup
in that author's style.
