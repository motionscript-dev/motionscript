import { describe, expect, it } from "vitest"

import {
  Fills,
  type Node,
} from "@motionscript/sdk"
import { AssetDeclaration, ManifestAssetCatalog } from "@motionscript/core"

import { FullWaveform } from "../full-waveform"
import { LiveWaveform } from "../live-waveform"

const image = (src: string) => ({ src, width: 8, height: 8, sizeBytes: 0 })

const catalog = new ManifestAssetCatalog({
  image: { "photo.png": image("photo.png"), "map.png": image("map.png"), "played.png": image("played.png") },
  video: {},
  audio: {},
  font: {},
})

function declarations(node: Node): Record<string, string> {
  const scope = new AssetDeclaration(catalog)
  node.declareAssets(scope)
  return Object.fromEntries([...scope.declarations].map(([key, decl]) => [key, decl.type]))
}

const fixtures: Record<string, { build: () => Node; expected: Record<string, string> }> = {
  "FullWaveform: bar fill": {
    build: () => new FullWaveform({ fill: Fills.image("photo.png") }),
    expected: { "photo.png": "image" },
  },
  "FullWaveform: played fill": {
    build: () => new FullWaveform({ playedFill: Fills.image("played.png") }),
    expected: { "played.png": "image" },
  },
  "LiveWaveform: bar fill": {
    build: () => new LiveWaveform({ fill: Fills.image("photo.png") }),
    expected: { "photo.png": "image" },
  },
}

describe("waveforms declare their paints", () => {
  for (const [name, fixture] of Object.entries(fixtures)) {
    it(name, () => {
      expect(declarations(fixture.build())).toEqual(fixture.expected)
    })
  }
})
