# Export through the wgpu renderer

Phase 5 (DESIGN.md §8). `@motionscript/browser`'s `exportVideo` (and
`exportVideoParallel`, which renders frame-range chunks across lanes and joins
them without re-encoding) drives core's frame loop around a surface of this
renderer: per frame `loadAt` → `stateAt` → `layout` → `renderSettled`, then
the frame goes to the encoder.

## How a frame reaches the encoder

- **No readback.** The encoder is mediabunny's `CanvasSource` on the WebGPU
  canvas itself. Wrapping the canvas in a `VideoFrame` takes ~0.0–0.1 ms, the
  same as a copy through a 2D canvas, so frames are encoded from the WebGPU
  canvas directly.
- **Encoder settings** are the exporter's defaults: avc,
  `motionGraphicsBitrate` (0.2 bits per pixel per frame), a key frame every
  1 s, `latencyMode: quality`, `contentHint: detail`,
  `hardwareAcceleration: no-preference`.
- **Supersampling.** The default `supersample: 2` renders 4× the pixels and
  lets the encoder's `transform` scale the canvas down to the output size.
- **Video frames** are WebCodecs decodes at each frame's time (mediabunny
  `VideoSampleSink`, `engine/storage.ts`), then `createImageBitmap` and a
  re-upload.

## Where the time goes

Measured on Apple M4, Chrome headless on the GPU, 960×540 e2e scenes at 30
fps, scaled 2× for 1080p and 4× for 4K:

1. **The H.264 encoder sets the floor.** At 4K, VideoToolbox takes ≈ 14.5–15
   ms per frame (~65 fps) whatever is drawn; at 1080p the floor is ≈ 4 ms per
   frame, at 960×540 ≈ 2–3 ms. Only at the smallest size does render speed
   show in the total.
2. **Main-thread cost is small.** core (state, layout, recording into the
   doc): 0.2–3 ms per frame; sync + render submit: 0.2–2.4 ms.
3. **Dense strokes at 4K are GPU-bound** (math-vector-field: many arrows and
   strokes; path band cost, DESIGN.md §4.2).
4. **Long, many-path scenes** (math-surface-plot) spend 2.4–3.3 ms per frame
   in `render` (sync + submit), plus ~2 ms of GPU/encoder wait. The adapter
   context records a **new Doc every frame**, so every node is dirty and every
   frame re-sends and re-encodes the whole scene through the delta protocol:
   the retained renderer's main advantage (only changed nodes cross into
   WASM) is unused in this path.

## What would speed it up (in order of payoff)

1. **More encoders.** Above 960×540 the encoder is the bottleneck, and the
   render is cheap enough to feed more than one. `exportVideoParallel` splits
   the timeline on key frame boundaries; its lanes share the GPU process's
   encoder, so how many pay off is measured, not assumed. Beyond that, HEVC/AV1
   hardware encoders and a lower bitrate are the only levers.
2. **Retained docs across frames.** Have the context reuse node identities
   frame to frame (diff against the last doc) so `sync` sends only what
   changed. This targets the 2–3 ms per frame on long, dense scenes and the
   per-frame re-encode of 3D scenes.
3. **The 4K GPU hotspot** (math-vector-field): x-tiles for path bands
   (DESIGN.md §4.2).
4. **Worker + OffscreenCanvas:** render and encode in a worker so core's
   0.2–3 ms per frame overlaps GPU and encode work. The gain is modest while
   the encoder is the bottleneck. Its main value is keeping the UI responsive
   during a long export.
5. **Video frames:** upload the decoded `VideoFrame` directly rather than
   through `createImageBitmap`, keeping colour conversion consistent with
   `colorCorrect` (DESIGN.md §5.6).
