#!/bin/sh
# Dump a preset's layouts to zz-tmpl/<key>--<layout>.json: dump.sh <preset-key>
T=/c/Users/workk/Projects/motionscript/studio/packages/client/shared/src/features/editor/themes/lib/zz-deck-dump.test.ts
HERE=$(cd "$(dirname "$0")" && (pwd -W 2>/dev/null || pwd))
cp "$(dirname "$0")/dump-deck.test.ts.txt" $T
cd /c/Users/workk/Projects/motionscript/studio && ZZ_PRESET="$1" ZZ_OUT="$HERE/decks" timeout 300 pnpm --config.verify-deps-before-run=false exec vitest run --project client-shared $T 2>&1 | grep -E "Tests|Error|✓|×" | head -8
rm -f $T
