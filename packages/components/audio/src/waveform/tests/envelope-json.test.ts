import { describe, expect, it } from "vitest"

import { ContextMap, type MeasureContext2D } from "@motionscript/sdk"
import { ManifestAssetCatalog } from "@motionscript/core"

import { FullWaveform } from "../full-waveform"
import { LiveWaveform } from "../live-waveform"
import { sampleEnvelope, type AudioEnvelope } from "../envelope"
import { Recorder } from "./harness"

/**
 * The envelope's JSON form.
 *
 * The kit decodes no audio: the host hands each waveform node an
 * {@link AudioEnvelope} in its `envelope` prop. A document holds that value as
 * JSON, so the plain-array spelling has to draw exactly what the typed-array one
 * does. These tests pin the form the docs state.
 */

const MEASURE: MeasureContext2D = { measureText: () => ({ width: 0, height: 0 }) }

/** The form a document stores: plain arrays, nothing a `JSON.parse` could not return. */
const JSON_FORM = JSON.parse(`{
  "magnitude": [0, 0.25, 0.5, 0.75, 1, 0.5, 0, 0],
  "duration": 8,
  "speaker": [0, 0, 0, 0, 1, 1, -1, -1],
  "speakers": 2
}`) as AudioEnvelope

const TYPED_FORM: AudioEnvelope = {
  magnitude: new Float32Array([0, 0.25, 0.5, 0.75, 1, 0.5, 0, 0]),
  duration: 8,
  speaker: new Int16Array([0, 0, 0, 0, 1, 1, -1, -1]),
  speakers: 2,
}

const catalog = new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} })

/** Every op the node draws, laid out in a 400 x 80 box at time 0. */
function drawn(node: FullWaveform | LiveWaveform): string {
  node.attach({ assets: catalog, context: ContextMap.EMPTY, time: 0 })
  node.layout({ x: 0, y: 0, width: 400, height: 80 }, MEASURE)
  const ctx = new Recorder()
  ctx.execute(() => node.render(ctx))
  return JSON.stringify(ctx.drawn.flatMap((graphics) => graphics.ops()))
}

describe("the envelope's JSON form", () => {
  it("samples the same from plain arrays as from typed arrays", () => {
    expect(sampleEnvelope(JSON_FORM, 0, 8, 4)).toEqual(
      sampleEnvelope(TYPED_FORM, 0, 8, 4)
    )
  })

  it("survives a trip through JSON text", () => {
    const again = JSON.parse(JSON.stringify(JSON_FORM)) as AudioEnvelope
    expect(again).toEqual(JSON_FORM)
  })

  it("draws a FullWaveform the same from either form", () => {
    const props = { bars: 8, byVoice: true, width: 400, height: 80 }
    const fromJson = drawn(new FullWaveform({ ...props, envelope: JSON_FORM }))
    const fromTyped = drawn(new FullWaveform({ ...props, envelope: TYPED_FORM }))
    expect(fromJson).not.toBe("[]")
    expect(fromJson).toBe(fromTyped)
  })

  it("draws a LiveWaveform the same from either form", () => {
    const props = { bars: 8, window: 4, offset: 2, width: 400, height: 80 }
    const fromJson = drawn(new LiveWaveform({ ...props, envelope: JSON_FORM }))
    const fromTyped = drawn(new LiveWaveform({ ...props, envelope: TYPED_FORM }))
    expect(fromJson).not.toBe("[]")
    expect(fromJson).toBe(fromTyped)
  })

  it("accepts a recording nobody was identified in", () => {
    const anonymous: AudioEnvelope = { ...JSON_FORM, speaker: null, speakers: 0 }
    const bars = sampleEnvelope(anonymous, 0, 8, 4)
    expect(bars.map((b) => b.speaker)).toEqual([-1, -1, -1, -1])
  })
})
