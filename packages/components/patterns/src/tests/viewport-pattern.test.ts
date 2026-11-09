import { describe, expect, it } from "vitest"

import { NullRenderContext } from "@motionscript/core"
import { Camera, Canvas2D, OrbitCamera, Rect, component2d, type BoxBounds, type Node } from "@motionscript/sdk"

import { ViewportPattern } from "../kit"
import { Recorder, mount } from "./recorder.fixtures"

/** What the probe was asked to fill, and the camera it found, render by render. */
const asked: BoxBounds[] = []
const found: (string | null)[] = []

/** A pattern built from the module that writes down the bounds it is asked to fill, and the camera above it. */
const Probe = component2d({
  key: "viewportProbe",
  state: ViewportPattern.state,
  commands: ViewportPattern.commands,
  measure: ViewportPattern.measure,
  layout: ViewportPattern.layout,
  render: (ctx) => {
    found.push(ctx.ancestor(Camera)?.id ?? null)
    ViewportPattern.draw(ctx, (bounds) => asked.push({ ...bounds }))
  },
})
type Probe = InstanceType<typeof Probe>

/** Render the probe once, mounted with whatever it sits in, into a fresh recorder. */
function renderProbe(probe: Probe): Recorder {
  let root: Node = probe
  while (root.parent) root = root.parent
  if (!root.mounted) mount(root)
  asked.length = 0
  found.length = 0
  const ctx = new Recorder()
  probe.render(ctx)
  return ctx
}

/** The region the probe covers: what it is handed to fill. */
function boundsOf(probe: Probe): BoxBounds {
  renderProbe(probe)
  return asked[0]
}

/** The id of the camera the probe takes its region from, or `null`. */
function cameraOf(probe: Probe): string | null {
  renderProbe(probe)
  return found[0]
}

const SCOPE = new NullRenderContext()
const BOX = { x: 0, y: 0, width: 800, height: 600 }

/** A probe inside a camera of the given look, laid out in an 800 x 600 box. */
function inCamera(look: Record<string, unknown> = {}): { probe: Probe; camera: Camera } {
  const probe = new Probe({})
  const camera = new Camera({ width: 800, height: 600, ...look, children: [probe] } as never)
  camera.layout(BOX, SCOPE)
  return { probe, camera }
}

function expectBounds(actual: BoxBounds, expected: { x: number; y: number; width: number; height: number }, digits = 9): void {
  expect(actual.x).toBeCloseTo(expected.x, digits)
  expect(actual.y).toBeCloseTo(expected.y, digits)
  expect(actual.width).toBeCloseTo(expected.width, digits)
  expect(actual.height).toBeCloseTo(expected.height, digits)
}

