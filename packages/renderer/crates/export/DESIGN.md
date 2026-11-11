# Native export sidecar (`ms-export`)

Status: prototype (2026-11-11). Nothing here ships or is published. A host
enables it explicitly; without it, export is the WebCodecs path in
`@motionscript/browser`.

## Build and run

```bash
cd packages/renderer/crates/export && cargo build --release   # target/release/ms-export(.exe)
ms-export info                                                # adapter, effects, encoders
ms-export encode --out out.mp4 --input stream.bin [--encoder auto|nvenc|software|<ffmpeg encoder>] [--preset p4] [--lanes N] [--no-encode] [--tee copy.bin]
```

ffmpeg is looked for beside the binary, then on PATH (`--ffmpeg` overrides). `WGPU_BACKEND=dx12|vulkan` picks the backend. The benchmark, from `packages/e2e` (for its `@/` paths): `node_modules/.bin/tsx ../renderer/crates/export/bench/run.ts --scenes rect-basic,text-basic --repeat 20`.

## Context

A browser export draws each frame with this renderer on the page's WebGPU
device and encodes it through WebCodecs. In a desktop host, the encoder sits
behind the browser's single GPU process. One window exports light 1080p scenes
at about 200 fps (Electron, measured 2026-11-06), and extra windows made it
slower (2/3/4 windows: 143/130/129 fps). In headless Chrome 157 the same path
measured 330–410 fps. The draw itself is cheap: 0.7 ms per frame on the page.
Most of the time goes to waiting on the encoder.

The renderer is Rust/wgpu, so it can run natively next to the host. There it
draws on the native GPU (DX12, Vulkan or Metal) and hands frames to an encoder
the host controls: NVENC through ffmpeg, else libx264.

## Decision

### The boundary: the renderer's own call stream

A host page already turns each frame into renderer calls. The adapter records
a `Doc`, and `WgpuBackend` diffs it into the delta protocol (`protocol.rs`),
plus a handful of resource calls: fonts, images, 3D scenes, surfaces and user
shaders. The sidecar takes exactly that stream.

- `web/src/native/recorder.ts`: `RecordingRenderer` has the WASM `Renderer`'s
  methods and appends each call that changes what is drawn to a byte stream
  (`StreamWriter`). Shader validation (naga) and text shaping still run on the
  page, in the same WASM, so the page behaves the same either way.
- `web/src/native/context.ts`: `NativeExportContext` is the adapter context
  over a `WgpuBackend` attached to the recorder. `frameDone()` appends a
  `FRAME` record.
- `@motionscript/browser`'s `exportVideoNative` runs `renderTimeline` (the
  same frame loop, asset gates and settle passes as `exportVideo`). Its sink
  appends `BEGIN`/`FRAME`/`AUDIO`/`END` and flushes the stream to a host
  `NativeExportTransport` in 256 KB chunks. Each write resolves when the
  sidecar can take more, so backpressure reaches the frame loop.
- `crates/export/src/stream.rs` owns the format: `MSX1` and a version, then
  `[op][len][payload]` records.

Ruled out:

- **Serialising the adapter's per-frame `Doc`.** It is the same information
  without the diffing. Every node would cross every frame (the backend already
  sends only changes), and the Rust side would need a second decoder.
- **Running core and the adapter in Node or a utility process.** That needs
  DOM-free versions of image decode, video decode, font loading and the
  dynamic-node compiler. It would also be a second host of the engine's frame
  loop. The page already has all of these, and the stream is what a native
  renderer needs. JS cost per frame measured 0.03–0.5 ms on the e2e scenes
  (2,000–37,000 fps with the stream discarded), so the page is not the
  bottleneck.

### Fonts, images, media, audio

- **Fonts:** the bytes the page registered, sent once (`FONT`).
- **Images:** decoded on the page and read through a 2D canvas (`IMAGE`, RGBA8
  with straight alpha). The sidecar premultiplies them as the browser's GPU
  copy does. This costs one read per image, which suits stills.
