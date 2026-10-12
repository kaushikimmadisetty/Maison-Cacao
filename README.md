# Maison Cacao

A 3D landing page for a chocolate maison: an imperial Roman hall with a river of chocolate, built with Three.js. No build step, no image assets. Every marble, flame and ripple is generated in the browser.

## Run it

Serve the folder with any static server. ES modules need to be served over HTTP, so opening the file directly won't work:

```bash
python3 -m http.server 5173
```

Then open http://localhost:5173.

## What's inside

- **The hall** (`src/hall.js`): coffered barrel vault, Corinthian colonnades, a full cornice with gold medallions, an inlaid marble floor, a half-moon window above the falls, gilded urns and fire bowls.
- **The river** (`src/river.js`): a glossy chocolate river and waterfall. The falls heap up, ripple and splash where they land.
- **The dive** (`src/dive.js`): press and hold the river to open a whirlpool and get pulled under.
- **Beneath the river** (`src/underworld.js`): a dim amber world of drifting cacao pods, truffles, gold leaf and bubbles, lit through the river's underside.
- **Textures** (`src/textures.js`): procedural marbles (statuario, giallo antico, verde antico, porphyry) and the floor and wall patterns.
