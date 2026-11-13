// The curated public surface: published as `@motionscript/sdk`, a one-line passthrough of
// `@motionscript/core/sdk` (this file). A deliberate subset of core's root barrel (`../index.ts`): no
// `Engine`/`Session`/platform seams, no `@internal` descriptor plumbing. Every export is named from its
// declaring sub-barrel, never a wildcard, so nothing internal leaks by accident.

// A lone still or composition is sugar for a one-track project (`asProjectDocument`).
export {
    isProjectDocument,
    asProjectDocument,
    documentDuration,
    commandSpan,
    hasTimeline,
    nodeSpan,
    effectiveSpan,
    untimed,
    ROOT_NODE_ID,
} from '../document';
export type {
    ProjectDocument,
    Track,
} from '../document';
// `resolveProjectDocument`/`placeTracks` live in `../runtime` but are deep-imported from their files: the
// runtime barrel also carries `Engine`/`Session` and is never a source here.
export { resolveProjectDocument } from '../runtime/session';
export { placeTracks } from '../runtime/placement';
export type { TrackSpan } from '../runtime/placement';
export type {
    Theme,
    ColorTokens,
    Typography,
    TypographyPreset,
} from '../project';
export type { NodeTime, AttachScope } from '../components/trees';
export type { BoxBounds, Extents } from '../layout';

export type {
    ImageMeta,
    VideoMeta,
    AudioMeta,
    FontMeta,
    AssetMeta,
    AssetManifest,
} from '../assets';

export {
    validateDocument,
    assertValidDocument,
    // Saved documents carry the format they were written in; these bring one forward, and a host rewriting stored
    // node rows calls `migrateNodeProps`.
    DOCUMENT_FORMAT_VERSION,
    DocumentTooNewError,
    documentFormatVersion,
    migrateDocument,
    migrateNodeProps,
    missingNodeOf,
    // Not a singleton: what a document can name is a property of the registry compiling it.
    Registry,
} from '../document';
// The shader-pack vocabulary lives beside the fill/shader attribute machinery, not in `../document`.
export {
    normalizeShaderPack,
    resolveShaderProperties,
    isKnownShaderProperty,
} from '../attributes';
export type {
    RegistryOptions,
    NodeTypeMap,
    ShaderPackMap,
    NodeTypeRecord,
    NodeCommandEntry,
    VisualDocument,
    ClipDocument,
    StillDocument,
    CompositionDocument,
    AudioDocument,
    NodeSpec,
    TimedNodeSpec,
    NodeSpan,
    CommandSpec,
    EaseSpec,
    LoopSpec,
    LoopDirection,
    VariableSpec,
    ValidationIssue,
    ValidationResult,
    ValidateOptions,
    DocumentChange,
    DocumentMigrationResult,
    PropMigration,
    PropNote,
    MissingNodeInfo,
    NodeConstructor,
    CommandFactory,
    CommandTypeEntry,
    VariableCommandFactory,
    VariableLerp,
    VariableTarget,
} from '../document';
export type {
    Shader,
    FillShader,
    EffectShader,
    ShaderProperty,
    KnownShaderProperty,
    ShaderPropertyValues,
} from '../attributes';

// `expressionOps` carries recognition, parsing and compiling, so a host can lint or rewrite an expression
// without reimplementing the grammar.
export { expressionOps, ExpressionError } from '../document';
export type {
    ParsedExpression,
    ExpressionNode,
    ExpressionDialect,
    VariableResolver,
} from '../document';

