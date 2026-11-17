import { beforeAll, describe, expect, it } from "vitest"
import { Canvas2D, ContextMap, Registry, type CommandSpec, type CompositionDocument, type NodeConstructor } from "@motionscript/sdk"
import { ClipTimeline, ManifestAssetCatalog, NullRenderContext, sampleTree } from "@motionscript/core"

import { clearGeoGeometry, geoOutlines, geoWorldMap, type GeoOutlines } from "../../border/geometry"
import { countryFileKey, loadGeoFile } from "../../border/loader"
import { geoRegistry } from "../../border/registry"
import { selectGeoFeatures } from "../../border/selection"
import { fixtureSource } from "../../border/tests/fixture-source"
import { NODES } from "../../nodes"
import type { GeoGlobe } from "../geo-globe"
import { globeLineSet, globePoint, globeSegments, graticuleLineSet, landMask } from "../lines"
import { drawGlobe, globeTurn } from "../scene"
import { globeMap } from "../surface"

beforeAll(async () => {
    geoRegistry.use(fixtureSource)
    for (const code of ["FR", "DE", "CH"]) await loadGeoFile(countryFileKey(code))
})

function outlines(codes: string[], detail = 0.6) {
    clearGeoGeometry()
    const selection = selectGeoFeatures(codes, "country", "all")
    return geoOutlines({ selectionKey: codes.join(), features: selection.features, frame: "all", borders: "outline", detail })
}

const shape = (polygons: [number, number][][][]): GeoOutlines => ({ polygons, lines: [], bytes: 0 })

/** `v` turned by the unit quaternion `q`. */
function turned(q: { x: number; y: number; z: number; w: number }, v: readonly number[]): number[] {
    const [x, y, z] = v
    const tx = 2 * (q.y * z - q.z * y)
    const ty = 2 * (q.z * x - q.x * z)
    const tz = 2 * (q.x * y - q.y * x)
    return [x + q.w * tx + (q.y * tz - q.z * ty), y + q.w * ty + (q.z * tx - q.x * tz), z + q.w * tz + (q.x * ty - q.y * tx)]
}

