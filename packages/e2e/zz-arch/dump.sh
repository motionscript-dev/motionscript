#!/bin/sh
# Dump the Architecture template scenes to tmpl-*.json for render.ts / shots.sh.
T=/c/Users/workk/Projects/motionscript/studio/packages/client/shared/src/features/editor/themes/lib/zz-arch-dump.test.ts
cp "$(dirname "$0")/dump.test.ts.txt" $T
cd /c/Users/workk/Projects/motionscript/studio && timeout 300 pnpm --config.verify-deps-before-run=false exec vitest run --project client-shared $T 2>&1 | grep -E "Tests|Error" | head -5
rm -f $T