// A component is one object literal; behaviour is spread in from modules (`...Paint.state`) and their helpers
// called (`Paint.draw`). See `packages/core/docs/why.md#node-types-are-factory-specs-not-decorated-classes`.
export { component2d } from '../components/factory/component2d';
export { componentAudio } from '../components/factory/component-audio';
export { component3d } from '../components/factory/component3d';
export { commandsFor } from '../components/factory/commands-for';
export { Types } from '../components/factory/types';
export { provides } from '../components/factory/api';
export * as Paint from '../components/modules/paint';
export * as Flow from '../components/modules/flow';
export * as Shapes from '../components/modules/shapes';
export * as Aim from '../components/modules/aim';
// The face text is set in: its entries inherit from the nearest provider.
export * as Typeface from '../components/modules/text-style';
export * as TextLayout from '../components/modules/text-layout';
// A mesh's surface: the material entries, and the mesh drawn with them.
export * as Material from '../components/modules/material';
// A custom 3D node's paint: the 2D `fill` and `stroke` entries, as a material and as lines.
export * as Paint3D from '../components/modules/paint3d';
// A viewport onto 3D children: the default camera and lights, the grid, the render settings.
export * as View3D from '../components/modules/view3d';
export type { Attribute, EntryOptions, NumberOptions, TextOptions } from '../components/factory/types';
export type { StyleGroups, StyleInput, StyleOptions, StyleShape, StyleValues } from '../components/factory/style';
export type {
    Box2DState, BoxAudioState, CallProps, ChildView, Children2D, Component, Element, Entry, InOf, Inputs, Loader,
    Measurer, MergePaint, NodeOf, NodeView, OutOf, Piece, Placement2D, Provided, SoundOptions, StateSpec,
    Timeline, Type, Values, Writes,
    // Named in every component's type, so a package exporting one can declare it.
    Merge, BuiltNode,
    // What `render` is handed; `RenderContext2D` is the renderer's.
    RenderContext2D as RenderContext,
    CallProps3D, Placement3DProps, Transform3DState, Handle, LayoutBox, NodeFrame,
    // What a 3D `render` is handed; `RenderContext3D` is the renderer's.
    RenderContext3D as SceneContext,
} from '../components/factory/api';

// Types only: a node type is a component, never a subclass.
export type { Node, Node2D } from '../components/trees';
export {
    // A clip's root container: layout frame, background paint and camera in
    // one node. Every track builds into one sized to the viewport.
    Canvas2D,
    // Reaching another node by the id a `nodeRef` prop holds, and reading where it sits.
    findNode2D,
    frameIn,
} from '../components/trees';
export { Provider, ThemeProvider } from '../components/builtins/providers/providers';
export type {
    NodeProps,
    Node2DProps,
    // A slot a layout puts each child in beyond its box — see `Node2D._placementOf`.
    ChildPlacement,
    // A parent's own coordinates for its children's `x`/`y` — see `Node2D._planeOf`.
    ChildPlane,
    // A point an editor can drag to set a `Vector2` prop — see `Node2D._handles`.
    NodeHandle,
    Canvas2DProps,
    NodeConfig,
    NodeChildren,
    NodeDimension,
} from '../components/trees';
export type { ProviderProps, ThemeProviderProps } from '../components/builtins/providers/providers';

export {
    Rect,
    Ellipse,
    Path,
    // The document's `"path"`: its `data` is in the unit space of its own box,
    // where `Path` draws its `d` at face value.
    PathShape,
    Polygon,
    Polygram,
    Triangle,
    RightTriangle,
    Pentagon,
    Hexagon,
    Octagon,
    Star,
} from '../components/builtins/geometry/geometry';
export { BooleanGroup, MaskGroup } from '../components/builtins/geometry/composite';
export type {
    PaintProps,
    ShapeProps,
    RectProps,
    FlexSize,
    EllipseProps,
    PathProps,
    PathShapeProps,
    PolygonProps,
    PolygramProps,
} from '../components/builtins/geometry/geometry';
export type { BooleanGroupProps, MaskGroupProps } from '../components/builtins/geometry/composite';
// The operation/mode vocabularies behind `Boolean`/`Mask` are attribute types,
// not node-prop types.
export type {
    BooleanOperation,
    MaskMode,
    MaskOptions,
} from '../attributes';

