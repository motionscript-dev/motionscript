#!/bin/sh
# Renders stills of each dumped template scene: shots.sh [scene...]
cd "$(dirname "$0")/.."
for s in "$@"; do
  case $s in
    cover) t="2 8.5";; the-map) t="5.5 10 13 21";; side-by-side) t="4 17";; end-to-end) t="11.5";;
    largest) t="8.5";; continents) t="7 15 23.5";;
  esac
  npx tsx zz-geo/render.ts zz-geo/tmpl-$s.json zz-geo/out/$s $t 2>&1 | grep -v "powerPreference\|^wrote"
done
