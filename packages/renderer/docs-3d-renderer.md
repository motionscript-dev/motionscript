# ms-render3d: Scene3D through wgpu (Phase 4 foundation)

`crates/render3d` (`ms-render3d`) draws core's recorded 3D scene data, the
`Scene3D` that `Canvas3D` and `Fills.canvas3D` produce, with wgpu on the
WebGPU backend. It replaced the engine's three.js r185 backend, which replayed
a `Scene3D` into three and painted it as a fill, and keeps that look
(`docs-3d-coverage.md`).

## Architecture

```
core Scene3D ──encode.ts──▶ u32 word stream ──scene::decode──▶ Scene ──Renderer3D::render──▶ target view
 (TS, engine)    (thin)      (one ArrayBuffer)    (Rust)        (flat)     (records into caller's encoder)
```

| Piece | File | Owns |
|---|---|---|
| Encoder | `web/src/r3d/encode.ts` | `encodeScene3D(scene, report, textures?, geometries?)`: descriptor values into words, NaN for unset numbers. Calls core where core owns the answer: `parseColor`, `resolveCameraPlacement`, `cylinderRadii`, `segmentsOf`, `evaluateRoundedBox`, `evaluateParametric` (rounded boxes and parametric surfaces become buffers, as skia-render's geometry handler does). `GeometryTable`: the geometry the renderer keeps across frames (see Retained geometry) |
| Decoder | `crates/render3d/src/scene.rs` | the stream into a flat `Scene`: draws with world matrices, lights in world space, camera, settings. Resolves the hierarchy with three's `Object3D` rules: `lookAt` > `quaternion` > `rotation` (Euler orders), objects aim +Z and cameras/lights -Z, inherited `visible`, three's defaults for every unset field, colour linearization (`setRGB(.., SRGBColorSpace)`), point/spot ×4π |
| Geometry | `src/geometry.rs` | three r185's `Box/Sphere/Plane/Cylinder(Cone)/Torus/TorusKnot/Circle/Ring/Capsule/Tetra-Octa-Icosa-Dodecahedron/Lathe/Tube` generators ported vertex for vertex (order, UVs, winding, material groups; the later ones in f64 as three computes them, Tube over a centripetal `CatmullRomCurve3` with three's arc-length table and Frenet frames), `EdgesGeometry`, `WireframeGeometry`, `computeVertexNormals`, `computeLineDistances`, bounds and bounding sphere |
| Renderer | `src/renderer.rs` | `Shared3D` (per device: shader modules, layouts, pipelines per target format, DFG LUT, samplers) and `Renderer3D` (geometry defs by id; GPU geometry keyed by def id, or descriptor hash for inline geometry, and draw mode, swept when unused for a frame, its buffers kept spare for one frame for a geometry of the same sizes; MSAA 4x colour and depth targets; a shadow-map array; the transmission target; per-frame uniforms and instance data) |
| Shaders | `src/shaders/mesh.wgsl`, `shadow.wgsl`, `mip.wgsl` | three's meshbasic / meshstandard(physical) / meshphong / meshlambert / meshtoon / meshnormal / meshdepth / linedashed / shadow / sprite / points programs in one module; DFG LUT is three's own 16x16 table (`src/dfg.rs`); `mip.wgsl` builds the transmission target's mips |
| Test entry | `src/wasm.rs` (feature `wasm`) | `R3d.create(canvas, w, h)`, `set_scene(Uint32Array)`, `resize`, `render`, `read_pixels`, `wait_gpu`, `stats`, `skipped`. Owns the device and the canvas; the renderer never does |
| Build | `scripts/build-wasm-r3d.sh` | `web/pkg-r3d` (only its `.d.ts` is committed). 300 KB raw, 109 KB gzip |

### Frame (`Renderer3D::render`)

