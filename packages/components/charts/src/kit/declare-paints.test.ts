import { describe, expect, it } from "vitest"

import { Fills, type AssetScope, type Node } from "@motionscript/sdk"
import { AssetDeclaration, ManifestAssetCatalog } from "@motionscript/core"

import { ChartBars } from "../bar-chart/chart-bars"
import { ChartArea, ChartLine } from "../line-chart/chart-line"
import { ChartRegion } from "../line-chart/chart-region"
import { ChartCanvas } from "./chart-canvas"

const image = (src: string) => ({ src, width: 8, height: 8, sizeBytes: 0 })

const catalog = new ManifestAssetCatalog({
  image: Object.fromEntries(
    ["photo.png", "grain.png", "stamp.png", "map.png"].map((src) => [src, image(src)])
  ),
  video: {},
  audio: {},
  font: {},
})

const imageStroke = (src: string) => ({ weight: 2, fill: Fills.image(src) })

function declared(declare: (assets: AssetScope) => void): Record<string, string> {
  const scope = new AssetDeclaration(catalog)
  declare(scope)
  return Object.fromEntries([...scope.declarations].map(([key, decl]) => [key, decl.type]))
}

const fixtures: Record<string, { build: () => Node; expected: Record<string, string> }> = {
  "ChartCanvas: panel fill": {
    build: () => new ChartCanvas({ fill: Fills.image("photo.png") }),
    expected: { "photo.png": "image" },
  },
  "ChartCanvas: axis rules": {
    build: () => new ChartCanvas({ axisStroke: imageStroke("grain.png") }),
    expected: { "grain.png": "image" },
  },
  "ChartCanvas: grid strokes": {
    build: () => new ChartCanvas({ xGridStroke: imageStroke("stamp.png"), yGridStroke: imageStroke("map.png") }),
    expected: { "stamp.png": "image", "map.png": "image" },
  },
  "ChartLine: series stroke": {
    build: () => new ChartLine({ stroke: imageStroke("stamp.png") }),
    expected: { "stamp.png": "image" },
  },
  "ChartRegion: wash and rule": {
    build: () => new ChartRegion({ fill: Fills.image("photo.png"), stroke: imageStroke("stamp.png") }),
    expected: { "photo.png": "image", "stamp.png": "image" },
  },
  "ChartBars: column fill": {
    build: () => new ChartBars({ fill: Fills.image("photo.png") }),
    expected: { "photo.png": "image" },
  },
  "ChartLine: dot fill": {
    build: () => new ChartLine({ dotFill: Fills.image("grain.png") }),
    expected: { "grain.png": "image" },
  },
  "ChartArea: area fill": {
    build: () => new ChartArea({ fill: Fills.image("map.png") }),
    expected: { "map.png": "image" },
  },
}

describe("chart internals declare their paints", () => {
  for (const [name, fixture] of Object.entries(fixtures)) {
    it(name, () => {
      const node = fixture.build()
      expect(declared((assets) => node.declareAssets(assets))).toEqual(fixture.expected)
    })
  }
})
