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
- **Corners:** tune the radius of each corner set and see it on sample icons.
- **Claude requests:** write what you want ("bell clapper looks too small", "new icon: rocket").
  Then in Claude Code say **"process the studio requests"**. Claude edits the icons, checks them and
  replies on each request. The studio reloads by itself.

## Commands

| | |
|---|---|
| `npm run lint` | Check every icon (add names to check only those, `--all` to include info) |
| `npm run fix` | Apply safe automatic fixes (`--dry` to preview) |
| `npm run build` | Write the package to `dist/` (svg, sprite, json, react) |
| `npm run sheet -- bell` | Visual sheet of an icon in every variant |
| `npm run new -- name` | Blank icon |

`CLAUDE.md` has the drawing standard and the format of the master files.

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
