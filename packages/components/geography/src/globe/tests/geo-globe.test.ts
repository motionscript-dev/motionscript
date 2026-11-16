import { beforeAll, describe, expect, it } from "vitest"
import { Canvas2D, ContextMap, Registry, type CommandSpec, type CompositionDocument, type NodeConstructor } from "@motionscript/sdk"
import { ClipTimeline, ManifestAssetCatalog, NullRenderContext, sampleTree } from "@motionscript/core"

import { clearGeoGeometry, geoGlobeGeometry, geoOutlines, type GeoContour } from "../../border/geometry"
import { countryFileKey, loadGeoFile } from "../../border/loader"
import { geoRegistry } from "../../border/registry"
import { selectGeoFeatures } from "../../border/selection"
import { fixtureSource } from "../../border/tests/fixture-source"
import { NODES } from "../../nodes"
import type { GeoGlobe } from "../geo-globe"

beforeAll(async () => {
    geoRegistry.use(fixtureSource)
    for (const code of ["FR", "DE", "CH"]) await loadGeoFile(countryFileKey(code))
})

function outlines(codes: string[], detail = 0.6) {
    clearGeoGeometry()
    const selection = selectGeoFeatures(codes, "country", "all")
    return geoOutlines({ selectionKey: codes.join(), features: selection.features, frame: "all", borders: "outline", detail })
}

const radii = (contours: GeoContour[]) => contours.flatMap((c) => {
    const out: number[] = []
    for (let i = 0; i < c.points.length; i += 2) out.push(Math.hypot(c.points[i], c.points[i + 1]))
    return out
})

describe("a globe's drawing", () => {
    it("shows a country facing the viewer near the middle of the sphere", () => {
        const land = outlines(["DE", "CH"])
        const facing = geoGlobeGeometry({ land, highlight: null, longitude: 9, latitude: 49, graticuleStep: 0 })
        expect(facing.land.length).toBeGreaterThan(0)
        expect(Math.max(...radii(facing.land))).toBeLessThan(0.2)
    })

    it("hides a country on the far side", () => {
        const land = outlines(["FR", "DE"])
        const away = geoGlobeGeometry({ land, highlight: null, longitude: -175, latitude: -48, graticuleStep: 0 })
        expect(away.land).toEqual([])
        expect(away.coast).toEqual([])
    })

    it("cuts a country at the horizon and keeps it on the disk", () => {
        const land = outlines(["FR"])
        const edge = geoGlobeGeometry({ land, highlight: null, longitude: 92, latitude: 0, graticuleStep: 0 })
        const r = radii(edge.land)
        expect(r.length).toBeGreaterThan(0)
        expect(Math.max(...r)).toBeLessThanOrEqual(0.5 + 1e-6)
        expect(Math.max(...r)).toBeGreaterThan(0.499)
    })

    it("draws parallels and meridians only when given a step", () => {
        const land = outlines(["CH"])
        expect(geoGlobeGeometry({ land, highlight: null, longitude: 0, latitude: 0, graticuleStep: 30 }).graticule.length).toBeGreaterThan(5)
        expect(geoGlobeGeometry({ land, highlight: null, longitude: 0, latitude: 0, graticuleStep: 0 }).graticule).toEqual([])
    })

    it("fills a polygon two regions both carry once", () => {
        clearGeoGeometry()
        const france = selectGeoFeatures(["FR"], "country", "all").features
        const once = geoOutlines({ selectionKey: "once", features: france, frame: "all", borders: "outline", detail: 1 })
        const twice = geoOutlines({ selectionKey: "twice", features: [...france, ...france], frame: "all", borders: "outline", detail: 1 })
        expect(twice.polygons.length).toBe(once.polygons.length)
        expect(twice.lines.length).toBe(once.lines.length)
    })
})

describe("a selection's key", () => {
    it("names only the files the selection reads, so an unrelated one landing changes nothing", async () => {
        const before = selectGeoFeatures(["FR"], "country", "all")
        await loadGeoFile(countryFileKey("ZZ"))
        const after = selectGeoFeatures(["FR"], "country", "all")
        expect(after.files).toBe(before.files)
        expect(selectGeoFeatures(["FR", "IT"], "country", "all").pending).toBe(true)
    })
})

const VIEWPORT = { width: 800, height: 800 }

function clip(props: Record<string, unknown>, commands: CommandSpec[]) {
    const registry = new Registry({ nodes: NODES as unknown as NodeConstructor[] })
    const doc: CompositionDocument = {
        kind: "composition",
        nodes: [
            { id: "", type: "canvas2d", parentId: null, layerOrder: 0, props: {} },
            { id: "globe", type: "geoGlobe", parentId: "", layerOrder: 0, props: { width: 600, height: 600, ...props } },
        ],
        commands,
    }
    const canvas = new Canvas2D({ id: "", ...VIEWPORT, flow: "freeform" } as never)
    const timeline = new ClipTimeline(doc, registry, canvas)
    const measurer = new NullRenderContext()
    const assets = new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} })
    const attach = (time: number) => canvas.attach({ assets, context: ContextMap.EMPTY, time })
    const layout = () => canvas.layout({ x: 0, y: 0, ...VIEWPORT }, measurer)
    const settle = () => {
        sampleTree(canvas)
        layout()
    }
    attach(0)
    timeline.build()
    settle()
    timeline.compile(settle)
    layout()
    return (time: number) => {
        attach(time)
        timeline.syncPresence(time)
        timeline.evaluateAt(time)
        layout()
        canvas.render(new NullRenderContext())
        return timeline.liveNode("globe") as unknown as GeoGlobe
    }
}

const LINEAR = { kind: "linear" } as const
const step = (id: string, type: string, at: number, duration: number, args: Record<string, unknown>): CommandSpec =>
    ({ id, type, targetId: "globe", at, duration, args, easing: LINEAR }) as CommandSpec

describe("turning a globe", () => {
    it("spins it the way the Earth turns, any number of degrees", () => {
        const at = clip({ longitude: 10 }, [step("c0", "spin", 0, 2, { degrees: 720 })])
        expect(at(1).longitude).toBeCloseTo(10 - 360)
        expect(at(2).longitude).toBeCloseTo(10 - 720)
    })

    it("turns to a longitude the shorter way, and keeps a latitude left out", () => {
        const at = clip({ longitude: -170, latitude: 35 }, [step("c0", "turnTo", 0, 1, { longitude: 170 })])
        expect(at(1).longitude).toBeCloseTo(-190)
        expect(at(1).latitude).toBeCloseTo(35)
    })

    it("turns to a latitude, held to the poles", () => {
        const at = clip({ latitude: 0 }, [step("c0", "turnTo", 0, 1, { latitude: 120 })])
        expect(at(1).latitude).toBeCloseTo(90)
    })
})
