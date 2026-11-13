#!/bin/sh
# Renders stills of each dumped template scene: shots.sh [scene...]
cd "$(dirname "$0")/.."
for s in "$@"; do
  case $s in
    title-sheet) t="2 5 8.5";; plan) t="2.5 9.5";; massing) t="3 11.5";; frame) t="3.5 11.5";;
    types) t="2.5 6 10";; posters) t="4 12 20 23.5";; load-path) t="3 6.5 12.5";; beam-check) t="3 9.5";;
    carbon) t="7.5";; programme) t="9.5";;
  esac
  npx tsx zz-arch/render.ts zz-arch/tmpl-$s.json zz-arch/out/$s $t 2>&1 | grep -v "powerPreference\|^wrote" 
done
