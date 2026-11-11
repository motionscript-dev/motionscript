# @motionscript/audio

Waveform components for [Motion Script](https://motionscript.dev): `fullWaveform`
draws a whole recording as bars with a played portion that advances, and
`liveWaveform` draws a meter that moves with playback.

```ts
import { FullWaveform, LiveWaveform } from '@motionscript/audio';

export const nodes = [FullWaveform, LiveWaveform];
```

## The host supplies the envelope

Nothing in the engine or in this package decodes audio. Both nodes draw the
loudness `envelope` they are handed in their `envelope` prop. A render has no
audio device and no analyser, so the picture has to be a pure function of time:
scrubbing backwards, jumping ahead and exporting frames out of order all draw the
same frame. Decoding a file into an envelope is the host's job, done once per
file before the document is built. The nodes declare no audio source and are not
tied to a clip: where a recording sits on the audio lane is the author's timing,
which is why `follow` is opt-in.

### The JSON form

A document stores the envelope as plain JSON:

```json
{
  "magnitude": [0, 0.25, 0.5, 1, 0.5, 0],
  "duration": 6,
  "speaker": [0, 0, 0, 1, 1, -1],
  "speakers": 2
}
```

- `magnitude`: peak loudness per bucket, `0` to `1`. The buckets divide
  `duration` seconds evenly.
- `duration`: the recording's length in seconds.
- `speaker`: one voice index per bucket (parallel to `magnitude`), `-1` for
  nobody identified, or `null` when the recording was never diarized.
- `speakers`: how many distinct voices there are; `0` when `speaker` is `null`.

`Float32Array` and `Int16Array` are accepted too, but `JSON.stringify` writes a
typed array as an object of indices, so a host that holds the typed form converts
with `Array.from` before it puts the envelope in a document.

## Nodes

| Key | Made for (w x h) | Commands | Notes |
|---|---|---|---|
| `fullWaveform` | 900 x 160 | `sweep` | whole recording; `progress` is the played share, or with `follow` the node's elapsed time over `envelope.duration`. `sweep` is a `to` of `progress` to 1 |
| `liveWaveform` | 420 x 220 | none | a `window` of seconds centred on `offset + elapsed` (or frozen at `offset` when `playing` is off); `style` is `bars`, `line` or `blocks`; `speaker` (-1 is every voice) filters to one voice |

Both take `byVoice` and `voiceColors` (a missing colour takes `VOICE_PALETTE`, eight
hues), and `align` of `center` or `bottom`. A voice colour is a plain string, never a
gradient or an image, so a voice declares no asset.

- **A column is the loudest bucket in it, not the mean** (`sampleEnvelope`), so
  transients survive downsampling.
- **A silent bar is a hairline, never a hole**: every bar is at least 1 px wide and
  tall, and the minimum height is taken before the bar is positioned, so it stays
  inside the box.
- **Bars are batched by paint**, so two voices are two draws however long the
  recording.
- **The frame is a function of the document and the node's clock**, so a seek redraws
  what was drawn the first time.

## Entry points

`@motionscript/audio` exports the two nodes, `NODES`, the envelope type and
`EMPTY_ENVELOPE`, and the pure helpers (`sampleEnvelope`, `forSpeaker`, `layOutBars`,
`paintBars`, `groupByPaint`, `voiceColor`). `@motionscript/audio/kit` (`src/kit.ts`)
exports the same helpers plus `livePaintKey`. A copy of `full-waveform` or
`live-waveform` (`registry.json`) takes three files into the project (`envelope.ts`,
`shared.ts` and the node); the copy's imports stay relative, so none is rewritten to
the kit specifier.

## Usage

```bash
npm install @motionscript/audio @motionscript/sdk
```

## Development

From the monorepo root:

```bash
pnpm --filter @motionscript/audio build
pnpm --filter @motionscript/audio test
```
