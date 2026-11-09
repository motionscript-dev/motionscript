import { describe, expect, it } from "vitest"

import { Fills, type AssetScope, type Node } from "@motionscript/sdk"
import { AssetDeclaration, ManifestAssetCatalog } from "@motionscript/core"

import { ChartBars } from "../bar-chart/chart-bars"
import { ChartLine } from "../line-chart/chart-line"
import { ChartRegion } from "../line-chart/chart-region"
import { PieRing } from "../pie-chart/pie-ring"
import { DEFAULT_PIE_CHART_THEME } from "../pie-chart/shared"
import { ChartBorder } from "./chart-border"
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
  "ChartCanvas: panel fill and shadow": {
    build: () => new ChartCanvas({
      fill: Fills.image("photo.png"),
      shadow: { fill: Fills.image("grain.png"), blur: 4 },
    }),
    expected: { "photo.png": "image", "grain.png": "image" },
  },
  "ChartCanvas: grid strokes": {
    build: () => new ChartCanvas({ xGridStroke: imageStroke("stamp.png"), yGridStroke: imageStroke("map.png") }),
    expected: { "stamp.png": "image", "map.png": "image" },
  },
  "ChartBorder: frame stroke": {
    build: () => new ChartBorder({ stroke: imageStroke("stamp.png") }),
    expected: { "stamp.png": "image" },
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
  "ChartBars: column stroke and shadow": {
    build: () => new ChartBars({
      barStroke: imageStroke("stamp.png"),
      barShadow: { fill: Fills.image("grain.png"), blur: 4 },
    }),
    expected: { "stamp.png": "image", "grain.png": "image" },
  },
  "PieRing: slice fills and the leader stroke": {
    build: () => new PieRing({
      slices: [
        { category: "a", value: 1, fill: Fills.image("photo.png") },
        { category: "b", value: 2, fill: "tomato" },
      ],
      label: { ...DEFAULT_PIE_CHART_THEME.label, leaderStroke: imageStroke("stamp.png") },
    }),
    expected: { "photo.png": "image", "stamp.png": "image" },
  },
  "PieRing: wedge outline": {
    build: () => new PieRing({
      slices: [{ category: "a", value: 1, fill: "tomato" }],
      ring: { ...DEFAULT_PIE_CHART_THEME.ring, stroke: imageStroke("stamp.png") },
    }),
    expected: { "stamp.png": "image" },
  },
  "PieRing: wedge shadow": {
    build: () => new PieRing({
      slices: [{ category: "a", value: 1, fill: "tomato" }],
      ring: { ...DEFAULT_PIE_CHART_THEME.ring, shadow: { fill: Fills.image("grain.png"), blur: 4 } },
    }),
    expected: { "grain.png": "image" },
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
