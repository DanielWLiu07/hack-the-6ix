# web-extra-2b status

## [05:45] WIP - CLAIM: site apple logo + favicon (assigned by master)
Task: make the landing's apple the site logo + favicon.
FILES I OWN / am editing:
- `web/public/favicon.svg` - REPLACE with the painterly apple mark (existing file was a placeholder)
- `web/public/favicon.png` (32x32) + `web/public/apple-touch-icon.png` (180x180) - NEW, generated from the SVG via sharp
- `web/src/components/Logo.jsx` - NEW, inline-SVG apple mark
- `web/index.html` - SHARED w/ web-frontend: additive icon <link> tags only (png fallback + apple-touch; svg link already present)
- `web/src/components/Layout.jsx` - SHARED w/ web-frontend: add a minimal sticky topbar brand (Logo + "Battery, not Blood" wordmark). Layout currently has NO topbar; reusing ui.css .topbar/.brand (sticky, z10 so it sits above the harvest fixed bg).
@web-frontend: additive-only edits to index.html (icon links) + Layout.jsx (topbar brand). Shout if the topbar collides with your plans for the app hub / stage.
