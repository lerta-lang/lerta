#!/bin/sh
# Renders the images of the site that are kept beside their sources: og.png, which a link to the
# site shows, from og.svg, and favicon.ico and apple-touch-icon.png from favicon.svg. Run it by
# hand from the repository's root after changing one of the SVGs; it needs Inkscape and
# ImageMagick, and og.svg's fonts, Helvetica Neue and Menlo, which macOS has. og.svg holds a copy
# of favicon.svg's shapes, to change with them.
set -e
for tool in inkscape magick; do
  command -v $tool >/dev/null || { echo "images.sh: $tool is not found" >&2; exit 1; }
done
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

render() { # <svg> <png> <width> <height>
  inkscape "$1" --export-type=png --export-filename="$2" -w "$3" -h "$4" 2>"$work/errors" ||
    { cat "$work/errors" >&2; exit 1; }
}

render site/og.svg site/og.png 1200 630
for size in 16 32 48; do
  render site/favicon.svg "$work/$size.png" $size $size
done
magick "$work/16.png" "$work/32.png" "$work/48.png" site/favicon.ico

# iOS rounds the corners of the icon itself, so its square is full.
sed 's/ rx="[^"]*"//' site/favicon.svg > "$work/square.svg"
render "$work/square.svg" site/apple-touch-icon.png 180 180