export {
    Camera,
    // The stage's 2.5D camera for one subtree: its children orbited in depth.
    OrbitCamera,
    RotatedBox,
} from '../components/builtins/layout/layout';
export type {
    CameraProps,
    OrbitCameraProps,
} from '../components/builtins/layout/layout';

export { Text, RichText, NumberNode, DefaultTextStyle } from '../components/builtins/text/text';
export type {
    TextProps,
    RichTextProps,
    NumberProps,
    NumberFormat,
    DefaultTextStyleProps,
} from '../components/builtins/text/text';
export { textOps } from '../attributes';
export type {
    TextStyle,
    TextAlign,
    VerticalAlign,
    TextDecoration,
    TextCase,
    TextSpan,
    TextRun,
    FontStyle,
} from '../attributes';

export { Video } from '../components/builtins/media/media';
export type {
    VideoProps,
    VideoSegment,
} from '../components/builtins/media/media';

// Levels are `Param`, so a fade is a ramp or transition rather than a `to()`: sound is scheduled once, ahead
// of time.
export type { NodeAudio } from '../components/trees';
export { AudioBus, SoundNode } from '../components/builtins/audio/audio';
export {
    Sound,
    AudioEffects,
    ramp,
    hold,
    isRamp,
} from '../attributes';
export type {
    NodeAudioProps,
} from '../components/trees';
export type { AudioBusProps, SoundNodeProps } from '../components/builtins/audio/audio';
export type {
    SoundProps,
    AudioRequest,
    AudioBusStop,
    AudioEffect,
    AudioEffectsInput,
    AudioTransition,
    Param,
    Ramp,
    RampKey,
} from '../attributes';

// One 3D node; everything inside it is described with `Graphics3D`. `Surface2D` is the 2D to 3D bridge: a
// child of `Canvas3D` whose 2D content is rasterized offscreen and bound to a material by `Tex.surface(name)`.
export { Canvas3D } from '../components/builtins/three/canvas3d';
export type { Node3D } from '../components/trees';
// The 3D scene graph: components, each placed by its transform.
export {
    Group3D,
    Mesh3D,
    Box3D, Sphere3D, Plane3D, Cylinder3D, Cone3D, Torus3D, TorusKnot3D,
    Circle3D, Ring3D, Capsule3D, Polyhedron3D, Extrude3D, Lathe3D, Tube3D,
    Instances3D, Points3D, Line3D, Sprite3D, Model3D,
    AmbientLight3D, HemisphereLight3D, DirectionalLight3D,
    PointLight3D, SpotLight3D, AreaLight3D,
    Camera3D,
    Fog3D, Environment3D,
} from '../components/builtins/three/three';
export {
    Graphics3D,
    Scene3D,
    RenderContext3D,
    Geo,
    Mat,
    Tex,
    lerpVector3,
    lerpEuler3,
    slerpQuaternion,
    quaternionFromEuler,
    normalizeQuaternion,
    resolveVector3,
    evaluateParametric,
    evaluateRoundedBox,
    resolveSurfaceSource,
    resolveFill3D,
    segmentsOf,
    resolveCameraPlacement,
    resolveShadows3D,
    shadowCasts,
    shadowReceives,
} from '../render3d';
export type { Canvas3DProps } from '../components/builtins/three/canvas3d';
export type {
    // A 3D parent's own coordinates for its children's position: see `Node3D._spaceOf`.
    ChildSpace3D,
    Node3DProps,
} from '../components/trees';
export type {
    Group3DProps, Mesh3DProps, Material3DProps,
    Box3DProps, Sphere3DProps, Plane3DProps, Cylinder3DProps, Cone3DProps,
    Torus3DProps, TorusKnot3DProps, Circle3DProps, Ring3DProps, Capsule3DProps,
    Polyhedron3DProps, Extrude3DProps, Lathe3DProps, Tube3DProps,
    Instances3DProps, Points3DProps, Line3DProps, Sprite3DProps, Model3DProps,
    AmbientLight3DProps, HemisphereLight3DProps, DirectionalLight3DProps,
    PointLight3DProps, SpotLight3DProps, AreaLight3DProps,
    Camera3DProps,
    Fog3DProps, Environment3DProps,
} from '../components/builtins/three/three';
export type {
    Node3DRenderState,
    Graphics3DOp,
    Scene3DOp,
    Vector3,
    Vector3Input,
    Euler3,
    EulerOrder,
    Quaternion,
    Transform3D,
    Shadow3D,
    ShadowOptions3D,
    Faces3D,
    Blend3D,
    Shading3D,
    Segments3D,
    Sweep3D,
    Bevel3D,
    Fill3D,
    Geometry3D,
    BufferGeometry3D,
    Material3D,
    MaterialCommon3D,
    MeshShorthand3D,
    // What `Mesh3D.materialShorthand()` returns: a mesh node of your own overrides it.
    MaterialShorthand3D,
    Uniform3D,
    Texture3D,
    TextureOptions3D,
    SurfaceTexture3D,
    SurfaceSource3D,
    ResolvedSurfaceSource,
    LightData3D,
    CameraData3D,
    FogData3D,
    EnvironmentData3D,
    Shadows3D,
    ShadowSettings3D,
    ToneMapping3D,
    ToneSettings3D,
    PostEffect3D,
    LineMode3D,
    LineStroke3D,
    ModelAnimation3D,
} from '../render3d';

