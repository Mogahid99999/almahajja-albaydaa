# رِواق العِلم — design-sync notes

## Shape: `reference` (off-script)
This repo is **not** a React component library — it has no `package.json`, no `dist/`, no Storybook. It contains four HTML design prototypes under `screens/*.dc.html` plus a `support.js` prototype runtime. The standard `/design-sync` converter (package/storybook shapes) does not apply.

The user chose **"Upload screens as design references"** — the four screens are uploaded as self-contained `@dsCard` preview cards so the Claude Design agent can reference the visual language. They are NOT importable React components.

## How the bundle was produced (by hand)
- The source `.dc.html` files depend on `support.js` (needs `window.React`) and use `{{ }}` interpolation + `<sc-for>`/`<sc-if>` template tags. These were **statically resolved**: loops unrolled with the prototype's own seed data, conditionals fixed to a sensible default state, interpolations inlined.
  - Home & AudioPlayer cards show the **playing** state (pause bars).
  - UploadLecture shows the **draft** publish state and the tree dropdown in its **open** state (so the searchable-tree interaction is visible on the card).
- Tokens were extracted from the README into `ds-bundle/styles.css` as CSS custom properties (`:root`). `_ds_bundle.js` is a minimal stub exposing tokens on `window.RawwaqAlIlm`; `_ds_bundle.css` is an empty placeholder `@import`ed by `styles.css`.
- Fonts (Amiri + IBM Plex Sans Arabic) load from Google Fonts via `@import` in `styles.css` — `[FONT_REMOTE]` equivalent, loaded at runtime, nothing bundled.

## Verification
- No playwright/chromium cache. Rendered each card with **system Google Chrome** headless (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless --screenshot`) at scale 1. All four render with full fidelity to the README spec (file sizes 60–124 KB). Screenshots were written to `ds-bundle/_verify/` and deleted after review.

## Re-sync risks / what can go stale
- **The cards are a hand-maintained static snapshot of `screens/*.dc.html`.** If a `.dc.html` changes, its card does NOT auto-update — re-run this manual extraction. `_ds_sync.json.sourceKeys` maps each card to its source file; `renderHashes` are content hashes of the emitted cards (not the sources).
- A re-sync will NOT use `resync.mjs` (that driver targets package/storybook shapes only). Re-do the manual steps above.
- Dynamic state choices (playing vs paused, draft vs published, tree open vs closed) are frozen per the bullets above — revisit if the canonical state should change.
- Tokens in `styles.css` and `.design-sync/conventions.md` were transcribed from the README's token table. If the README tokens change, update both.
- `_ds_bundle.js` is a stub, not real compiled components — the design agent cannot `import` these screens; they are visual reference only.

## Project
- Claude Design project: **`4bb64e4c-a2ce-4f53-8aeb-9b57af71a5c0`** (name: رواق العلم). This is the live, pinned target.
- **Persistence history (2026-06-26 re-sync):** the config had been pinned to `9d02699b-fe52-4c3d-9faf-8cbbfff35bfb`, but that project now 404s (gone). Meanwhile `4bb64e4c…` — the one the earlier note thought had "404'd / never persisted" — was actually **alive but empty**. So the previous session's uploads never persisted anywhere (the "404" during that run was likely transient/eventual-consistency, and the recreate-and-pin-to-`9d02699b` was the wrong fix). On 2026-06-26 the empty `4bb64e4c…` was reused, config re-pinned to it, and the full bundle uploaded into it (verified present via `list_files`).
- **Lesson:** if `get_project`/`list_files` 404s right after a create, DON'T immediately recreate — wait and re-check, or `list_projects` to see if it actually exists under a different lifecycle. Recreating spawned a duplicate that then became the wrong pin. Always confirm the pinned id is in `list_projects` at the start of a re-sync.
