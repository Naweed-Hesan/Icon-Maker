# Icon Maker

Your own icon library website: browse, search, tweak and export icons, and add as many of your own as you like.

## Use it

Open `index.html` in a browser. That's it — no install needed.

(Or run `npm start` to serve it at http://localhost:3000.)

- **Search** with `/`, filter by category on the left.
- **Size, stroke, corners, colour** controls update every icon live. "Auto" colour uses `currentColor`, so the icon picks up your text colour.
- **Click an icon** to copy it as SVG or React JSX, or download SVG / PNG (512px).
- **Download sprite** gives you `dist/sprite.svg` with every icon as a `<symbol>`:
  ```html
  <svg width="24" height="24"><use href="sprite.svg#home"/></svg>
  ```

## Add icons

### Permanently (recommended)

1. Drop an SVG into `icons/<category>/<name>.svg` (new folder = new category).
   Draw on a 24×24 grid. For outline icons put `fill="none" stroke="currentColor"` on the `<svg>` so the stroke controls work; filled icons work too.
2. Optional: add search keywords in `icons/tags.json` → `"rocket": ["launch", "startup"]`.
3. Run `npm run build` (regenerates `icons.js` and `dist/sprite.svg`).
4. Commit.

### Quickly, in the browser

Click **Add icon**, then drop SVG files or paste SVG code. They're saved in your browser under the category you pick.
To make them permanent: **Export my icons** → `npm run import -- my-icons.json` → commit.

## Files

| Path | What |
|---|---|
| `icons/` | Source SVGs, one folder per category, plus `tags.json` |
| `scripts/build.mjs` | Builds `icons.js` + `dist/sprite.svg` from `icons/` |
| `scripts/import.mjs` | Writes a browser export into `icons/` and rebuilds |
| `index.html`, `css/`, `js/` | The website |

The 108 starter icons are original to this project.
