#!/bin/sh
# Dump the Math Video template scenes to tmpl-*.json: dump.sh [slug,slug...]
T=/c/Users/workk/Projects/motionscript/studio/packages/client/shared/src/features/editor/themes/lib/zz-math-dump.test.ts
HERE=$(cd "$(dirname "$0")" && (pwd -W 2>/dev/null || pwd))
cp "$(dirname "$0")/dump.test.ts.txt" $T
cd /c/Users/workk/Projects/motionscript/studio && ZZ_ONLY="$1" ZZ_OUT="$HERE" timeout 300 pnpm --config.verify-deps-before-run=false exec vitest run --project client-shared $T 2>&1 | grep -E "Tests|Error|error" | head -8
rm -f $T