export {
    Graphics2D,
    PathBuilder,
    Clip,
    toPathString,
} from '../render';
export type {
    RenderContext2D,
    RenderPass2D,
    MeasureContext2D,
    TextBlockSource,
    // One recorded entry of `Graphics2D.ops()`.
    GraphicsOp,
    PathData,
    PathCommand,
    PathBounds,
    EllipseArc,
} from '../render';
// What a node's `declareAssets` declares into, and the async load a `loader` takes.
export type { AssetScope, LoaderFn } from '../assets';

export {
    Fills,
    parseColor,
    resolveFill,
    fillOps,
    colorOps,
} from '../attributes';
export type {
    Fill,
    FillChain,
    FillOptions,
    VideoFillOptions,
    // Placement of an image/video source inside the shape it paints:
    // `crop` -> `fit` -> `zoom` -> `anchor`, plus the raw-matrix escape hatch.
    MediaPlacementOptions,
    ImageFit,
    ImageCrop,
    ImageMatrix,
    FillResolved,
    // A custom WGSL shader as a fill. Uniforms are keyed by their declared
    // name, and a `ShaderTexture` is an image it samples.
    ShaderFillProp,
    ShaderFillResolved,
    ShaderTexture,
    ShaderUniformRecord,
    FractalNoiseBasis,
    // The colour type every fill, stroke, shadow and 3D material accepts —
    // a CSS string (incl. `oklch()`, theme tokens, `"white/10"`) or a
    // pre-normalized RGBA tuple.
    Color,
    NormalizedColor,
    BlendMode,
    FillSpace,
} from '../attributes';

export {
    resolveStroke,
    strokeOps,
    resolveShadow,
    shadowOps,
    resolveCorners,
    cornerRadiusOps,
    cornerStyleOps,
    // Parsing, measuring, sampling, trimming and morphing a path, and the
    // anchor model (`VectorPath`) a pen tool edits.
    pathOps,
} from '../attributes';
export type {
    PathSampler,
    PathAnchor,
    PathSubpath,
    VectorPath,
    Stroke,
    StrokeProp,
    StrokeAlign,
    StrokeCap,
    StrokeMarker,
    StrokeEnd,
    StrokeJoin,
    StrokeResolved,
    Shadow,
    ShadowProp,
    ShadowResolved,
    Corners,
    CornerStyle,
    CornerStyleResolved,
    CornerRadiusResolved,
    // What a rect's `cornerRadius` and `cornerStyle` take, before they resolve.
    RectCornerRadius,
    RectCornerStyle,
    NodeEffect,
} from '../attributes';

