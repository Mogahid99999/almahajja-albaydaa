# رِواق العِلم — Design System Conventions

A calm, scholarly, manuscript-inspired identity for an Islamic educational lessons app (دروس علمية شرعية). This project ships **four full-screen reference designs** (not importable React components): three mobile screens (390×844) and one desktop admin screen (1440×900). Build new screens in the same visual language, defined by the tokens below.

## Setup every screen needs

- **Direction is RTL, always.** Set `dir="rtl"` on the root. Mirror the whole layout: sidebar on the **right**, back chevrons point **right** (`›`), progress fills from the right, horizontal scrollers start from the right.
- **Fonts** — load both from Google Fonts (already `@import`ed at the top of `styles.css`):
  `Amiri` (serif, 400/700) for display/titles, and `IBM Plex Sans Arabic` (300–700) for UI/body.
  - Display/titles: `font-family: 'Amiri', serif; font-weight: 700` — screen titles, lecture titles, section names, large letter-emblems.
  - UI/body: `font-family: 'IBM Plex Sans Arabic', sans-serif` — labels 13px/600, body 12.5–14px, captions 11–11.5px.
- **Numerals are Arabic-Indic** (٠١٢٣٤٥٦٧٨٩) everywhere — times, counts, percentages, dates. Use a locale-aware formatter (`ar-EG`/`ar-SA`), don't hardcode glyphs. Times use `font-variant-numeric: tabular-nums`.
- **Two background colors max:** `--bg-sand` (`#f3ecdd`) for app surfaces, teal (`--primary-teal`) for feature/player/sidebar surfaces. No bright or competitive colors — the mood is calm and serious. **No gamification.**

## The styling idiom: CSS custom properties

This system styles via **CSS variables defined in `styles.css`** (`var(--token)`). Always reach for a token rather than a raw hex. The full vocabulary:

| Group | Tokens |
|---|---|
| Backgrounds | `--bg-sand` `#f3ecdd`, `--bg-sand-raised` `#f8f3e8` |
| Surfaces | `--surface-card` `#fbf7ed`, `--surface-white` `#ffffff`, `--surface-inset` `#e9e0cd`, `--surface-track` `#ece3cf` |
| Brand | `--primary-teal` `#1f4a42`, `--primary-teal-deep` `#16352f`, `--primary-teal-600` `#2c6157` |
| Accent | `--accent-brass` `#c9a463`, `--accent-brass-muted` `#b0894f`, `--accent-brass-soft` `#cbb98e` |
| Text | `--text-ink` `#2b2723`, `--text-slate` `#5c5343`, `--text-muted` `#6b6253`, `--text-faint` `#897a5d`, `--text-ghost` `#9a8f7c` |
| Borders | `--border-sand` `#e8ddc6`, `--border-sand-2` `#ddd1b7`, `--border-hair` `#ece3cf` |
| State | `--state-success` `#1f8a5b`, `--state-danger` `#b85c4a` |
| On teal | `--on-teal-primary` `#f6f0e2`, `--on-teal-secondary` `#a9bdb6`, `--on-teal-stroke` `#dfe7e3` |
| Fonts | `--font-display`, `--font-ui` |
| Radius | `--radius-sm` 11px, `--radius-md` 16px, `--radius-lg` 22px, `--radius-xl` 30px, `--radius-pill` 50% |
| Shadow | `--shadow-feature`, `--shadow-miniplayer`, `--shadow-button` |

**Spacing & radius:** 22px horizontal screen padding (mobile), 30px (admin content). Inputs/icon-buttons radius 11–13px; cards 16–18px; feature cards & artwork 20–30px; pills/badges 50%. Card border: 1px solid `--border-sand` on `--surface-card`.

**Shadows are soft only** — long, low-opacity, brand-tinted (`--shadow-feature` = `0 14px 30px -14px rgba(31,74,66,.7)`). Never hard or neutral-gray.

**The geometric motif is the brand language.** No raster images or photos — all "artwork" is drawn in CSS: faint concentric circles and rotated squares (rhombus, `transform: rotate(45deg)`) at low opacity. The rotated-square rhombus is the recurring mark (logo, bullets, list dots, emblem). Reproduce with divs/SVG, never imagery.

**Icons:** stroke icons, ~1.8–2 width, rounded caps/joins (Lucide/Feather style). Stroke `--text-muted` on sand, `--on-teal-stroke` on teal, `--accent-brass` for accents. Status/bullet dots are rhombi or small circles, not filled icons.

## Where the truth lives

- `styles.css` — all design tokens (the `:root` block above). Read it before styling anything.
- `components/Mobile/*/*.html` and `components/Admin/*/*.html` — the four reference screens. Each `.html` is self-contained and renders the real design; its sibling `.prompt.md` documents the layout, states, and exact values. Read the relevant screen before building a similar one.

## Idiomatic snippet

```html
<div dir="rtl" style="font-family: var(--font-ui); background: var(--bg-sand); color: var(--text-ink); padding: 0 22px;">
  <!-- a section card -->
  <div style="background: var(--surface-card); border: 1px solid var(--border-sand); border-radius: 18px; padding: 16px;">
    <div style="display:flex; align-items:center; gap:12px;">
      <!-- letter-emblem tile -->
      <div style="width:42px; height:42px; border-radius:12px; background:#eef0e9; border:1px solid #d8e0d4;
                  display:flex; align-items:center; justify-content:center;
                  font-family: var(--font-display); font-size:21px; font-weight:700; color: var(--primary-teal);">ع</div>
      <div>
        <div style="font-size:14px; font-weight:600; color: var(--text-ink);">العقيدة</div>
        <div style="font-size:11px; color: var(--text-ghost); margin-top:2px;">٤٢ درساً</div>
      </div>
    </div>
  </div>
</div>
```