describe("ViewportPattern.visibleBounds — inside a camera", () => {
  it("is the camera's whole viewport at zoom 1, centred on the origin", () => {
    expectBounds(boundsOf(inCamera().probe), { x: 0, y: 0, width: 800, height: 600 })
  })

  it("shows half the world at zoom 2", () => {
    expectBounds(boundsOf(inCamera({ zoom: 2 }).probe), { x: 0, y: 0, width: 400, height: 300 })
  })

  it("shows twice the world at zoom 0.5", () => {
    expectBounds(boundsOf(inCamera({ zoom: 0.5 }).probe), { x: 0, y: 0, width: 1600, height: 1200 })
  })

  it("scales with the camera's measured size, not the size it was declared at", () => {
    const probe = new Probe({})
    const camera = new Camera({ width: 800, height: 600, zoom: 2, children: [probe] } as never)
    camera.layout({ x: 0, y: 0, width: 400, height: 200 }, SCOPE)
    expectBounds(boundsOf(probe), { x: 0, y: 0, width: 200, height: 100 })
  })

  it("takes a zoom of 0 as 1, there being no world a camera of no magnification could show", () => {
    expectBounds(boundsOf(inCamera({ zoom: 0 }).probe), { x: 0, y: 0, width: 800, height: 600 })
  })

  it("centres on the camera's lookAt, in y-up world space, not negated", () => {
    const { probe } = inCamera({ lookAt: { x: 120, y: -80 } })
    expectBounds(boundsOf(probe), { x: 120, y: -80, width: 800, height: 600 })
  })

  it("combines a lookAt with a zoom: the centre moves, the extent shrinks", () => {
    expectBounds(boundsOf(inCamera({ lookAt: { x: 50, y: 25 }, zoom: 4 }).probe), { x: 50, y: 25, width: 200, height: 150 })
  })

  it("takes the bounding box of the turned viewport when the camera has a heading", () => {
    // At 90 degrees the 800 x 600 viewport lies on its side: 600 wide and 800 tall.
    expectBounds(boundsOf(inCamera({ heading: 90 }).probe), { x: 0, y: 0, width: 600, height: 800 })
  })

  it("covers the corners of the viewport at 45 degrees: (w + h) / sqrt 2 on both axes", () => {
    const side = (800 + 600) * Math.SQRT1_2
    expectBounds(boundsOf(inCamera({ heading: 45 }).probe), { x: 0, y: 0, width: side, height: side })
  })

  it("projects each half-extent by the cosine and the sine of the heading", () => {
    const rad = (30 * Math.PI) / 180
    const width = 2 * (400 * Math.cos(rad) + 300 * Math.sin(rad))
    const height = 2 * (400 * Math.sin(rad) + 300 * Math.cos(rad))
    expectBounds(boundsOf(inCamera({ heading: 30 }).probe), { x: 0, y: 0, width, height })
  })

  it("is the same for a heading and its negative, and for a half turn more", () => {
    const at = (heading: number) => boundsOf(inCamera({ heading }).probe)
    expectBounds(at(-30), at(30))
    expectBounds(at(210), at(30))
    expectBounds(at(180), { x: 0, y: 0, width: 800, height: 600 })
  })

  it("shrinks the turned viewport with the zoom, too", () => {
    expectBounds(boundsOf(inCamera({ heading: 90, zoom: 2 }).probe), { x: 0, y: 0, width: 300, height: 400 })
  })

  it("leaves the camera's centre where lookAt puts it however it is turned", () => {
    const { probe } = inCamera({ heading: 33, lookAt: { x: 10, y: 20 } })
    const bounds = boundsOf(probe)
    expect([bounds.x, bounds.y]).toEqual([10, 20])
  })
})

