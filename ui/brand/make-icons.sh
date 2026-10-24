#!/usr/bin/env bash
# Regenerates every icon under ../public from the SVGs in this directory.
#
#   ./make-icons.sh
#
# Three artworks, because one cannot serve every job:
#   logo.svg           photo stack with sun and ridge - app icon, PWA, og:image
#   logo-favicon.svg   the same stack, chunkier       - 16/24/32px tabs, where
#                                                      fine detail turns to mud
#   logo-maskable.svg  full-bleed, art in the safe zone - Android launchers that
#                                                       crop to a circle/squircle
#
# Needs google-chrome, which rasterises SVG exactly (ImageMagick's internal
# renderer does not), and ImageMagick's `convert` for the .ico container.
set -euo pipefail
cd "$(dirname "$0")"
OUT=../public
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp ./*.svg "$TMP/"

shot() { # px art out
  cat > "$TMP/$3.html" <<HTML
<!doctype html><meta charset=utf8>
<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}
img{display:block;width:${1}px;height:${1}px}</style>
<img src="$2.svg">
HTML
  google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
    --window-size="$1,$1" --default-background-color=00000000 \
    --screenshot="$TMP/$3.png" "file://$TMP/$3.html" >/dev/null 2>&1
}

emit() { shot "$1" "$2" "$3"; cp "$TMP/$3.png" "$OUT/$3.png"; echo "  $3.png  ${1}x$1"; }

echo "icons:"
emit 512 logo          icons-512
emit 192 logo          icons-192
emit 180 logo          apple-touch-icon
emit 512 logo-maskable maskable-512
emit 32  logo-favicon  favicon-32

# The .ico carries its own sizes; the 16px frame is the one that matters most.
for n in 16 24 48; do shot "$n" logo-favicon "fav-$n"; done
convert "$TMP/fav-16.png" "$TMP/fav-24.png" "$OUT/favicon-32.png" "$TMP/fav-48.png" \
  -define icon:auto-resize=16,24,32,48 "$OUT/favicon.ico"
echo "  favicon.ico  16,24,32,48"