// `flowOps` is the layout a container runs on its children, as plain data in and boxes out, so a custom node
// can lay out what it draws the same way.
export {
    lerpVector2,
    sizeInputOps,
    insetsOps,
    alignmentOps,
} from '../attributes';
// `flowOps` itself is the layout package's, not the attribute layer's —
// `../attributes`'s own `./layout` only carries Vector2/Size2D/Insets/Alignment.
export { flowOps } from '../layout';
export type {
    Vector2,
    Size2D,
    Insets,
    // What a `padding`-style prop accepts, before `insetsOps` resolves it.
    InsetsProps,
    InsetsResolved,
    AlignmentKey,
    Alignment,
} from '../attributes';
export type {
    FlowMode,
    GapSize,
    FlowResolved,
    FlowProps,
    FlowSettings,
    LayoutItem,
    FlowSpace,
    FlowMeasure,
    FlowLine,
    // What an overriding `measure(constraints, scope)` is handed.
    SizeConstraints,
} from '../layout';

// `space3dOps` is the camera's own projection, for a host drawing over the picture rather than keeping a copy.
// `SpaceCamera` is what a node returns from `_spaceCamera()` to open a 2.5D space.
export { space3dOps } from '../attributes/layout/space3d';
export type { LookAt, SpaceCamera, SpaceCameraProps, SpacePoint } from '../attributes/layout/space3d';

// `describeEffect`/`effectDescriptors` describe each built-in effect's fields as plain JSON, so a host builds
// its effect UI from the engine.
export { describeEffect, effectDescriptors } from '../attributes';
export type {
    EffectDescriptor,
    EffectParamDescriptor,
    EffectParamKind,
    EffectParamUnit,
    EffectParamControl,
    EffectGroup,
    EffectJson,
} from '../attributes';
export {
    Effects,
    EffectChain,
    Adjustments,
    VideoAdjustments,
    AdjustmentChain,
    VideoAdjustmentChain,
} from '../attributes';

export type {
    /** The `effects` prop type — what a node actually accepts. */
    Effect,
    EffectMode,
    EffectAxis,
    EffectSurface,
    EffectOptions,
    /** What an image fill's `preset.adjustments` accepts — one, a list, or a chain. */
    ImageAdjustment,
    VideoAdjustment,
    /** The node effects that also work as a media adjustment — see {@link Adjustments}. */
    EffectAdjustment,
    MediaAdjustment,
    VideoOnlyAdjustment,
} from '../attributes';

/**
 * Per-builder options. Every effect builder takes exactly one argument: one of
 * these, or the dominant scalar it wraps.
 */
export type {
    BlurOptions,
    DirectionalBlurOptions,
    GrayscaleOptions,
    PixelateOptions,
    BulgeOptions,
    MagnifyOptions,
    BloomOptions,
    VintageOptions,
    ChromaticAberrationOptions,
    InvertOptions,
    ScatterOptions,
    PosterizeOptions,
    MotionBlurOptions,
    ShaderEffectOptions,
    OutlineOptions,
    VignetteOptions,
    GrainOptions,
    SharpenOptions,
    EdgesOptions,
    ThresholdOptions,
    RadialBlurOptions,
    HalftoneOptions,
    DitherOptions,
    DuotoneOptions,
    CurvesOptions,
    ColorAdjustmentOptions,
    RgbShiftOptions,
    ScanlinesOptions,
    BlockDisplaceOptions,
    BitCrushOptions,
    AsciiOptions,
    StreakOptions,
    GlowOptions,
    OilPaintOptions,
    WaveOptions,
    TwirlOptions,
    ProgressiveBlurOptions,
    KaleidoscopeOptions,
    GlassOptions,
    LutOptions,
} from '../attributes';

/**
 * Per-builder options for the filters that exist only as filters. Everything
 * else on {@link Adjustments} takes the matching effect options above, minus
 * `mode` — a filter is on the fill's own pixels, so there is no backdrop to
 * point it at.
 */