describe("ViewportPattern.visibleBounds — with no camera", () => {
  it("is its own layout box, centred on its own origin", () => {
    const probe = new Probe({})
    probe.layout({ x: 30, y: -20, width: 200, height: 100 }, SCOPE)
    expect(boundsOf(probe)).toEqual({ x: 0, y: 0, width: 200, height: 100 })
  })

  it("is nothing before it has been laid out", () => {
    expect(boundsOf(new Probe({}))).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it("ignores a stage's zoom and lookAt: a stage is not a camera", () => {
    const probe = new Probe({})
    const stage = new Canvas2D({ width: 800, height: 600, zoom: 3, lookAt: { x: 99, y: 99 }, children: [probe] } as never)
    stage.layout(BOX, SCOPE)
    expect(cameraOf(probe)).toBeNull()
    expect(boundsOf(probe)).toEqual({ x: 0, y: 0, width: 800, height: 600 })
  })

  it("ignores an orbit camera, which is not a Camera either", () => {
    const probe = new Probe({})
    const orbit = new OrbitCamera({ width: 800, height: 600, children: [probe] } as never)
    orbit.layout(BOX, SCOPE)
    expect(cameraOf(probe)).toBeNull()
    expect(boundsOf(probe)).toEqual({ x: 0, y: 0, width: 800, height: 600 })
  })

  it("ignores a plain shape around it", () => {
    const probe = new Probe({})
    new Rect({ width: 800, height: 600, children: [probe] })
    expect(cameraOf(probe)).toBeNull()
  })
})

describe("ViewportPattern.visibleBounds — the nearest Camera above", () => {
  it("is the camera the pattern is a direct child of", () => {
    const { probe, camera } = inCamera()
    expect(cameraOf(probe)).toBe(camera.id)
  })

  it("reaches past nodes between the pattern and the camera", () => {
    const probe = new Probe({})
    const camera = new Camera({ width: 800, height: 600, children: [new Rect({ children: [new Rect({ children: [probe] })] })] } as never)
    expect(cameraOf(probe)).toBe(camera.id)
  })

  it("is the inner one of two nested cameras", () => {
    const probe = new Probe({})
    const inner = new Camera({ width: 400, height: 300, zoom: 4, children: [probe] } as never)
    const outer = new Camera({ width: 800, height: 600, zoom: 2, children: [inner] } as never)
    expect(cameraOf(probe)).toBe(inner.id)
    expect(cameraOf(probe)).not.toBe(outer.id)
  })

  it("steps over an orbit camera or a stage to a Camera above them", () => {
    const probe = new Probe({})
    const orbit = new OrbitCamera({ width: 800, height: 600, children: [probe] } as never)
    const stage = new Canvas2D({ width: 800, height: 600, children: [orbit] } as never)
    const camera = new Camera({ width: 800, height: 600, children: [stage] } as never)
    expect(cameraOf(probe)).toBe(camera.id)
  })

  it("is null for a pattern with no parent", () => {
    expect(cameraOf(new Probe({}))).toBeNull()
  })

  it("reads the cameras it finds as they are, at the time it asks", () => {
    const { probe, camera } = inCamera({ zoom: 2 })
    expect(boundsOf(probe).width).toBe(400)
    camera.set({ zoom: 4 })
    expect(boundsOf(probe).width).toBe(200)
  })
})

describe("ViewportPattern.draw", () => {
  it("hands the pattern the visible bounds, once, inside a clip to those bounds", () => {
    const { probe } = inCamera({ zoom: 2, lookAt: { x: 10, y: -10 } })
    const ctx = renderProbe(probe)

    expect(asked).toHaveLength(1)
    expectBounds(asked[0], { x: 10, y: -10, width: 400, height: 300 })
    expect(ctx.events).toEqual(["beginClip", "endClip"])
    const clip = ctx.clips[0].ops()[0] as { kind: string; state: BoxBounds }
    expect(clip.kind).toBe("rect")
    expect(clip.state).toMatchObject({ x: 10, y: -10, width: 400, height: 300 })
  })

  it("asks for the region again each time it renders, so a moving camera is followed", () => {
    const { probe, camera } = inCamera()
    const xs = [boundsOf(probe).x]
    camera.set({ lookAt: { x: 200, y: 0 } })
    xs.push(boundsOf(probe).x)
    expect(xs).toEqual([0, 200])
  })

  it("fills its own box when there is no camera, with the same clip", () => {
    const probe = new Probe({})
    probe.layout({ x: 0, y: 0, width: 120, height: 60 }, SCOPE)
    const ctx = renderProbe(probe)
    expect(asked[0]).toEqual({ x: 0, y: 0, width: 120, height: 60 })
    expect(ctx.clips[0].ops()[0]).toMatchObject({ kind: "rect", state: { width: 120, height: 60 } })
  })

  it("draws the children after the pattern, outside its clip", () => {
    const child = new Rect({ width: 20, height: 20, fill: "red" })
    const probe = new Probe({ width: 100, height: 100, children: [child] } as never)
    probe.layout({ x: 0, y: 0, width: 100, height: 100 }, SCOPE)
    expect(renderProbe(probe).events).toEqual(["beginClip", "endClip", "draw:rect+shadow+fill"])
  })
})