1. Resolve geometry for every draw (cache hit, or build and upload, into a
   spare geometry's buffers when the sizes match), union world
   AABBs into the scene bounds (three's `Box3.setFromObject`).
2. Camera from `handlers/camera.ts`: default perspective (fov 50, (0,0,5),
   0.1..1000) when the scene has none; clip planes from the bounds unless both
   `near` and `far` are given (`reach = max(span, distance ?? 2·max(span,1), 1)`,
   `near = max(0.01, reach/1000)`, `far = reach·10`); `zoom` as three applies it.
3. Lights from `handlers/light.ts`: shadow frustum `extent = shadow.extent ??
   max(1, span·0.75)` (10 without bounds), `near = max(0.05, extent·0.05)`,
   `far = max(near+1, extent·8)`, `bias = -(far-near)/(mapSize·512)`,
   `normalBias = extent·0.01`, `radius = 1 + softness·8`, map size by quality
   (512 / 2048 / 4096). Directional (ortho) and spot (perspective, `2·angle`)
   cast; up to 4 shadowed lights, 16 lights total.
4. Items: one per draw, per material group for a material array (nothing for a
   geometry without groups, like three), two for a double-sided transparent
   material (back faces first). Opaque sorted by `renderOrder`, then NDC z of
   the bounding-sphere centre front to back; transparent by `renderOrder`, then
   back to front; then recording order.
   Materials with `transmission > 0` go to a third list (three's
   `transmissive`), sorted back to front and drawn between the two.
5. Shadow passes (depth only; the material's opposite side, as three does).
6. With a transmissive item, three's `renderTransmissionPass`: the opaque
   list into a 4x MSAA `Rgba16Float` target at the viewport size, cleared to
   (0.5, 0.5, 0.5, 0.5) (three's white at half alpha, premultiplied), with no
   tone mapping and no sRGB encode (the target is in the working space),
   resolved, then a mip chain (bilinear 2x2, as `generateMipmap`).
7. One MSAA pass cleared to transparent and resolved into the target.

### Shading, matched to three r185

- Standard/physical: GGX with three's `BRDF_GGX_Multiscatter` for direct light
  and `computeMultiscattering` for indirect, `geometryRoughness` from view-space
  normal derivatives, roughness clamp 0.0525, F0 0.04.
- Ambient and hemisphere into indirect diffuse; `preset: "studio"` environment
  as the uniform radiance three's PMREM of a `0xbbbbbb` room produces
  (`srgbToLinear(0xbb)·intensity`), which is exact because that room is uniform;
  `scene.environmentIntensity` replaces the material's `envMapIntensity` as in
  three; standard, physical, Lambert and Phong take it (r185). `background: true` draws it first.
- Basic, lines, points, sprites unlit; Phong (Blinn-Phong, three's `D`/`G`) and
  Lambert (no specular lobe), both with the environment as diffuse
  irradiance (`irradiance += iblIrradiance`, new in r185); toon (Lambert with
  `getGradientIrradiance`: the gradient map's red at `(dotNL·0.5+0.5, 0)`, or
  the 0.7/1.0 step smoothed by `fwidth`; no environment); `Mat.normal()` and
  `Mat.depth()` raw (no tone mapping, encoding or fog; depth is `1 -
  gl_FragCoord.z`, basic packing); `Mat.shadow()` as `opacity·(1 -
  shadowMask)`; `lineDashed` discards where `mod(scale·lineDistance, dash +
  gap) > dash`, distances from `computeLineDistances` (non-indexed only, as in
  three; kept in the vertex normal's x, since lines are unlit).
- Physical: `ior` sets F0 `((ior-1)/(ior+1))²` (1.5 is standard's 0.04);
  clearcoat (`BRDF_GGX_Clearcoat` per light, `EnvironmentBRDF` on the
  environment radiance, `outgoing·(1 - cc·Fcc) + cc·(direct + indirect)`, its
  roughness clamped and widened like the base); transmission
  (`getIBLVolumeRefraction`: refract through `thickness · modelScale`,
  project the exit point, three's bicubic sample at lod
  `log2(width)·roughness·clamp(2·ior - 2)`, Beer attenuation, `(1 - F)` by
  `EnvironmentBRDF`, then `transmissionAlpha` into the output alpha).
- Area lights (`RectAreaLight`) on standard/physical only, as three. The
  engine never calls `RectAreaLightUniformsLib.init()`, so three binds its
  empty texture for `ltc_1`/`ltc_2` and samples zeros: the LTC Fresnel, and
  so the specular lobe, is zero, and what shows is the table-free diffuse
  term, `LTC_Evaluate` with an identity matrix (the clipped polygon form
  factor). That is what is ported; the LTC tables are not needed until the
  engine inits them (then: the 64x64 `LTC_FLOAT_1/2` data and the specular
  term).
- PCF shadows: three's 5-tap Vogel disk rotated by interleaved gradient noise,
  hardware compare (`LessEqual`) with linear filtering, normal-offset in world
  space.
- Output order as three: tone mapping (none, linear, Reinhard, Cineon, ACES
  filmic, AgX, neutral; ACES when unset) → sRGB OETF → fog. Fog mixes after
  encoding with the gamma-encoded colour, since three uploads `fogColor` in the
  output space. The target holds what three's canvas holds: sRGB-encoded,
  premultiplied by coverage and blending (blend factors are three's for
  normal / additive / subtractive / multiply / none; `NormalBlending` only when
  `transparent`; `depthWrite = !blends` unless stated).

## The encoding

All little-endian 32-bit words, `u` unsigned, `f` f32 (NaN = unset). A colour
slot is `u has, f r, g, b, a` with core's gamma-encoded values. A segments slot
is `u kind (0 unset, 1 scalar, 2 tuple), f, f, f`.

```
header      u MAGIC 0x52334431 ("R3D1"), u VERSION 3
settings    u tone (0 none 1 linear 2 reinhard 3 cineon 4 aces 5 agx 6 neutral), f exposure
            u shadows on, u quality (0 low 1 medium 2 high)
            u fog (0 none 1 linear 2 exp2), colour fog, f near, f far, f density
            u env (0 none 1 studio), f intensity, u background, f blur
ops         u count, then per op:
  1 push    transform
  2 pop
  3 light   u type (0 ambient 1 hemisphere 2 directional 3 point 4 spot 5 area), colour,
            f intensity, colour sky, colour ground, f distance, f decay, f angle(deg),
            f penumbra, u hasTarget, f x y z, u casts, f softness, f extent, f width, f height,
            transform
  4 camera  u type (0 perspective 1 orthographic), transform (placement resolved by core),
            f fov, f zoom, f frustumHeight, f near, f far, f distance
  5 mesh    geometry, u materialCount (1 = single, else array), material*, transform
  6 instances geometry, material, transform, u n, transform*n, u nColors, (f r g b a)*nColors
  7 points  geometry, material, transform
  8 line    geometry, material, u mode (0 strip 1 segments 2 loop), transform
  9 sprite  material, transform
  10 model  transform (recorded, not drawn)
transform   u flags (1 position, 2 rotation, 4 quaternion, 8 scale, 16 lookAt, 32 hidden,
            64 shadow, 128 renderOrder), then present fields in that order:
            f xyz | f xyz deg + u order (XYZ YXZ ZXY ZYX YZX XZY) | f xyzw | f xyz | f xyz |
            - | u mode (0 off 1 on 2 cast 3 receive 4 options) | f
geometry    u type, then: 0 box f w h d, seg | 1 sphere f r, seg, f start sweep latStart latSweep |
            2 plane f w h, seg | 3 cylinder f top bottom height, seg, u capped, f start sweep |
            4 cone f r height, seg, u capped, f start sweep | 5 torus f r tube, seg, f start sweep |
            6 torusKnot f r tube, seg, f p q | 7 circle f r, seg, f start sweep |
            8 ring f r inner, seg, f start sweep |
            9 buffer u flags (1 normal 2 uv 4 color 8 index 16 computeNormals), u nVerts, u nIndex,
              f position*3n, [normal*3n], [uv*2n], [color*3n], [u index*nIndex] |
            10 capsule f r height, seg | 11 polyhedron u shape (0 tetra 1 octa 2 icosa 3 dodeca),
              f r, f detail (resolved: 0 unless segments) | 12 lathe u n, f (x y)*n, seg, f start sweep |
            13 tube u n, f (x y z)*n, u closed, f r, seg | 14 edges f threshold, geometry |
            15 wireframe geometry | 16 ref u def id | 255 unsupported
material    u type (0 basic 1 standard 2 physical 3 lambert 4 phong 5 normal 6 points 7 lineBasic
            8 lineDashed 9 sprite 10 shadow 11 toon 12 matcap 13 depth 14 shader), colour,
            f opacity, f roughness, f metalness, colour emission, f emissionStrength,
            f envMapIntensity, u flags (1 transparent 4 wireframe 8 vertexColors 16 flat
            32 !toneMapped 64 !visible 128 !depthTest 256 depthWrite set 512 its value
            1024 !sizeAttenuation), u faces (0 front 1 back 2 both),
            u blend (0 normal 1 additive 2 subtractive 3 multiply 4 none), f alphaTest, f size,
            colour specular, f shininess, map,
            f clearcoat, f clearcoatRoughness, f transmission, f thickness, f ior,
            f attenuationDistance, colour attenuationColor, f dashSize, f gapSize, f scale,
            map gradientMap (toon only)
map         u has, u texture id, f uv matrix rows (a b c, d e f), u flags (wrap s 0-1, wrap t 2-3,
            16 flipY, 32 mag nearest, 64 min nearest)
```

then, after the ops:

```
defs        u count, then per def: u id, geometry      (v3)
```

Version 2 added the light's width/height, geometry types 10-15 and the
material fields after `map`. Version 3 added geometry defs and references;
the decoder still reads version 2 streams (no defs section).

### Retained geometry (v3)

Core rebuilds the `Scene3D` every frame, so the stream is still a whole scene
each frame, but geometry, which is nearly all of its words (a parametric
surface at 80 segments is 40k), travels once. With a `GeometryTable` (the
backend keeps one per scene image), a draw's geometry is `16 ref id` and the
geometry itself is a def, sent only on the frame that introduces it:

- **An id's content never changes.** New content takes a new id. The renderer
  keeps the defs the frame refers to (hidden draws included: the decoder
  lists every ref, in `Scene::geometry_refs`) and drops the rest in
  `set_scene`; the table forgets the same ids at the same frame, so the two
  sides agree without acknowledgements. A failed `set_scene3d` throws the
  table away.
- **Fixed-shape geometry** (box, sphere, …, lathe, tube, edges or wireframe of
  one) is keyed by its own words, so equal geometry anywhere in the scene is
  one def. A rounded box is keyed by its parameters and evaluated only when
  they are new.
- **Buffers and parametric surfaces** are keyed by slot, as the reconciler
  keys a drawable: `<node scope>|<op kind>|<signature>|<nth>`, the scope being
  the enclosing push's `key` (core's node id) and the signature the
  descriptor without its data, functions, `revision` or `staticData`. A
  parametric surface whose `revision` is unchanged is not evaluated at all
  (the math kit's surfaces set one from their content); a buffer with the same
  arrays and an unchanged `revision`, or `staticData`, is not copied. Otherwise
  the fresh words are compared with the slot's last: equal keeps the id (three
  re-uploads such a buffer every frame), different makes a new def.

The GPU geometry of a def is keyed by its id and mode (it never changes), so
nothing is hashed per frame; an animated surface's new def every frame reuses
the buffers of the one it replaces (`spare`), written with `write_buffer`. What
is left per frame is a few hundred to a few thousand words (transforms,
materials, lights, camera; 0.01-0.03 ms to decode), so the rest of the scene
is not delta-encoded: a material or transform table would save less than the
encoder spends writing the words it would compare.

## Status

Parity against the engine's former three.js path, as measured before that
backend was removed: the same scenes through three's reconciler at the same
size, compared with the lab's SSIM and the e2e changed-pixel share
(tolerance 8). 480x300, frame 0:

| Case | What it covers | SSIM | changed % |
|---|---|---|---|
| e2e-view3d-basic | `view3d-basic` scene | 0.9995 | 0.16 |
| e2e-view3d-fill-shape | `SpinBoxEllipse` scene | 0.9993 | 0.18 |
| e2e-view3d-band | `SpinBoxStrokeRect` band scene | 0.9963 | 0.79 |
| e2e-view3d-translucent | `view3d-translucent` | 1.0000 | 0.01 |
| primitives | 10 geometry types, rounded box | 0.9983 | 0.49 |
| materials | metal/rough ramp, studio env, unlit, emissive, opacity, colour alpha, normal | 0.9964 | 0.70 |
| lights | hemisphere, point (distance), spot (penumbra) | 0.9986 | 0.31 |
| shadows | directional PCF shadow | 0.9972 | 0.60 |
| groups | nested groups, YXZ order, non-uniform scale, `lookAt`, mirrored scale | 0.9992 | 0.22 |
| ortho-fog | orthographic, linear fog, AgX | 0.9965 | 0.87 |
| instances | 400 instances, per-instance oklch colours, neutral | 0.9935 | 3.09 |
| buffers-lines | parametric with vertex colours, line strip, wireframe | 0.9942 | 0.96 |
| points-phong | points with vertex colours, Phong, Lambert | 0.9931 | 0.88 |
| stress-meshes | 1000 separate meshes | 0.9862 | 7.74 |

The three.js oracle's 16 scenes, at their sizes:

| Scene | SSIM | changed % | Not drawn |
|---|---|---|---|
| view3d-basic | 0.9994 | 0.15 | |
| view3d-fill-shape | 0.9996 | 0.09 | |
| view3d-fill-stroke-shadow | 0.9943 | 1.38 | |
| view3d-tex-surface | 1.0000 | 0.00 | |
| view3d-translucent | 1.0000 | 0.01 | |
| texture3d-zoom | 0.9986 | 0.34 | |
| unit-fog-linear / exp2 | 0.9994 / 0.9995 | 0.16 / 0.15 | |
| unit-lights-directional | 0.9971 | 0.60 | |
| unit-lights-point-spot | 0.9992 | 0.29 | |
| unit-tone-env | 0.9994 | 0.19 | |
| unit-transparency | 0.9991 | 0.20 | |
| unit-materials | 0.9974 | 0.44 | |
| unit-primitives | 0.9978 | 0.62 | |
| unit-draw-kinds | 0.9948 | 1.12 | |
| unit-lights-hemi-area | 0.9993 | 0.16 | |
| unit-gap-variants | 0.9984 | 0.41 | |

Every scene draws everything it records. Before the gap work (3d-gaps)
transparency, materials, primitives, draw-kinds and hemi-area stood at
0.9840 / 0.9756 / 0.9405 / 0.9396 / 0.9356, missing transmission, toon /
depth / clearcoat, capsule / polyhedron / lathe / tube, dashed lines and
edges / wireframe geometry, and the area light. Materials also gained from
r185's environment on Lambert and Phong (0.9909 to 0.9974). `unit-gap-variants`
covers the variants the unit scenes take once (gradient-map toon, ior 2,
metal clearcoat, rough attenuated and partial transmission, polyhedra with
detail, closed tube, dashed segments with scale, area light over Phong).

Ad-hoc checks (`r3d.compareScene`) also match: sprites, box and cylinder
material arrays, default camera, back-side material, negative scale, spot
shadows, environment background, `renderOrder` with transparency. What remains
is MSAA edge coverage: the changed share halves each time resolution doubles,
and a quad's signed edge alpha difference is symmetric (top = bottom,
left = right), so there is no geometric offset. The cause is the mirrored
sample grid (GL is y-up) plus resolve rounding. Interiors match to within
1 LSB.

Frame cost (Apple GPU via Metal, Chrome 152, 640x400, ms per frame, 120 frames; CPU =
from `scene.build()` to submitted work, core's recording included for both;
wall = with the GPU drained at the end):

| Case | ours CPU | three CPU | ours wall | three wall |
|---|---|---|---|---|
| e2e-view3d-basic | 0.03 | 0.02 | 0.26 | 0.05 |
| instances (400) | 0.37 | 0.32 | 0.44 | 0.35 |
| shadows | 0.05 | 0.12 | 0.40 | 0.28 |
| stress-meshes (1000) | 2.5 | 5.7 | 2.5 | 6.9 |

Small scenes cost about the same on both and are dominated by fixed
per-frame work. Separate meshes scale better here (one instance and uniform
upload per frame, cached pipelines). Of the stress case's 2.5 ms, core's
recording is 0.6 ms and the TS encoder about 1.2 ms (45k words), so the
encoder is the first thing to optimize, or to replace with a retained form.

Where an animated 3D frame went before (`engine-lab.mjs --profile`, 960×540,
math-surface-plot): 3.0 ms of CPU. The encoder took 0.8 ms (the surface
re-evaluated every frame although its `revision` held: 43k words). The
renderer's frame took 1.3 ms: it redrew the axes' nine label surfaces and
rebuilt their mipmapped maps every frame (the adapter hands over a new
document, so every surface looked changed), and the 3D draw hashed the 43k
words with SipHash to find its cached geometry. Core's recording took 0.8 ms.
After: 1.2 ms. The encoder takes 0.4 (it evaluates only on the morph's frames,
which three does too), the renderer 0.2 (3D draw 0.1, surfaces 0) and the
recording 0.5. The GPU side did not show: the scenes cast no shadows, MSAA 4x
runs at the scene's own (2x-capped) resolution, and in a steady frame nothing
is created on the GPU but the target image's view (the shadow layers' views
are now kept). On small scenes at 4K, what is left between the renderers is
the 2D path's per-frame cost at 3840×2160, not 3D: `rect-basic` has it with no
3D at all.

**Done:** box (incl. rounded via core), sphere, plane, cylinder, cone,
torus, torus knot, circle, ring, capsule, the four polyhedra, lathe, tube,
edges, wireframe, buffer, parametric; groups and every transform
field; perspective/orthographic/default camera with bounds-derived clip planes;
basic, standard, physical (ior, clearcoat, transmission with three's
pre-pass), Lambert, Phong, toon (gradient map or two-tone), normal, depth,
shadow, points, lines (strip/segments/loop, 1 px like WebGL; dashed),
sprites; vertex and
instance colours, flat shading, wireframe, faces, blend modes, depth flags,
alpha test, `visible`, `toneMapped`; ambient, hemisphere, directional, point,
spot, area (as the engine sets three up: diffuse only, see Shading); directional, spot and point (cube) shadow maps with three's PCF;
colour `map` from images, data textures and `Tex.surface` rasters, with
three's uv transform (offset, repeat, rotation, center), `flipY`, wrap, filters,
colour space and sRGB-correct mips; linear and exp2 fog;
all seven tone mappings and exposure; studio environment (lighting and
background); MSAA 4x; three's transparency sorting; instancing.

**Deferred** (the encoder reports each in `report.unsupported`, the page shows
them):
- texture maps other than `map` (normal, roughness, metalness, ao, alpha,
  emission, light, displacement, env); a map on points (`gl_PointCoord`);
- glTF models and skinning (`model`, `modelGeometry`);
- geometry: extrude (three's `ExtrudeGeometry` plus core's path-to-shape);
- environment `src`/`faces` (HDR/EXR/cube) and real IBL prefiltering (core
  itself only renders `preset: "studio"`, which is done); `blur`;
- physical extras: sheen, iridescence, anisotropy, dispersion, specular
  colour/intensity, clearcoat and transmission maps; transmission's extra
  back-face render of a double-sided transmissive mesh into the target
  (three does it when `WEBGL_multisampled_render_to_texture` is missing);
  matcap (drawn as standard); custom shaders (`Mat.shader`, WGSL only);
- the area light's specular lobe (LTC tables; zero in three as the engine
  sets it up), `polygonOffset`, `params` passthrough, `post` (core does not
  apply it either).

## Integration seam (for the main session)

```rust
let shared = ms_render3d::Shared3D::get(&device, &queue);   // the device's one set of pipelines
let mut r3d = ms_render3d::Renderer3D::with_shared(&shared, wgpu::TextureFormat::Rgba8Unorm);
r3d.set_scene(ms_render3d::decode(&words)?);         // or build a `Scene` directly
r3d.render(&mut encoder, &target_view, width, height); // shadow passes + MSAA pass resolved into target
queue.submit([encoder.finish()]);
```

- **Shared pipelines.** `Shared3D::get` returns the device's live set (a
  weak per-thread registry, so it is freed with the last renderer holding
  it); `Renderer3D::new` goes through it too. Every renderer on a device then
  shares shader modules, layouts, the DFG LUT, samplers and each pipeline
  (keyed by state and target format), and keeps only its own targets,
  buffers, geometry and texture bindings. `gpu.rs` builds one renderer per
  scene this way.
- **No surface, no device ownership.** `Renderer3D` clones the caller's
  `Device`/`Queue` handles, writes its buffers through `queue.write_buffer`
  during `render`, and records passes into the caller's encoder. Submit that
  encoder before the next `render`.
- **Target.** Any `width` x `height` single-sample view of the format given to
  `new`, with `RENDER_ATTACHMENT`. Use a UNORM format (not `*Srgb`): the
  content is sRGB-encoded and premultiplied, exactly the canvas pixels three
  produces today, and blending must happen on encoded values to match three.
  MSAA colour and depth are internal and sized to the last render.
- **Canvas3D as a layer.** The 2D graph allocates a pooled RGBA8 texture (or
  atlas region view) at today's buffer size, `ceil(size · min(maxPixelRatio ??
  2, max(deviceScale, 1)))`, calls `render` into it in the same encoder before
  the composite that samples it, and composites it like a premultiplied sRGB
  image clipped by the shape's path (decal, stretched onto the bounds, as
  `Canvas3DFillRenderer` does). In linear mode, decode sRGB at sampling. The
  2D `WORK_FORMAT` is `Rgba16Float`, so the 3D output stays an input texture
  and is never the work target itself. There is no 64-px quantization: size it
  exactly. One `Renderer3D` per slot (`nodeId#paintSlot`), or one shared that
  keeps its MSAA targets at the largest size, if memory matters.
