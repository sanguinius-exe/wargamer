# Wargamer

A browser tool for running division-level wargames on real satellite imagery.

A GM draws a **theatre of operations** on the world map, drags divisions for each
side onto it, and gives every unit its condition — strength, readiness, supply,
morale, posture. Units are drawn with proper **APP-6 / MIL-STD-2525C** symbology
(via [milsymbol](https://github.com/spatialillusions/milsymbol)). The whole
scenario — order of battle plus optionally the downloaded map imagery — travels
as a single `.wargame` file that anyone can open in the app.

Everything runs client-side; there is no server.

## Features

- **Theatre of operations** — draw a rectangle; everything outside it dims.
- **Order of battle** — teams mapped to standard identities (friend / hostile /
  neutral / …), each with a roster of divisions you drag onto the map.
- **Condition editor** — per-division strength / readiness / supply / morale,
  posture, HQ / task-force flags, reinforced-reduced, notes. Combat effectiveness
  and the operational-condition bar update live.
- **Basemap** — streams Esri World Imagery + roads/labels, or **bake an area**
  for offline use: it downloads the tiles for your theatre and packs them into
  the `.wargame` bundle so the scenario is fully self-contained.
- **Ground-scaled symbols** — icons track a real footprint (capped near ½ km),
  with high-contrast name + effectiveness labels.
- **Share a file** — export / import a `.wargame` bundle (a zip of
  `scenario.json` + baked tiles). Autosaves to the browser between sessions.
- **GM-run sessions** — "Start session as GM" opens a room; players join with
  the `#s=<code>` link. The GM assigns each player to a team from the **Session**
  sidebar tab. Players see only their own divisions plus enemy divisions within
  vision range (7.5 km by default, GM-adjustable), and they *propose* moves by
  dragging — nothing changes until they **Submit** and the GM adjudicates and
  **Releases** the turn, at which point every team's fog-of-war view updates and
  the next turn begins. State is authoritative on the GM's client (`src/net.ts`);
  sync runs through a tiny relay — a ~60-line Cloudflare Worker in
  [`relay/`](relay/) that just forwards messages between a room's members and
  never sees game state. Fits the Cloudflare free plan. Deploy it, then set the
  `VITE_RELAY_URL` repo variable. Baked imagery isn't sent over the channel;
  players without it fall back to the live Esri stream.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
```

## Deploy

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`.

## Attribution

Map imagery © Esri and its data providers (Maxar, Earthstar Geographics, HERE,
Garmin, © OpenStreetMap contributors), used under Esri's attribution terms.
