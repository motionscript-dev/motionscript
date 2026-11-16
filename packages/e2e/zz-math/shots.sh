#!/bin/sh
# Render stills of a dumped scene: shots.sh <slug> <seconds...>
cd "$(dirname "$0")/.."
s=$1; shift
npx tsx zz-math/render.ts zz-math/tmpl-$s.json zz-math/out/$s "$@" 2>&1 | grep -v "powerPreference" | grep -v "^wrote" || true
