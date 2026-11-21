#!/bin/sh
# Dump the Geography Lesson template scenes to tmpl-*.json for render.ts / shots.sh.
T=/c/Users/workk/Projects/motionscript/studio/packages/client/shared/src/features/editor/themes/lib/zz-promo-dump.test.ts
HERE=$(cd "$(dirname "$0")" && (pwd -W 2>/dev/null || pwd))
cp "$(dirname "$0")/dump.test.ts.txt" $T
cd /c/Users/workk/Projects/motionscript/studio && ZZ_OUT="$HERE" ZZ_ONLY="$1" timeout 300 pnpm --config.verify-deps-before-run=false exec vitest run --project client-shared $T 2>&1 | grep -E "Tests|Error" | head -5
rm -f $T
