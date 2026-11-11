#!/bin/sh
# Dump the Catan template scenes to JSON for the scratch renderer.
T=/c/Users/workk/Projects/motionscript/studio/packages/client/shared/src/features/editor/themes/lib/zz-catan-dump.test.ts
cat > $T <<'TS'
import fs from "node:fs"
import { it } from "vitest"

import { CATAN_PRESET } from "@/features/editor/themes/lib/catan-preset"
import { presetAsScenes, presetAsTheme } from "@/features/editor/themes/lib/template-catalog"
import { templateSceneDocument } from "@/features/editor/themes/lib/template-preview"

it("dumps the catan scenes", () => {
  const theme = presetAsTheme(CATAN_PRESET)
  for (const scene of presetAsScenes(CATAN_PRESET)) {
    const built = templateSceneDocument({ scene, theme, describe: () => undefined })
    if (!built) throw new Error("no document " + scene.name)
    const out = `C:/Users/workk/Projects/motionscript/motionscript/packages/e2e/zz-catan/tmpl-${scene.name.toLowerCase()}.json`
    fs.writeFileSync(out, JSON.stringify({ ...built.document, duration: built.seconds }))
  }
})
TS
cd /c/Users/workk/Projects/motionscript/studio && timeout 300 pnpm --config.verify-deps-before-run=false exec vitest run --project client-shared $T 2>&1 | grep -E "Tests|Error" | head -5
rm -f $T