- **Video frames:** the same path, every frame. It works but is slow: 3.6 MB
  per 1080p frame through the stream (video-playback ran at 47 fps on the page
  alone). The sidecar should decode the asset itself instead (see "Left to
  ship").
- **Audio:** mixed on the page after the last frame by the exporter's own
  mixer, then sent as f32 PCM (`AUDIO`). The sidecar writes a WAV and muxes it
  as AAC (`-c:v copy`).

### Frames to the encoder

The renderer draws into an RGBA8 target at the supersampled size (default
2×). A compute pass (`convert.rs`) box-filters it to the output size and
writes NV12 (BT.709, limited range) into a buffer, which is copied into a
mapped readback slot. Only 1.5 bytes per output pixel cross to the CPU,
against 16 bytes for RGBA at 2× supersampling. A writer thread writes each
slot straight from the mapping into ffmpeg's input (a 16 MB named pipe on
Windows, stdin elsewhere), then frees it. The render loop only waits when
every slot is in flight.

ffmpeg encodes with `h264_nvenc`/`hevc_nvenc`/`av1_nvenc` (preset p4, VBR,
1 s GOP, no B-frames) when `ffmpeg -c:v <nvenc>` opens on this machine, else
`libx264`/`libx265`. Bitrate is the exporter's `motionGraphicsBitrate` unless
the host passes one.

### Encoder lanes (built, off by default)

`--lanes N` sends GOP `g` to encoder `g % N`. Each lane writes an Annex-B
stream with an AUD on every frame and an IDR exactly every GOP, so the output
splits back into GOPs by counting AUDs. A muxing ffmpeg copies them, in order,
into the MP4 (`lanes.rs`), with exact frame times (`setts`). The joined file
decodes cleanly and matches the single-lane file (48.89 dB vs the WebCodecs
file either way). Reading raw frames from a file, two NVENC sessions reach
~830 fps where one reaches ~470. Through pipes, though, two lanes were slower
than one (~310 vs ~400 fps): writing into the pipe takes 2.2 ms per frame for
one lane and 5.8 ms for two. The CPU path (mapped memory → pipe → ffmpeg →
CUDA upload) is the ceiling, not NVENC.

### The host