describe("a globe's drawing", () => {
    it("places a point where the sphere's map shows it: longitude 0 on +x, north up", () => {
        expect(globePoint(0, 0)[0]).toBeCloseTo(1)
        expect(globePoint(-90, 0)[2]).toBeCloseTo(1)
        expect(globePoint(0, 90)[1]).toBeCloseTo(1)
    })

    it("turns the point it is asked for round to face the viewer, north still up", () => {
        for (const [lon, lat] of [[0, 0], [-6, 14], [139, 35], [-75, -40]]) {
            const facing = turned(globeTurn(lon, lat), globePoint(lon, lat))
            expect(facing[0]).toBeCloseTo(0, 6)
            expect(facing[1]).toBeCloseTo(0, 6)
            expect(facing[2]).toBeCloseTo(1, 6)
        }
        const north = turned(globeTurn(30, 10), globePoint(30, 40))
        expect(north[1]).toBeGreaterThan(0.4)
        expect(north[0]).toBeCloseTo(0, 6)
    })

    it("lays the world on an equirectangular map, cutting a ring at the antimeridian and closing a polar one along the edge", () => {
        const across = geoWorldMap(shape([[[[170, -10], [170, 10], [-170, 10], [-170, -10], [170, -10]]]]))
        expect(across.length).toBe(2)
        const xs = across.flatMap((c) => Array.from(c.points.filter((_, i) => i % 2 === 0)))
        expect(Math.max(...xs)).toBeCloseTo(0.5)
        expect(Math.min(...xs)).toBeCloseTo(-0.5)
        const ring = Array.from({ length: 37 }, (_, i) => [-180 + i * 10, -70] as [number, number])
        const polar = geoWorldMap(shape([[ring]]))
        const ys = polar.flatMap((c) => Array.from(c.points.filter((_, i) => i % 2 === 1)))
        expect(Math.min(...ys)).toBeCloseTo(-0.25)
    })

    it("paints every land part against one 360° square, so a pattern lines up across countries", () => {
        const land = outlines(["FR", "DE"])
        const map = globeMap({
            width: 1000,
            ocean: [],
            land: [{ type: "solid", color: [1, 1, 1, 1] }],
            landOutlines: land,
            highlight: [],
            highlightOutlines: null,
        })
        const ops = (map.source as unknown as { ops(): { kind: string; state?: { data?: string; centerBounds?: number[] } }[] }).ops()
        expect(ops.filter((op) => op.kind === "fill")).toHaveLength(1)
        const paths = ops.filter((op) => op.kind === "path")
        expect(paths.every((op) => op.state?.centerBounds?.join() === "-500,-500,500,500")).toBe(true)
        expect(paths.at(-1)?.state?.data).toBe("M-500 -500L-500 -500M500 500L500 500")
        expect(map.width).toBe(4096)
        expect(map.height).toBe(2048)
    })

    it("cuts the parallels and meridians where they cross land", () => {
        const france = landMask(geoWorldMap(outlines(["FR"])))
        const onFrance = (set: ReturnType<typeof graticuleLineSet>) =>
            set.lines.some(({ points }) => {
                for (let i = 0; i < points.length; i += 3) {
                    const lat = (Math.asin(points[i + 1]) * 180) / Math.PI
                    if (Math.abs(points[i + 2]) < 1e-6 && points[i] > 0 && lat > 44.5 && lat < 48.5) return true
                }
                return false
            })
        expect(onFrance(graticuleLineSet(30, landMask([])))).toBe(true)
        expect(onFrance(graticuleLineSet(30, france))).toBe(false)
    })

    it("draws a line set on between start and end of its whole length", () => {
        const set = globeLineSet([
            [[0, 0], [90, 0]],
            [[0, 10], [0, 50]],
        ])
        const length = (start: number, end: number) =>
            globeSegments(set, start, end, 1).reduce((sum, [p, q]) => sum + Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]), 0)
        expect(length(0, 1)).toBeCloseTo(set.length, 6)
        expect(length(0, 0.5)).toBeCloseTo(set.length / 2, 6)
        expect(length(0.25, 0.75)).toBeCloseTo(set.length / 2, 6)
        expect(globeSegments(set, 0.6, 0.4, 1)).toEqual([])
    })

    it("goes the short way round a border that crosses the antimeridian", () => {
        const set = globeLineSet([[[179, 0], [-179, 0]]])
        expect(set.length).toBeCloseTo((2 * Math.PI) / 180, 3)
    })

    it("draws nothing until every country file has landed", () => {
        const ops: unknown[] = []
        const g3 = {
            mesh: (...args: unknown[]) => ops.push(args),
            instances: (...args: unknown[]) => ops.push(args),
        }
        const state = {
            fill: [],
            land: [],
            coast: [],
            borders: "outline",
            graticule: [],
            graticuleStep: 30,
            longitude: 0,
            latitude: 0,
            detail: 0.45,
            highlight: [],
            highlightFill: [],
            shading: "flat",
            farSide: "hidden",
            start: 0,
            end: 1,
        }
        drawGlobe(g3 as never, state as never, { radius: 1, unit: 0.001, gap: 0.005 })
        expect(ops).toEqual([])
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

function clip(type: string, props: Record<string, unknown>, commands: CommandSpec[]) {
    const registry = new Registry({ nodes: NODES as unknown as NodeConstructor[] })
    const globe =
        type === "geoGlobe"
            ? [{ id: "globe", type, parentId: "", layerOrder: 0, props: { width: 600, height: 600, ...props } }]
            : [
                  { id: "view", type: "canvas3d", parentId: "", layerOrder: 0, props: { width: 600, height: 600 } },
                  { id: "globe", type, parentId: "view", layerOrder: 0, props },
              ]
    const doc: CompositionDocument = {
        kind: "composition",
        nodes: [{ id: "", type: "canvas2d", parentId: null, layerOrder: 0, props: {} }, ...globe],
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

describe.each(["geoGlobe", "geoGlobe3d"])("turning a %s", (type) => {
    it("spins it the way the Earth turns, any number of degrees", () => {
        const at = clip(type, { longitude: 10 }, [step("c0", "spin", 0, 2, { degrees: 720 })])
        expect(at(1).longitude).toBeCloseTo(10 - 360)
        expect(at(2).longitude).toBeCloseTo(10 - 720)
    })

    it("turns to a longitude the shorter way, and keeps a latitude left out", () => {
        const at = clip(type, { longitude: -170, latitude: 35 }, [step("c0", "turnTo", 0, 1, { longitude: 170 })])
        expect(at(1).longitude).toBeCloseTo(-190)
        expect(at(1).latitude).toBeCloseTo(35)
    })

    it("turns to a latitude, held to the poles", () => {
        const at = clip(type, { latitude: 0 }, [step("c0", "turnTo", 0, 1, { latitude: 120 })])
        expect(at(1).latitude).toBeCloseTo(90)
    })
})