export type {
    BlurFilterOptions,
    GrayscaleFilterOptions,
    AlphaFilterOptions,
    ExposureFilterOptions,
    ColorMatrixFilterOptions,
    CurvesFilterOptions,
    ColorAdjustmentFilterOptions,
    PosterizeTimeFilterOptions,
    VideoEchoFilterOptions,
} from '../attributes';

/** Effect data types, for naming an effect value or building one by hand. */
export type {
    BlurEffect,
    DirectionalBlurEffect,
    GrayscaleEffect,
    PixelateEffect,
    BulgeEffect,
    MagnifyEffect,
    BloomEffect,
    VintageEffect,
    ChromaticAberrationEffect,
    InvertEffect,
    InvertChannel,
    ScatterEffect,
    PosterizeEffect,
    MotionBlurEffect,
    MotionBlurAlignment,
    ShaderEffect,
    ShaderUniform,
    ShaderUniformValue,
    OutlineEffect,
    OutlinePosition,
    VignetteEffect,
    GrainEffect,
    SharpenEffect,
    EdgesEffect,
    EdgeKernel,
    ThresholdEffect,
    RadialBlurEffect,
    RadialBlurStyle,
    HalftoneEffect,
    HalftoneShape,
    HalftoneSeparation,
    DitherEffect,
    DitherMatrix,
    DuotoneEffect,
    CurvesEffect,
    ColorAdjustmentEffect,
    RgbShiftEffect,
    ScanlinesEffect,
    BlockDisplaceEffect,
    BitCrushEffect,
    BitCrushPalette,
    AsciiEffect,
    AsciiCharset,
    StreakEffect,
    GlowEffect,
    GlowChannel,
    GlowLoopStyle,
    GlowOriginal,
    GlowTint,
    OilPaintEffect,
    WaveEffect,
    WaveShape,
    TwirlEffect,
    ProgressiveBlurEffect,
    ProgressiveBlurShape,
    KaleidoscopeEffect,
    GlassEffect,
    LutEffect,
} from '../attributes';

export {
    lerpNumber,
} from '../tween';
export type {
    AnimationTarget,
    Steppable,
    TweenStepper,
    LerpFunction,
    TweenOptions,
} from '../tween';

// An animation as a value: a declared duration plus `at(t)`, so a host can ask what it looks like at a time
// instead of running it to one. A component's `commands` return one. One command shape, always: `node.to(a,
// 1)` is a single command, not a builder; sequencing is by timeline placement.
export {
    getCommandMeta,
    isCommand,
    makeCommand,
    commandSequence,
    commandParallel,
    loopCommand,
} from '../tween';
export type { Command, CommandArgs, CommandMeta, CommandOptions } from '../tween';

export {
    linear,
    easeIn,
    easeOut,
    easeInOut
} from '../tween';
export type {
    EasingFunction,
    EaseParams,
    StandardEase
} from '../tween';

export {
    createRef,
    clamp,
    generateList,
    createContext,
    ContextMap,
    Random,
    SeedGenerator,
    parseCSV,
    parseData,
} from '../util';
export type {
    Reference,
    RefTarget,
    Context,
    DataRecord,
    ParseCSVOptions,
} from '../util';

// Pure functions over a scene's node tree, in viewport space (origin at the viewport centre, y-up); a player
// embedding reaches the same through `useMotionPlayer`. They live in `../runtime` but are deep-imported from
// their files, never the runtime barrel.
export { nodeTypeIsA, parentIssue, placementIssues, siblingIssue } from '../document/placement';
export type { PlacementIssue, PlacementOptions } from '../document/placement';

export {
    nodeBox,
    pickNode,
    collectBoxes,
    parentPlanePointAt,
    childPlanePointAt,
    reparentPlacementAt,
    nodeHandlesAt,
    handleValueAt,
} from '../runtime/node-picking';
export type {
    NodeBox,
    ReparentPlacement,
} from '../runtime/node-picking';
export type {
    NodeOverride,
} from '../runtime/playback-controller';
export type {
    TreeState,
} from '../project';
