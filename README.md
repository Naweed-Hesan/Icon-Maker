# Dope Icons Studio

The workshop for the Dope Icons set: 242 icons × 3 styles × 4 corner sets × 3 weights.
One master file per icon; every variant, SVG file, sprite and React component is generated from it.

## Run the studio

```
npm run studio
```

Open http://localhost:4321. Needs Node 18+, no installs.

- **List:** every icon, with a dot for its worst issue (red error, yellow warning). Filter by issue type.
- **Inspect:** a large preview with pixel grid, 2px padding, keylines, ink box, master node numbers,
  and an overlay of the original v0.1 drawing. It also shows the icon at real size (16–48px, light and
  dark), the full variant grid, the icon next to others for size comparison, and its issues with how
  to fix them.
- **Edit:** path data, stroke/fill, corner rounding per path or per corner. Preview and checks update as you type.
- **Animate:** play an icon's animations, step through a frame strip, edit keyframes, or add one from
  a preset (draw, pop, wiggle, bounce, spin, pulse, nudge, fade). Clipping and other problems are flagged.
- **Batch:** Shift/⌘-click icons (or "Select shown" after filtering), then apply one change to all of
  them: re-centre, fit inside the padding, move, scale, corner rounding, tags, animation presets.
  You see a before/after table with what each change fixes or breaks before anything is saved.
- **Corners:** tune the radius of each corner set and see it on sample icons.
- **Claude requests:** write what you want ("bell clapper looks too small", "make the arrows nudge on
  hover"). Requests can target one icon, a whole selection, or several new icons at once (New icon →
  "several", one `name: description` per line).
  Then in Claude Code say **"process the studio requests"**. Claude edits the icons, checks them and
  replies on each request. The studio reloads by itself.

## Commands

| | |
|---|---|
| `npm run lint` | Check every icon (add names to check only those, `--all` to include info) |
| `npm run fix` | Apply safe automatic fixes (`--dry` to preview) |
| `npm run build` | Write the package to `dist/` (svg, sprite, json, react) |
| `npm run batch -- fit --where rule:padding --dry` | One change across many icons (`--dry` to preview) |
| `npm run sheet -- bell` | Visual sheet of an icon in every variant (`--anim all` for animation frame strips) |
| `npm run new -- name` | Blank icon |

`CLAUDE.md` has the drawing and animation standards and the format of the master files.

## Animations in your app

```jsx
import "dope-icons/css/dope-animations.css";
<IconBell animate="ring" animateOn="hover" />
```

Plain SVG: add `class="dope-icon-bell dope-hover-ring"` to the inline `<svg>` (or `dope-play-ring` to play once shown).
Self-playing files are in `dist/animated/`. Starter animations: bell, bell-ring and alarm ring;
loader, refresh and settings spin; heart, star and thumbs-up pop; check and check-circle draw;
the four arrows and send nudge. All respect reduced-motion settings.

## What changed from the v0.1 export

- The master copy now lives here, not in pen.dev. Each icon keeps one **sharp** drawing; corner sets are generated.
  The import reproduced the original round set to within 0.08px on every icon.
- **Fixed:** solid ignored the weight (light, regular and bold solid files were identical). It now scales.
- **Fixed:** 7 icons had a broken sharp outline (spike plus diagonal cut): folder, folder-plus, ticket, megaphone, volume, volume-low, volume-off.
- **Fixed:** 12 icons had curves stored as dozens of tiny lines: refresh, power, help, undo, redo, smile and others. They're now real arcs, within 0.08px of the original.
- **Fixed:** star and send had a rounded corner baked into the sharp set.
- **Changed:** corner radii are now 0 / 1.25 / 2.5 / 4 (were 0 / 1 / 2 / 3), so the sets are distinguishable.
- **Still open** (design calls for you; see the studio's filter): 26 icons go into the padding, 24 are off-centre,
  4 duotones merge parts, 6 solid shapes aren't closed, and some names are inconsistent (chat vs comment, close vs x-circle).