The studio's desktop app spawns one `ms-export encode --input -` per export
when the export starts, so the device and pipelines come up (~0.4 s warm on
Vulkan, ~3 s cold on DX12) while the page builds its first frame. It relays
transport writes over IPC into the sidecar's stdin and reads the MP4 back on
`finish`. `ms-export info` returns the effect table (the recorder needs the
renderer's effect indices), the adapter, and which encoders open. This is
gated on `MOTIONSCRIPT_NATIVE_EXPORT=1`. Any failure other than a cancel falls
back to the WebCodecs export. A packaged app would ship `ms-export` and an
ffmpeg build in `resources/ms-export/`.

### The renderer crate

`ms-renderer` gains a `native` feature (`src/native.rs`, `src/gpu_native.rs`)
and nothing else changes for WASM:

- `gpu.rs` builds natively under the feature;
- the surface is an `Option` (an offscreen `Gpu` has none);
- `prewarm` and the browser image copy are WASM-only;
- the native backends come from `WGPU_BACKEND` or `PRIMARY`.

`crates/export` is its own Cargo workspace, so the renderer workspace's
lockfile, its `cargo test --workspace` and the WASM build never compile
wgpu's native backends.

## Measurements

RTX 5070 Ti, Ryzen 9700X, Windows 11, driver 610.88. e2e scenes at 960×540,
30 fps, each played 20 times back to back (1,200 frames; math-surface-plot
2,280), exported at scale 2 (1920×1080) with 2× supersampling.

- WebCodecs: `exportVideo` in Chrome 157 headless on the GPU.
- Native: the page streams to the sidecar through the bench driver
  (Playwright binding, base64).
- Replay: the sidecar alone, replaying the recorded stream with encoding.
- Render: the replay without encoding.
- Bench: `bench/run.ts`.

| scene | WebCodecs fps | native fps (end to end) | page alone fps | replay fps | render-only fps | PSNR vs WebCodecs | SSIM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| rect-basic | 419 | 345 | 40,678 | 393 | 1,874 | 48.9 dB | 0.9996 |
| text-basic | 428 | 323 | 12,739 | 383 | 1,770 | 48.9 dB | 0.9996 |
| fill-linear-gradient | 426 | 343 | 33,426 | 409 | 1,789 | 39.6 dB | 0.9989 |
| effect-blur | 410 | 330 | 12,685 | 378 | 1,707 | 48.6 dB | 0.9992 |
| image-fit-fill | 421 | 314 | 21,858 | 371 | 1,508 | 46.0 dB | 0.9975 |
| math-surface-plot | 383 | 236 | 2,231 | 404 | 1,767 | 39.9 dB | 0.9968 |
| video-playback | 91 | 7 | 50 | 196 | 457 | 47.8 dB | 0.9980 |

"Page alone" is the page recording the stream and discarding it. All rows use
the zero-copy readback writer and one encoder lane.

- Frame counts match on every scene.
- File sizes are within ±10% at the same bitrate.
- The lower PSNR on gradients and math-surface-plot comes from the two paths'
  different scaling and chroma subsampling. The renderer's frames are the same
  in both.

What the numbers say:

- The native renderer draws and converts 1080p at 1,500–1,870 fps (4K
  supersampled). The draw is not the limit, and neither is the page: it
  produces the stream at 2,000–40,000 fps.
- ffmpeg through a pipe caps the native path at ~370–410 fps (replay), about
  what WebCodecs does in headless Chrome. Against the 200 fps measured in an
  Electron window that is up to 2×. It is not the 4× the renderer allows.
- End to end runs 15–40% below replay because the bench's page-to-driver
  transport (CDP, base64) is in series. An Electron host relays over IPC.
- Video is the outlier. Streaming RGBA frames costs 3.6 MB per frame, and
  reading them through a 2D canvas runs at 50 fps on the page, so the sidecar
  has to decode video itself.

## Left to ship

1. **Zero-copy encode.** Hand NVENC the NV12 buffer on the GPU: the NVENC SDK
   with D3D12 input (wgpu's `as_hal` gives the `ID3D12Resource`), or CUDA
   interop on Vulkan through external memory. That removes all three CPU
   copies and the pipe, where the current ceiling lives. Encoder lanes then
   use both NVENC engines. Keep the ffmpeg pipe as the fallback for software
   encoders and other vendors.
2. **One renderer core.** `native.rs` mirrors `lib.rs`'s `api::Renderer`
   (surfaces, build, render). Move the shared body into a platform-neutral
   struct both wrap.
3. **Video in the sidecar.** Decode video assets natively (ffmpeg, NVDEC)
   from the source and frame time, instead of streaming RGBA frames. That
   needs the asset bytes or path and the clip's frame times in the stream.
4. **Studio host.** Stream the MP4 from the temp file into the save stream
   instead of returning bytes over IPC. Report the sidecar's progress. Bundle
   `ms-export` and a licensed ffmpeg build (LGPL, NVENC enabled) in
   `resources/`, and sign them. Add a settings toggle in place of the env
   flag.
5. **Parity checks.** Add the native path to the e2e lane (replay a recorded
   stream, compare frames). Then decide on BT.709 limited range against what
   WebCodecs tags.
6. **NV12 packing** needs a width that is a multiple of 4. Pad the row stride
   to lift that.
7. Engine rules: `RULES.md` says MP4 encoding uses mediabunny/WebCodecs. A
   shipped sidecar amends that, and `browser`'s barrel test lists
   `exportVideoNative`.