- **Textures and Tex.surface (zero copy).** A material's `map` names a texture
  id. The encoder's `TextureTable` gives ids (an image by `src`, data and
  surfaces by descriptor object, per colour space) and lists `pending`
  requests. The host binds each with `Renderer3D::set_texture_view(id, view)`:
  for `Tex.surface`, the view of the 2D layer the source was drawn into, with
  no readback. Use an `*Srgb` view for colour maps (`srgb` in the request) and
  give it mips. `upload_texture(id, rgba, w, h, srgb)` is the copying path
  the test page uses. Sampling is three's: uv transform, `flipY` as `1 - v`,
  clamp/repeat/mirror, linear or nearest, trilinear mips.
- **Retained geometry.** Pass the scene's `GeometryTable` to every
  `encodeScene3D` of one `Renderer3D` (see Retained geometry); the backend
  keeps one per scene image beside its `TextureTable`. Without one, geometry
  is written inline (the r3d test page).

## Findings on the former three.js side

- **First-frame `lookAt` inside a group.** The reconciler runs
  `applyTransform` (and so `Object3D.lookAt`) on a new drawable before
  `parent.add`, so on its first frame the aim ignores the parent's transform
  (`reconciler.ts`, `resolveDrawable`). From the second frame on it is right.
- **Cached values outlive their descriptor.** `applyMaterial` writes only the
  keys present, so a cached material keeps an `opacity` (and the latched
  `transparent`) that a later descriptor leaves unset. A same-signature mesh
  that drops `opacity: 0.5` keeps rendering at 0.5. "Optional means absent"
  would want three's default restored.

## Running it

```
sh scripts/build-wasm-r3d.sh      # the crate's own WASM entry (web/pkg-r3d)
cargo test -p ms-render3d         # native: counts, Euler, lookAt, decoder
```
