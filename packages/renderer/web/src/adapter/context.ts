// The engine's RenderContext2D, recorded into a retained Doc each frame. A
// canvas state machine: begin/end = save/restore around a node, transform() concatenates into the
// node's group, a non pass-through blend isolates a layer, and opacity is
// otherwise a world alpha multiplied into every paint.

import {
    alignmentOps, AUTOFIT_PROBE_SIZE, forEachTexture3D, isStrokeMarker, isSurfaceTexture3D, resolveSurfaceSource, resolveVideoTimestamp, withRichTextDescriptor,
    type Alignment, type BooleanOperation, CanvasRenderContext2D, type Clip, type FillResolved, fillOps, type FontStyle, type Graphics2D,
    type MaskOptions, type NodeRenderState, type RenderContext2D, type RenderIssue, type ShadowResolved, shadowOps, type Size2D, type StrokeResolved, strokeOps,
    type TextSegment, type TransformState, type Vector2,
} from "@motionscript/core";
import { BLEND_MODES, type BlendMode, Doc, type ImageAsset, isProjective, type Mat, type Member, type MemberOp, mulX, type Node, type Paint, PathBuilder, type PathData, pathBounds, type Shadow, type TextRunSpec, type TextSpec, transformPath, type Xform } from "../doc";
import { assetKey } from "./driver";
import { fillPaint, shadowOf } from "./paint";
import { shaderParamIssues } from "./shader-params";
import { isClosed, reversePath, signedArea } from "./path-measure";
import { type NativeShape, shapeOf, type ShapeOut, textOf, type TextOut } from "./shapes";
import { resolveMotionBlur, SAMPLE_THRESHOLD } from "./geometry/motion-blur";
import { endBox, endDisc, markerInset, markerPath, type PathEnd, strokePlan, type StrokePlan } from "./stroke-ends";

type Measure = (text: string, size: number, family: string, weight: number, letterSpacing: number, style: FontStyle | undefined) => Size2D;

function merge(paths: PathData[]): PathData {
    if (paths.length === 1) return paths[0];
    const verbs = new Uint8Array(paths.reduce((n, p) => n + p.verbs.length, 0));
    const points = new Float32Array(paths.reduce((n, p) => n + p.points.length, 0));
    let v = 0, q = 0;
    for (const p of paths) {
        verbs.set(p.verbs, v); v += p.verbs.length;
        points.set(p.points, q); q += p.points.length;
    }
    return { verbs, points };
}

type Bounds = [number, number, number, number];

/** The kinds the adapter could not draw this frame, and the nodes each was found on. */
export class MissingKinds extends Set<string> {
    readonly nodes = new Map<string, Set<string>>();

    constructor(private readonly node: () => string | undefined) {
        super();
    }

    override add(kind: string): this {
        super.add(kind);
        const id = this.node?.();
        if (id !== undefined) {
            let at = this.nodes.get(kind);
            if (!at) this.nodes.set(kind, (at = new Set()));
            at.add(id);
        }
        return this;
    }

    override clear(): void {
        super.clear();
        this.nodes.clear();
    }
}

const SHAPE_OPS = new Set(["rect", "ellipse", "path", "line", "polygon", "polygram", "text", "richText"]);
type LeafProps = Parameters<Doc["pathNode"]>[1];

const isSolid = (f: unknown) => (f as { type?: string }).type === "solid";

/** `box` grown by `d` (shrunk when negative), each rounded corner with it; null where that is no longer the offset outline. */
function offsetBox(box: NativeShape, d: number): NativeShape | null {
    if (d === 0) return box;
    const w = box.w + 2 * d, h = box.h + 2 * d;
    if (!(w > 0 && h > 0)) return null;
    if (box.kind === "ellipse") return { ...box, x: box.x - d, y: box.y - d, w, h };
    if (box.radii.some((r) => r > 0 && !(r + d > 0))) return null;
    return { ...box, x: box.x - d, y: box.y - d, w, h, radii: box.radii.map((r) => (r > 0 ? r + d : 0)) as NativeShape["radii"] };
}

/** What a paint covers: one path, or a compound's members (a boolean result). */
type Geom = { path: PathData } | { members: Member[] };

const BLACK: Paint = { kind: "solid", color: [0, 0, 0, 1] };
const CLEAR: Paint = { kind: "solid", color: [0, 0, 0, 0] };

/** A text block's box, centred on its node's origin: the space its paints resolve in. */
const textBox = (t: TextOut): Bounds => [-t.size[0] / 2, -t.size[1] / 2, t.size[0] / 2, t.size[1] / 2];

/** Strokes that draw as one text node: the k-th of their pieces, alike in everything but paint. */
const strokeKey = (k: number, st: StrokeResolved) => `${k}|${st.weight}|${st.align}|${st.join}|${st.cap}|${st.miterLimit}|${st.dash}|${st.dashOffset}`;
const BOOLEAN_OP: Record<BooleanOperation, MemberOp> = { union: "union", subtract: "cut", intersect: "intersect", exclude: "exclude" };

/** A compound's result bounds, as its members fold: unions grow, intersections shrink, cuts keep. */
function membersBounds(members: Member[]): Bounds | null {
    let acc: Bounds | null = null;
    for (const m of members) {
        const b = pathBounds(m.path!);
        const op = m.op ?? "union";
        if (!acc) {
            if (op === "union" || op === "exclude") acc = b;
        } else if (op === "union" || op === "exclude") {
            acc = [Math.min(acc[0], b[0]), Math.min(acc[1], b[1]), Math.max(acc[2], b[2]), Math.max(acc[3], b[3])];
        } else if (op === "intersect") {
            acc = [Math.max(acc[0], b[0]), Math.max(acc[1], b[1]), Math.min(acc[2], b[2]), Math.min(acc[3], b[3])];
            if (acc[2] < acc[0] || acc[3] < acc[1]) acc = [acc[0], acc[1], acc[0], acc[1]];
        }
    }
    return acc;
}

function invert(m: Xform): Mat | null {
    const det = m[0] * m[3] - m[1] * m[2];
    if (!det) return null;
    const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
    return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

let sceneVersion = 1 << 20;

/** core's kebab-case blend names to the doc's ("color-dodge" → "colorDodge"). */
function docBlend(b: string): BlendMode | null {
    const camel = (b === "plus-lighter" ? "plus" : b).replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
    return BLEND_MODES.includes(camel as BlendMode) ? (camel as BlendMode) : null;
}
// An image's version is its bitmap's: what the storage hands back for a source
// can change (a video's nearest decoded frame, then the exact one; an SVG
// rasterized again at a larger size).
const frameVersions = new WeakMap<object, number>();
let nextFrameVersion = 1 << 24;
function frameVersion(frame: object): number {
    let v = frameVersions.get(frame);
    if (v === undefined) frameVersions.set(frame, (v = nextFrameVersion++));
    return v;
}

/** Decoded video frames by source and time (a storage adapter's). */
export interface VideoFrames {
    videos: Map<string, { duration: number }>;
    /** The frame of `src` at `time` s, or null (queued for warmPendingDecodes). */
    videoFrame(src: string, time: number): ImageBitmap | null;
    /** A draw of image `src` `edge` device px along its long side. */
    wantImageEdge?(src: string, edge: number): void;
}

interface Scope {
    /** Groups this node opened (popped on end). */
    groups: number;
    worldAlpha: number;
}

export class WgpuRenderContext extends CanvasRenderContext2D {
    override readonly readsSpaceRects = true;
    override readonly drawsVisibleOnly = true;
    pixelRatio = 1;
    doc!: Doc;
    /** What scenes asked for that the adapter doesn't draw yet (by kind, and the nodes it was on). */
    readonly missing = new MissingKinds(() => this.currentNodeStack[this.currentNodeStack.length - 1]);
    /** This frame's WGSL shaders whose uniforms and `Params` disagree, on their nodes. */
    readonly shaderIssues: RenderIssue[] = [];
    /** The frame's storage adapter (video frames). */
    storage: VideoFrames | null = null;
    /** Decoded images by asset key (the storage adapter fills it). */
    images = new Map<string, import("./driver").Decoded>();
    private frameImages = new Map<string, import("../doc").ImageAsset>();
    private assets = {
        image: (src: string) => this.image(src),
        scene3d: (scene: unknown, w: number, h: number, ratio: number) => {
            // Its textures: images from the frame's image assets (resolved as the
            // backend asks), surfaces drawn by this context into detached subtrees.
            const surfaces = new Map<object, ImageAsset>();
            forEachTexture3D(scene as never, (t: any) => {
                if (isSurfaceTexture3D(t) && !surfaces.has(t)) {
                    const asset = this.surfaceOf(t);
                    if (asset) surfaces.set(t, asset);
                }
            });
            const images = new Proxy({} as Record<string, ImageAsset>, { get: (_, src) => (typeof src === "string" ? this.image(src) ?? undefined : undefined) });
            const a = this.doc.addScene3D(scene as never, w, h, { images, surfaces });
            a.scale3d = ratio;
            // A scene is redrawn whenever it is handed over (it may animate).
            a.version = ++sceneVersion;
            return a;
        },
        video: (fill: any, at?: number) => {
            const storage = this.storage;
            const time = at ?? this.videoTime(fill);
            if (!storage || time === null) return null;
            const frame = storage.videoFrame(fill.src, time);
            if (!frame) return null;
            const key = `${assetKey(fill.src)}@${time.toFixed(6)}`;
            let a = this.frameImages.get(key);
            if (!a) {
                a = this.doc.addImage(frame, frame.width, frame.height, { mipmaps: false });
                a.version = frameVersion(frame);
                this.frameImages.set(key, a);
            }
            return a;
        },
        imageEdge: (src: string, edge: number) => this.storage?.wantImageEdge?.(src, edge),
        deviceScale: () => {
            const m = this.device();
            return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
        },
        time: () => this.elapsed(),
        checkShader: (fill: unknown) => this.checkShader("fill", fill),
    };
    private image = (raw: string) => {
        const src = assetKey(raw);
        let a = this.frameImages.get(src);
        if (a) return a;
        const d = this.images.get(src);
        if (!d) return null;
        a = this.doc.addImage(d.bitmap, d.width, d.height);
        // Ids restart with every frame's doc; a version unique to the bitmap
        // keeps the backend from reusing another image's upload under an id,
        // or an image's earlier raster (a vector rasterized again, sharper).
        a.version = frameVersion(d.bitmap);
        this.frameImages.set(src, a);
        return a;
    };
    private stack: Node[] = [];
    private scopes: Scope[] = [];
    private worldAlpha = 1;
    // The current surface: shapes chained before a paint, as ShapeHandler.
    private shapes: ShapeOut[] = [];
    private painted = false;
    private shadows: ShadowResolved[] = [];

    constructor(protected width: number, protected height: number, private measure: Measure) {
        super();
    }

    private get cur(): Node {
        return this.stack[this.stack.length - 1];
    }

    measureText(text: string, fontSize: number, fontFamily: string, fontWeight = 400, letterSpacing = 0, fontStyle?: FontStyle): Size2D {
        return this.measure(text, fontSize, fontFamily, fontWeight, letterSpacing, fontStyle);
    }

    execute(callback: () => void): void {
        // executePass: cleared black, origin at the centre (the backend applies
        // the pixel ratio by scaling the doc to the canvas).
        this.doc = new Doc(this.width, this.height, this.clearColor());
        this.frameImages.clear();
        // Only the settled pass counts (earlier passes wait on decodes).
        this.missing.clear();
        this.shaderIssues.length = 0;
        const root = this.doc.group(this.doc.root, { transform: this.rootTransform() });
        const frame = this.frameGroup(root);
        this.stack = frame === root ? [root] : [root, frame];
        this.scopes = [];
        this.worldAlpha = 1;
        this.masks = [];
        this.cameras = [];
        this.clips = [];
        this.booleans = [];
        this.resetSurface();
        callback();
    }

    /** Where the scene's origin sits in the doc: its centre, as executePass. */
    protected rootTransform(): Xform {
        return [1, 0, 0, 1, this.width / 2, this.height / 2];
    }

    protected clearColor(): [number, number, number, number] {
        return [0, 0, 0, 1];
    }

    /** The group the scene draws into under the root (a host's frame clip). */
    protected frameGroup(root: Node): Node {
        return root;
    }

    screenshot(): string | undefined {
        return undefined;
    }

    unmount(): void {}

    override begin(state: NodeRenderState): void {
        super.begin(state);
        this.scopes.push({ groups: 1, worldAlpha: this.worldAlpha });
        this.stack.push(this.doc.group(this.cur));
        this.resetSurface();
    }

    override end(): void {
        const s = this.scopes.pop();
        if (s) {
            for (let i = 0; i < s.groups; i++) this.stack.pop();
            this.worldAlpha = s.worldAlpha;
        }
        super.end();
    }

    transform(state: Partial<TransformState>): RenderContext2D {
        const x = state.x ?? 0, y = state.y ?? 0, w = state.width ?? 0, h = state.height ?? 0;
        const opacity = state.opacity ?? 1;
        const blend = state.blend ?? "pass-through";
        let m: Xform;
        const matrix = state.matrix;
        // A 2.5D node's matrix can carry a perspective row (g h i).
        if (matrix) m = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f, matrix.g ?? 0, matrix.h ?? 0, matrix.i ?? 1];
        else {
            const pivot = state.pivot ?? { x: 0, y: 0 };
            const px = pivot.x * (w / 2), py = -pivot.y * (h / 2);
            const r = ((state.rotation ?? 0) * Math.PI) / 180, s = state.scale ?? 1;
            const c = Math.cos(r) * s, sn = Math.sin(r) * s;
            m = [c, sn, -sn, c, x + px - (c * px - sn * py), y + py - (sn * px + c * py)];
        }
        const g = this.cur;
        g.transform = mulX(g.transform, isProjective(m) ? m : m.slice(0, 6) as Mat);
        // Node effects ride the node's layer (transform composes the filters,
        // beginEffects("foreground") captures for the shader ones); the doc's
        // group takes both, shader effects first, as the engine orders them.
        // Backdrop ones arrive through beginEffects("backdrop").
        const fx = this.motionBlur((state.effects ?? []).filter((e) => e.mode !== "backdrop"));
        for (const e of fx) if (e.type === "shader") this.checkShader("effect", e);
        if (fx.length) {
            g.effects = fx;
            g.effectBox = [-w / 2, -h / 2, w, h];
            g.effectTime = this.elapsed();
        }
        if (blend !== "pass-through") {
            const mode = docBlend(blend);
            if (!mode) this.missing.add(`blend:${blend}`);
            this.stack.push(this.doc.group(g, { opacity: this.worldAlpha * (opacity < 1 ? opacity : 1), blend: mode ?? "normal" }));
            this.scopes[this.scopes.length - 1].groups++;
            this.worldAlpha = 1;
        } else if (opacity < 1) this.worldAlpha *= opacity;
        return this;
    }

    private resetSurface() {
        this.shapes = [];
        this.painted = false;
        this.shadows = [];
    }

    protected drawGraphics(graphics: Graphics2D): void {
        const prevAlpha = this.worldAlpha;
        const g = graphics as any;
        if (g.needsGroupLayer?.()) {
            const o = g.groupOpacity();
            if (o < 1) this.worldAlpha *= o;
        }
        // Graphics-level rotation/scale turns the whole union about its pivot
        // (default: the union's centre), wrapping the replay.
        const turn = g.groupTransform?.();
        let turned: Node | null = null;
        if (turn) {
            const { x: cx, y: cy } = this.groupCenter(graphics, turn.center);
            const r = (turn.rotation * Math.PI) / 180, c = Math.cos(r) * turn.scale, s = Math.sin(r) * turn.scale;
            turned = this.doc.group(this.cur, { transform: [c, s, -s, c, cx - (c * cx - s * cy), cy - (s * cx + c * cy)] });
            this.stack.push(turned);
        }
        const ops = graphics.ops() as any[];
        const segments = this.effectSegments(ops);
        let segment: Node | null = null;
        for (let i = 0; i < ops.length; i++) {
            const op = ops[i];
            // An effects op filters its shape group: a layer opened at the
            // group's first op, closed at the effects op.
            const fx = segments.get(i);
            if (fx) {
                segment = this.doc.group(this.cur, { effects: fx, effectBox: this.viewportBox(), effectTime: this.elapsed() });
                this.stack.push(segment);
            }
            switch (op.kind) {
                case "rect": case "ellipse": case "polygon": case "polygram": case "line": case "path": {
                    if (this.painted) this.resetSurface();
                    const shape = shapeOf(op);
                    if (!shape) break;
                    if (this.booleans.length) this.collect(shape);
                    else this.shapes.push(shape);
                    break;
                }
                case "cut": this.cut(); break;
                case "richText": {
                    if (this.painted) this.resetSurface();
                    this.richText(op.state);
                    break;
                }
                case "text": {
                    if (this.painted) this.resetSurface();
                    const text = textOf(op.state, (spec) => {
                        const r = spec.runs[0];
                        const m = this.measureText(r.text, r.size, r.family, r.weight, r.letterSpacing, r.italic ? "italic" : "normal");
                        return [m.width, m.height];
                    });
                    const segments: TextSegment[] | undefined = op.state.segments;
                    if (text && segments?.length && !text.spec.path) {
                        this.paintSegments(text, segments);
                    } else if (text) {
                        const [w, h] = text.size, x = text.transform[4], y = text.transform[5];
                        this.shapes.push({ fill: null, stroke: null, interior: null, bounds: [x - w / 2, y - h / 2, x + w / 2, y + h / 2], text });
                    } else this.missing.add("text:path");
                    break;
                }
                case "fill": this.fill(fillOps.resolve(op.fills)); break;
                case "stroke": this.stroke(strokeOps.resolve(op.strokes)); break;
                case "shadow": this.shadows = shadowOps.resolve(op.shadows); break;
                case "effects":
                    if (segment) {
                        this.stack.splice(this.stack.lastIndexOf(segment));
                        segment = null;
                    }
                    this.resetSurface();
                    break;
                case "mask": this.beginMask(op.options); break;
                case "applyMask": this.applyMask(); break;
                case "endMask": this.endMask(); break;
                default: this.missing.add(`op:${op.kind}`);
            }
        }
        // Unwound to where this draw began (an unterminated segment included).
        const first = turned ?? segment;
        if (first) this.stack.splice(this.stack.lastIndexOf(first));
        this.worldAlpha = prevAlpha;
    }

    /** RenderContext's buildEffectSegments: each effects op's foreground effects
     *  by the index of the first op of the shape group it filters. */
    private effectSegments(ops: any[]): Map<number, object[]> {
        const segments = new Map<number, object[]>();
        let groupStart = 0, painted = false;
        ops.forEach((op, i) => {
            if (SHAPE_OPS.has(op.kind)) {
                if (painted) {
                    groupStart = i;
                    painted = false;
                }
            } else if (op.kind === "fill" || op.kind === "stroke" || op.kind === "shadow") {
                painted = true;
            } else if (op.kind === "effects") {
                const fx = this.motionBlur((op.effects as any[]).filter((e) => e.mode !== "backdrop"));
                if (fx.length) segments.set(groupStart, fx);
                groupStart = i + 1;
                painted = false;
            }
        });
        return segments;
    }

    /** Motion blur resolved against the node's velocity into a directional blur. */
    private motionBlur<E extends { type: string }>(effects: E[]): E[] {
        if (!effects.some((e) => e.type === "motionBlur")) return effects;
        const rs = this.currentRenderState();
        return effects.flatMap((e) => {
            if (e.type !== "motionBlur") return [e];
            const r = rs ? resolveMotionBlur(e as never, rs.velocity, rs.dt) : null;
            if (!r) return [];
            // An off-centre shutter shifts the smear; many samples step it.
            if (r.phase !== 0 || Math.round(r.samples) > SAMPLE_THRESHOLD) this.missing.add("effect:motionBlur-shutter");
            return [{ type: "directionalBlur", radius: r.radius, angle: r.angle } as unknown as E];
        });
    }

    /** resolveGroupCenter: an explicit point as is, else a point of the shapes' union box. */
    private groupCenter(graphics: Graphics2D, center: Alignment | undefined): Vector2 {
        if (center !== undefined && typeof center !== "string") return { x: center.x, y: center.y };
        let b: Bounds | null = null;
        for (const op of graphics.ops() as any[]) {
            const p = SHAPE_OPS.has(op.kind) && op.kind !== "text" && op.kind !== "richText" ? shapeOf(op)?.fill : null;
            if (!p || !p.verbs.length) continue;
            const pb = pathBounds(p);
            b = b ? [Math.min(b[0], pb[0]), Math.min(b[1], pb[1]), Math.max(b[2], pb[2]), Math.max(b[3], pb[3])] : pb;
        }
        if (!b) return { x: 0, y: 0 };
        const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        if (center === undefined) return { x: cx, y: cy };
        const a = alignmentOps.resolve(center);
        return { x: cx + a.x * ((b[2] - b[0]) / 2), y: cy - a.y * ((b[3] - b[1]) / 2) };
    }

    /** The viewport in local units (x, y, w, h): what effects on a graphics
     *  group measure against. */
    private viewportBox(): [number, number, number, number] {
        const [l, t, r, b] = this.spaceBounds({ space: "global" }, [0, 0, 0, 0]);
        return [l, t, r - l, b - t];
    }

    /** The surface's paths of one kind, merged; its gradient bounds. */
    private surface(kind: "fill" | "stroke" | "interior"): PathData | null {
        let paths = this.shapes.map((s) => s[kind]).filter((p): p is PathData => !!p && p.verbs.length > 0);
        // Shapes fill one by one; one non-zero path of them all needs them
        // wound alike, or an overlap where they turn opposite ways cancels.
        if (kind === "fill" && paths.length > 1) paths = paths.map((p) => (signedArea(p) < 0 ? reversePath(p) : p));
        return paths.length ? merge(paths) : null;
    }

    private bounds(path: PathData | null): Bounds {
        const own = this.shapes.map((s) => s.bounds).filter((b) => b !== null);
        if (path && own.length !== this.shapes.length) return pathBounds(path);
        if (!own.length) return [0, 0, 0, 0];
        return own.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
    }

    /** A leaf drawing `g`: a path node, or a compound for a boolean result. */
    private leaf(parent: Node, g: Geom, props: LeafProps): Node {
        return "members" in g ? this.doc.compound(parent, { ...props, members: g.members }) : this.doc.pathNode(parent, { ...props, path: g.path });
    }

    private geomBounds(g: Geom): Bounds {
        return "members" in g ? membersBounds(g.members) ?? [0, 0, 0, 0] : pathBounds(g.path);
    }

    /** The surface's outline grown by `spread`, shape by shape (a shape that
     *  can't spread casts its own outline). A shrink can collapse a
     *  shape: an `inset` one then casts nothing, null when none is left. */
    private spreadGeom(geom: Geom, spread: number, inset: boolean): Geom | null {
        if (!spread || "members" in geom) return geom;
        const paths: PathData[] = [];
        for (const s of this.shapes) {
            if (s.members || !s.fill || !s.fill.verbs.length) continue;
            const p = s.spread ? s.spread(spread) : s.fill;
            if (p && p.verbs.length) paths.push(p);
            else if (!inset) paths.push(s.fill);
        }
        return paths.length ? { path: merge(paths) } : null;
    }

    /** A group whose children are clipped to `g` (a compound clips as an alpha mask). */
    private clipTo(parent: Node, g: Geom): Node {
        if ("path" in g) {
            const [x0, y0, x1, y1] = pathBounds(g.path);
            return this.doc.group(parent, { clip: { x: x0, y: y0, w: x1 - x0, h: y1 - y0, r: 0, path: g.path } });
        }
        const m = this.doc.group(parent, { mask: "alpha" });
        this.doc.compound(m, { members: g.members, fill: BLACK });
        return m;
    }

    /** A group whose children show only outside `g`. */
    private clipOutside(parent: Node, g: Geom): Node {
        const m = this.doc.group(parent, { mask: "invertAlpha" });
        this.leaf(m, g, { fill: BLACK });
        return m;
    }

    private fill(layers: ReturnType<typeof fillOps.resolve>) {
        this.painted = true;
        // A boolean scope only collects outlines; its result is painted after.
        if (this.booleans.length) return;
        this.deferring("fill", () => this.paintFill(layers));
    }

    /** Runs `paint` into the innermost mask's after-group when that mask's
     *  `apply` leaves `kind` out: drawn after endMask, over the masked composite. */
    private deferring(kind: "fill" | "stroke", paint: () => void) {
        const m = this.masks[this.masks.length - 1];
        const after = m?.apply && !m.apply.has(kind) && !this.inVectorMask ? m.after : null;
        if (!after) return paint();
        this.stack.push(after);
        try {
            paint();
        } finally {
            this.stack.splice(this.stack.lastIndexOf(after));
        }
    }

    private paintFill(layers: ReturnType<typeof fillOps.resolve>) {
        this.paintText(layers, null);
        if (!layers.length) return;
        if (this.fillNative(layers)) return;
        const path = this.surface("fill");
        const geoms: Geom[] = path ? [{ path }] : [];
        for (const s of this.shapes) if (s.members) geoms.push({ members: s.members });
        if (!geoms.length) return;
        const bounds = this.bounds(path);
        const all = this.shadows;
        this.shadows = [];
        for (const g of geoms) this.fillGeom(g, bounds, layers, all);
    }

    /**
     * One rect or ellipse painted solid, with no shadow to cast, drawn as the
     * renderer's own shape. Gradients and images stay paths: their paint space
     * is the path's.
     */
    private fillNative(layers: ReturnType<typeof fillOps.resolve>): boolean {
        const shape = this.shapes.length === 1 ? this.shapes[0] : null;
        const box = shape?.native;
        if (!shape || !box || this.inVectorMask || this.shadows.length || !layers.every(isSolid)) return false;
        for (const f of layers) {
            const paint = fillPaint(f, shape.bounds!, this.missing, this.assets);
            if (paint) this.native(this.cur, box, { fill: paint, opacity: this.worldAlpha * ((f as any).opacity ?? 1), blend: this.blendOf(f) });
        }
        return true;
    }

    /**
     * An undashed solid stroke round one rect, or round a circle (an ellipse's
     * offset outline is no ellipse), drawn as the renderer's own shape. Biased by
     * `align`, the band is a centred stroke round the shape offset by
     * align·weight/2, which stays exact while no rounded corner shrinks away. The
     * renderer keeps a square corner sharp, which is a miter join.
     */
    private strokeNative(st: ReturnType<typeof strokeOps.resolve>[number], weight: number, intWidth: number, dev: Xform): boolean {
        const shape = this.shapes.length === 1 ? this.shapes[0] : null;
        const native = shape?.native;
        if (!shape || !native || weight <= 0 || (st.dash?.length ?? 0) > 0 || !st.fill.every(isSolid)) return false;
        if (native.kind === "ellipse" && Math.abs(native.w - native.h) > 1e-3) return false;
        if (native.kind === "rect" && native.radii.some((r) => r === 0) && (st.join !== "miter" || !(st.miterLimit >= Math.SQRT2))) return false;
        const a = Math.max(-1, Math.min(1, st.align ?? 0));
        const box = offsetBox(native, (a * weight) / 2);
        if (!box) return false;
        const b = shape.bounds!;
        // As the path's points hold the box: in 32-bit floats.
        const snapM = this.snapBounds([Math.fround(b[0]), Math.fround(b[1]), Math.fround(b[2]), Math.fround(b[3])], intWidth, dev);
        const parent = snapM ? this.doc.group(this.cur, { transform: snapM }) : this.cur;
        for (const f of st.fill) {
            const paint = fillPaint(f, b, this.missing, this.assets);
            if (!paint) continue;
            const stroke = { paint, width: weight, join: st.join as never, cap: st.cap as never, miter: st.miterLimit };
            // As the path route: an aligned band keeps the normal blend.
            this.native(parent, box, { opacity: this.worldAlpha * ((f as any).opacity ?? 1), stroke, ...(a === 0 && { blend: this.blendOf(f) }) });
        }
        return true;
    }

    private native(parent: Node, box: NativeShape, props: LeafProps): Node {
        const at = { ...props, transform: [1, 0, 0, 1, box.x, box.y] as Mat, w: box.w, h: box.h, radii: box.radii };
        return box.kind === "rect" ? this.doc.rect(parent, at) : this.doc.ellipse(parent, at);
    }

    private fillGeom(geom: Geom, bounds: Bounds, layers: ReturnType<typeof fillOps.resolve>, all: ShadowResolved[]) {
        if (this.inVectorMask) {
            this.leaf(this.cur, geom, { fill: BLACK });
            return;
        }
        // Drop shadows with one solid fill ride the leaf (the renderer's
        // shadow paths); others are an offset, blurred copy painted with the
        // shadow's own fill, under the fill.
        const solid: Shadow[] = [];
        for (const sh of all) {
            if (sh.inner) continue;
            const one = sh.fill.length === 1 && (sh.fill[0] as any).type === "solid";
            if (one) {
                const s2 = shadowOf(sh, this.missing);
                if (s2) solid.push(s2);
                continue;
            }
            const dx = sh.offset?.x ?? 0, dy = -(sh.offset?.y ?? 0);
            const g = this.doc.group(this.cur, { transform: [1, 0, 0, 1, dx, dy], filter: sh.blur > 0 ? { kind: "blur", sigma: sh.blur / 2 } : undefined });
            const cast = this.spreadGeom(geom, sh.spread ?? 0, false)!;
            for (const f of sh.fill) {
                const paint = fillPaint(f, this.spaceBounds(f, bounds), this.missing, this.assets);
                if (paint) this.leaf(g, cast, { fill: paint, opacity: this.worldAlpha * ((f as any).opacity ?? 1) });
            }
        }
        layers.forEach((f, i) => {
            const space = this.spaceBounds(f, bounds);
            const paint = fillPaint(f, space, this.missing, this.assets);
            if (!paint) return;
            const opacity = this.worldAlpha * ((f as any).opacity ?? 1);
            const shadows = i === 0 ? solid : [];
            const echo = (f as any).type === "video" ? (f as any).preset?.adjustments?.find((a: any) => a.type === "echo") : undefined;
            if (echo && echo.echoes > 0 && echo.delay > 0) {
                this.echoStack(geom, f, space, bounds, paint, opacity, shadows, echo);
                return;
            }
            const intensity = (f as any).preset?.intensity ?? 1;
            if (intensity > 0 && intensity < 1 && this.pixelAdjustments(f).length) {
                // applyMediaFilters' mix and fade: a lerp of the graded and the
                // ungraded fill where the content is opaque. Here the ungraded
                // one goes over the graded at 1 - intensity, since the renderer
                // folds a leaf's opacity into what its effects read.
                const g = this.doc.group(this.cur, { opacity, blend: this.blendOf(f) });
                this.mediaPreset(this.leaf(g, geom, { fill: paint, shadows }), f, bounds);
                this.leaf(g, geom, { fill: paint, opacity: 1 - intensity });
                return;
            }
            this.mediaPreset(this.leaf(this.cur, geom, { fill: paint, opacity, shadows, blend: this.blendOf(f) }), f, bounds);
        });
        // applyInnerShadows: a padded rect minus the offset contour, filled with
        // the shadow's fill, blurred, clipped to the shape — after the fill.
        for (const sh of all) {
            if (!sh.inner) continue;
            // An inset shadow's spread shrinks the contour it is cast from; one
            // shrunk to nothing leaves no hole, so the shadow fills the shape.
            const hole = this.spreadGeom(geom, -(sh.spread ?? 0), true);
            const dx = sh.offset?.x ?? 0, dy = -(sh.offset?.y ?? 0);
            const [x0, y0, x1, y1] = this.geomBounds(geom);
            const pad = Math.abs(dx) + Math.abs(dy) + sh.blur * 2 + 2;
            const clip = this.clipTo(this.cur, geom);
            for (const f of sh.fill) {
                const paint = fillPaint(f, this.spaceBounds(f, bounds), this.missing, this.assets);
                if (!paint) continue;
                const blurred = this.doc.group(clip, { opacity: this.worldAlpha * ((f as any).opacity ?? 1), filter: sh.blur > 0 ? { kind: "blur", sigma: sh.blur / 2 } : undefined });
                const region = this.doc.group(blurred, hole ? { mask: "invertAlpha" } : {});
                if (hole) this.leaf(region, hole, { transform: [1, 0, 0, 1, dx, dy], fill: BLACK });
                this.doc.rect(region, { transform: [1, 0, 0, 1, x0 - pad, y0 - pad], w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad, fill: paint });
            }
        }
    }

    /** _richText: spans laid out as one paragraph about the origin (no x/y,
     *  wrapped at a positive width) and painted eagerly with each span's own
     *  fill — runs carry their paints — and strokes. */
    private richText(state: any) {
        const f = withRichTextDescriptor(state);
        const spans = f.spans as any[];
        if (!spans.length) return;
        const local: [number, number, number, number] = [-f.width / 2, -f.height / 2, f.width / 2, f.height / 2];
        const clear: Paint = { kind: "solid", color: [0, 0, 0, 0] };
        const layerPaint = (layers: any[]): Paint => (layers[0] ? fillPaint(layers[0], local, this.missing, this.assets) : null) ?? clear;
        const runs: TextRunSpec[] = spans.map((sp) => ({
            text: sp.text, family: sp.fontFamily, size: sp.fontSize, weight: sp.fontWeight,
            italic: sp.fontStyle === "italic" || sp.fontStyle === "oblique", letterSpacing: sp.letterSpacing,
        }));
        const align = ({ start: "left", end: "right" } as Record<string, TextSpec["align"]>)[f.textAlign] ?? (f.textAlign as TextSpec["align"]);
        const spec: TextSpec = { runs, align, wrap: f.width > 0, width: f.width, lineHeight: f.lineHeight };
        // One text node per fill layer, each span's k-th layer on its runs (clear
        // where a span has fewer), then one per distinct stroke. Painting run by
        // run would differ only where runs overlap.
        const fills = Math.max(1, ...spans.map((sp) => sp.fill.length));
        for (let k = 0; k < fills; k++) {
            const layerRuns = runs.map((r, j) => ({ ...r, paint: layerPaint(spans[j].fill.slice(k, k + 1)) }));
            this.doc.textNode(this.cur, { text: { ...spec, runs: layerRuns }, fill: clear, opacity: this.worldAlpha });
        }
        const strokes = new Map<string, { k: number; st: any; paints: Paint[] }>();
        spans.forEach((sp, j) => sp.stroke.forEach((st: any, k: number) => {
            const key = `${k}|${st.weight}|${st.join}|${st.cap}|${st.miterLimit}`;
            let s = strokes.get(key);
            if (!s) strokes.set(key, (s = { k, st, paints: spans.map(() => clear) }));
            s.paints[j] = layerPaint(st.fill);
        }));
        for (const { st, paints } of [...strokes.values()].sort((a, b) => a.k - b.k)) {
            const strokeRuns = runs.map((r, j) => ({ ...r, paint: paints[j] }));
            this.doc.textNode(this.cur, { text: { ...spec, runs: strokeRuns }, opacity: this.worldAlpha, stroke: { paint: clear, width: st.weight, join: st.join, cap: st.cap, miter: st.miterLimit } });
        }
    }

    /** Text shapes of the surface as text nodes, filled or stroked. */
    private paintText(layers: ReturnType<typeof fillOps.resolve>, stroke: ReturnType<typeof strokeOps.resolve>[number] | null) {
        for (const shape of this.shapes) {
            const t = shape.text;
            if (!t) continue;
            for (const f of layers) {
                const paint = fillPaint(f, textBox(t), this.missing, this.assets);
                if (paint) this.textLayer(t, t.spec, t.spec, paint, this.worldAlpha * ((f as any).opacity ?? 1), stroke);
            }
        }
    }

    /**
     * A text whose `segments` paint themselves (styled runs, a Write On reveal):
     * core sends no fill or stroke op after it. One block shaped as runs, so a
     * hidden piece keeps its place: a text node per fill layer and per stroke,
     * each run painted with its piece's k-th layer, clear where it has none.
     */
    private paintSegments(t: TextOut, segments: TextSegment[]) {
        const spec = this.segmentSpec(t, segments);
        const box = textBox(t);
        const runPaint = (seg: TextSegment, f: FillResolved | undefined): Paint => {
            if (!f || !(seg.opacity > 0)) return CLEAR;
            const p = fillPaint(f, box, this.missing, this.assets);
            return p ? this.fadePaint(p, seg.opacity * ((f as any).opacity ?? 1)) : CLEAR;
        };
        const withPaints = (paint: (seg: TextSegment) => Paint): TextSpec => ({ ...spec, runs: spec.runs.map((r, j) => ({ ...r, paint: paint(segments[j]) })) });
        // An aligned stroke's mask: the shown runs only, in the mask's own paint.
        const mask: TextSpec = { ...spec, runs: spec.runs.map((r, j) => (segments[j].opacity > 0 ? r : { ...r, paint: CLEAR })) };
        const fills = Math.max(0, ...segments.map((s) => s.fill?.length ?? 0));
        for (let k = 0; k < fills; k++) {
            this.textLayer(t, withPaints((seg) => runPaint(seg, seg.fill?.[k])), mask, CLEAR, this.worldAlpha, null);
        }
        const strokes = new Map<string, { k: number; st: StrokeResolved }>();
        segments.forEach((seg) => seg.stroke?.forEach((st, k) => {
            const key = strokeKey(k, st);
            if (!strokes.has(key)) strokes.set(key, { k, st });
        }));
        for (const [key, { k, st }] of [...strokes].sort((a, b) => a[1].k - b[1].k)) {
            const layers = Math.max(...segments.map((seg) => seg.stroke?.[k]?.fill.length ?? 0));
            for (let m = 0; m < layers; m++) {
                const paint = (seg: TextSegment) => {
                    const own = seg.stroke?.[k];
                    return own && strokeKey(k, own) === key ? runPaint(seg, own.fill[m]) : CLEAR;
                };
                this.textLayer(t, withPaints(paint), mask, CLEAR, this.worldAlpha, st);
            }
        }
    }

    /** The block's runs, one per segment; `'autofit'` resolved here, as the renderer fits a single run only. */
    private segmentSpec(t: TextOut, segments: TextSegment[]): TextSpec {
        const base = t.spec.runs[0];
        let scale = 1, wrap = t.spec.wrap;
        const { width = 0, height = 0, minFontSize = 0 } = t.spec;
        if (t.spec.fontSize === "autofit" && width > 0 && height > 0) {
            // resolve_shaping: a probe at AUTOFIT_PROBE_SIZE scaled to the box, or wrapped at the minimum size.
            const probe = this.measureText(base.text, AUTOFIT_PROBE_SIZE, base.family, base.weight, base.letterSpacing, base.italic ? "italic" : "normal");
            const fit = AUTOFIT_PROBE_SIZE * Math.min(probe.width > 0 ? width / probe.width : 1, probe.height > 0 ? height / probe.height : 1);
            if (wrap && fit < minFontSize) scale = minFontSize / AUTOFIT_PROBE_SIZE;
            else {
                scale = fit / AUTOFIT_PROBE_SIZE;
                wrap = false;
            }
        }
        const runs: TextRunSpec[] = segments.map((s) => ({
            text: s.text,
            family: s.fontFamily ?? base.family,
            size: (s.fontSize ?? base.size) * scale,
            weight: s.fontWeight,
            italic: s.fontStyle === undefined ? base.italic : s.fontStyle === "italic" || s.fontStyle === "oblique",
            letterSpacing: s.letterSpacing,
            decoration: s.textDecoration === undefined ? base.decoration : s.textDecoration === "underline" ? "underline" : s.textDecoration === "line-through" ? "lineThrough" : undefined,
        }));
        return { ...t.spec, runs, wrap, fontSize: undefined };
    }

    /** A paint at `k` of its alpha; one that has no colour to fade (an image, a shader) draws at full. */
    private fadePaint(p: Paint, k: number): Paint {
        if (k >= 1) return p;
        if (p.kind === "solid") return { ...p, color: [p.color[0], p.color[1], p.color[2], p.color[3] * k] };
        if ("stops" in p) return { ...p, stops: p.stops.map((s) => ({ ...s, color: [s.color[0], s.color[1], s.color[2], s.color[3] * k] })) } as Paint;
        this.missing.add("text:run-opacity");
        return p;
    }

    /** One fill (`stroke` null) or stroke of a text block; a run's own paint wins over `paint`, and `mask`'s runs shape an aligned stroke's band. */
    private textLayer(t: TextOut, spec: TextSpec, mask: TextSpec, paint: Paint, opacity: number, stroke: ReturnType<typeof strokeOps.resolve>[number] | null) {
        if (!stroke) {
            this.doc.textNode(this.cur, { transform: t.transform, text: spec, opacity, fill: paint });
            return;
        }
        const st = (width: number) => ({ paint, width, join: stroke.join as never, cap: stroke.cap as never, miter: stroke.miterLimit, dash: stroke.dash, dashPhase: stroke.dashOffset });
        const al = Math.max(-1, Math.min(1, stroke.align ?? 0));
        if (al === 0) {
            this.doc.textNode(this.cur, { transform: t.transform, text: spec, opacity, stroke: st(stroke.weight) });
            return;
        }
        // drawTextUnionStroke: glyphs have no single path, so the band
        // is one stroke under a mask made of the filled glyphs and a
        // ring stroked along them.
        const glyphs = (parent: Node) => this.doc.textNode(parent, { transform: t.transform, text: mask, fill: BLACK });
        const ring = (parent: Node, width: number) =>
            this.doc.textNode(parent, { transform: t.transform, text: mask, stroke: { paint: BLACK, width, join: stroke.join as never, miter: stroke.miterLimit } });
        // Erase what lies inside (a > 0) or outside (a < 0) the
        // glyphs, less a ring `keep` wide either side of the outline.
        const masked = (keep: number) => {
            if (al > 0) {
                const g = this.doc.group(this.cur, { mask: "invertAlpha" });
                const m = this.doc.group(g, { mask: "invertAlpha" });
                ring(m, keep);
                glyphs(m);
                return g;
            }
            const g = this.doc.group(this.cur, { mask: "alpha" });
            const m = this.doc.group(g);
            glyphs(m);
            ring(m, keep);
            return g;
        };
        if (Math.abs(al) >= 1) {
            // A band on one side only: twice as wide, its mask moved one
            // device px past the outline (applyTextAlignMask's seam
            // bridge, an erode or dilate, which a ring along every
            // glyph's outline is not), so band and fill overlap.
            const g = this.doc.group(this.cur, { mask: al > 0 ? "invertAlphaEroded" : "alphaDilated" });
            glyphs(g);
            this.doc.textNode(g, { transform: t.transform, text: spec, opacity, stroke: st(2 * stroke.weight) });
        } else {
            // drawTextPartiallyAlignedStroke: the band reaches (1 + a)·w/2
            // outside and (1 − a)·w/2 inside; stroked as wide as the
            // longer reach, the surplus erased past the shorter one.
            const out = ((1 + al) * stroke.weight) / 2, inside = ((1 - al) * stroke.weight) / 2;
            this.doc.textNode(masked(2 * (al > 0 ? inside : out)), { transform: t.transform, text: spec, opacity, stroke: st(2 * Math.max(out, inside)) });
        }
    }

    /** A Tex.surface source recorded into a detached subtree and rasterized
     *  at width×height × its pixel ratio, origin at the
     *  centre. The outer draw's surface state is set aside meanwhile. */
    private surfaceOf(t: any): ImageAsset | null {
        const ratio = Math.max(1, Math.min(t.maxPixelRatio ?? 1, 4)); // MAX_RASTER_PIXEL_RATIO
        const w = t.width ?? 512, h = t.height ?? 512;
        const pw = Math.max(1, Math.ceil(w * ratio)), ph = Math.max(1, Math.ceil(h * ratio));
        const root = this.doc.detached({ transform: [ratio, 0, 0, ratio, (w * ratio) / 2, (h * ratio) / 2] });
        const saved = { stack: this.stack, scopes: this.scopes, alpha: this.worldAlpha, shapes: this.shapes, painted: this.painted, shadows: this.shadows, masks: this.masks, clips: this.clips, cameras: this.cameras };
        this.stack = [root]; this.scopes = []; this.worldAlpha = 1; this.masks = []; this.clips = []; this.cameras = [];
        this.resetSurface();
        try {
            const src = resolveSurfaceSource(t.source) as any;
            if (src.kind === "graphics") this.draw(src.graphics);
            else {
                src.node.layout({ x: 0, y: 0, width: w, height: h }, this);
                src.node.render(this);
            }
        } catch (e) {
            this.missing.add(`surface:error`);
            console.warn(e);
        } finally {
            Object.assign(this, { stack: saved.stack, scopes: saved.scopes, worldAlpha: saved.alpha, shapes: saved.shapes, painted: saved.painted, shadows: saved.shadows, masks: saved.masks, clips: saved.clips, cameras: saved.cameras });
        }
        const a = this.doc.addSurface(root, pw, ph);
        a.version = ++sceneVersion;
        return a;
    }

    /** applyMediaFilters: a media fill's pixel adjustments run over the fill in
     *  the shape's box and are clipped back to the shape — here, effects on
     *  that fill's leaf with clip-to-input. */
    private mediaPreset(node: Node, f: unknown, bounds: [number, number, number, number]) {
        const pixel = this.pixelAdjustments(f);
        if (!pixel.length || ((f as any).preset.intensity ?? 1) <= 0) return;
        node.effects = pixel.map((a: any) => ({ ...a, clip: true }));
        node.effectBox = [bounds[0], bounds[1], bounds[2] - bounds[0], bounds[3] - bounds[1]];
        node.effectTime = this.elapsed();
    }

    /** A media fill's pixel adjustments: the video-only ones are not (posterizeTime
     *  is in resolveVideoTimestamp, echo is echoStack). */
    private pixelAdjustments(f: unknown): object[] {
        const any = f as any;
        if ((any.type !== "image" && any.type !== "video") || !any.preset) return [];
        return (any.preset.adjustments ?? []).filter((a: any) => a.type !== "echo" && a.type !== "posterizeTime");
    }

    /** VideoFillRenderer.drawEchoStack: the past taps oldest first, each at
     *  decay^n, then the current frame with its grade, all with the echo's blend. */
    private echoStack(geom: Geom, f: any, space: Bounds, bounds: Bounds, paint: Paint, opacity: number, shadows: Shadow[], echo: any) {
        const blend = docBlend(echo.blend ?? "screen") ?? "screen";
        const decay = echo.decay ?? 0.5;
        const taps = Math.min(Math.max(0, Math.floor(echo.echoes)), 32); // MAX_ECHOES
        const time = this.videoTime(f);
        if (shadows.length) this.leaf(this.cur, geom, { fill: { kind: "solid", color: [0, 0, 0, 0] }, opacity, shadows });
        for (let n = taps; n >= 1 && time !== null; n--) {
            const ts = time - n * echo.delay;
            if (ts < 0) continue;
            const tap = fillPaint(f, space, this.missing, { ...this.assets, video: (fill) => this.assets.video(fill, ts) });
            if (tap) this.leaf(this.cur, geom, { fill: tap, opacity: opacity * Math.pow(decay, n), blend });
        }
        this.mediaPreset(this.leaf(this.cur, geom, { fill: paint, opacity, blend }), f, bounds);
    }

    /** The source time a video fill shows now, or null before its clip loads. */
    private videoTime(fill: any): number | null {
        const v = this.storage?.videos.get(assetKey(fill.src));
        return v ? resolveVideoTimestamp(fill, this.currentRenderState()?.elapsed ?? 0, v.duration) : null;
    }

    /** The current node's elapsed time (s), the `time` its effects get. */
    private elapsed(): number {
        return this.currentRenderState()?.elapsed ?? 0;
    }

    /** FillHandler.boundsForSpace: local = the shape's bounds; parent = the
     *  parent's layout rect; global = the viewport mapped back to local space. */
    private spaceBounds(f: unknown, local: [number, number, number, number]): [number, number, number, number] {
        const space = (f as { space?: string }).space ?? "local";
        if (space === "parent") {
            const p = this.currentSpaceRects().parent;
            return p ? [p.left, p.top, p.right, p.bottom] : local;
        }
        if (space === "global") {
            const m = this.device();
            const det = m[0] * m[3] - m[1] * m[2];
            if (!det) return local;
            const inv = (x: number, y: number): [number, number] => {
                const dx = x - m[4], dy = y - m[5];
                return [(m[3] * dx - m[2] * dy) / det, (-m[1] * dx + m[0] * dy) / det];
            };
            const W = this.width * this.pixelRatio, H = this.height * this.pixelRatio;
            const a = inv(0, 0), b = inv(W, H);
            return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
        }
        return local;
    }

    /** A fill layer's blend mode as a leaf's (the leaf blends as a unit). */
    private blendOf(f: unknown): BlendMode {
        const b = (f as { blend?: string }).blend;
        if (!b || b === "normal") return "normal";
        const mode = docBlend(b);
        if (!mode) this.missing.add(`fill:blend:${b}`);
        return mode ?? "normal";
    }

    /** Device matrix of the current group: pixel ratio × the group chain. */
    private device(): Xform {
        let m: Xform = [this.pixelRatio, 0, 0, this.pixelRatio, 0, 0];
        for (const g of this.stack) m = mulX(m, g.transform);
        return m;
    }

    /** StrokeHandler.snapPath: an axis-aligned thin stroke's shape scaled and
     *  moved so its device bounds sit on pixel edges (centres for odd widths). */
    private snap(path: PathData, intWidth: number, m: Xform): Mat | null {
        return this.snapBounds(pathBounds(path), intWidth, m);
    }

    private snapBounds([bx0, by0, bx1, by1]: Bounds, intWidth: number, m: Xform): Mat | null {
        if (intWidth <= 0 || Math.abs(m[1]) > 1e-6 || Math.abs(m[2]) > 1e-6 || m[0] === 0 || m[3] === 0) return null;
        if (bx1 - bx0 <= 0 || by1 - by0 <= 0) return null;
        const sx = m[0], sy = m[3], tx = m[4], ty = m[5];
        const l = tx + sx * bx0, t = ty + sy * by0, r = tx + sx * bx1, b = ty + sy * by1;
        const off = intWidth % 2 === 0 ? 0 : 0.5;
        const tl = Math.round(l - off) + off, tt = Math.round(t - off) + off;
        const tr = Math.round(r - off) + off, tb = Math.round(b - off) + off;
        if (tr - tl < 1 || tb - tt < 1) return null;
        const kx = (tr - tl) / (r - l), ky = (tb - tt) / (b - t);
        if (Math.abs(kx - 1) < 1e-4 && Math.abs(ky - 1) < 1e-4 && Math.abs(tl - l) < 1e-4 && Math.abs(tt - t) < 1e-4) return null;
        return [kx, 0, 0, ky, (tl - tx) / sx - kx * bx0, (tt - ty) / sy - ky * by0];
    }

    private stroke(strokes: ReturnType<typeof strokeOps.resolve>) {
        this.painted = true;
        if (this.booleans.length) return;
        this.deferring("stroke", () => this.paintStroke(strokes));
    }

    private paintStroke(strokes: ReturnType<typeof strokeOps.resolve>) {
        for (const st of strokes) this.paintText(st.fill, st);
        let fillAll: PathData | null | undefined;
        const surfaceFill = () => (fillAll === undefined ? (fillAll = this.surface("fill")) : fillAll);
        const dev = this.device();
        const scale = Math.sqrt(Math.abs(dev[0] * dev[3] - dev[1] * dev[2]));
        const rotated = isProjective(dev) || Math.abs(dev[1]) > 1e-6 || Math.abs(dev[2]) > 1e-6;
        for (const st of strokes) {
            // resolveStrokeWidth: under 2.5 device px (axis-aligned), a whole
            // number of device px.
            let weight = st.weight, intWidth = -1;
            if (!rotated && weight > 0 && scale > 0 && weight * scale < 2.5) {
                intWidth = Math.max(1, Math.round(weight * scale));
                weight = intWidth / scale;
            }
            if (this.strokeNative(st, weight, intWidth, dev)) continue;
            for (const shape of this.strokeShapes()) {
                let geom: Geom, interior: Geom | null;
                let plan: StrokePlan = { cap: st.cap, ends: [], dash: st.dash, dashPhase: st.dashOffset };
                if (shape.members) {
                    geom = interior = { members: shape.members };
                } else {
                    if (!shape.stroke || !shape.stroke.verbs.length) continue;
                    const p = strokePlan(st, shape.stroke, weight, intWidth > 0);
                    if (!p) continue;
                    plan = p;
                    geom = { path: p.source ?? shape.stroke };
                    interior = shape.alignInterior ? { members: shape.alignInterior } : shape.interior && isClosed(shape.interior) ? { path: shape.interior } : null;
                }
                const bounds = this.bounds(surfaceFill() ?? ("path" in geom ? geom.path : null));
                // alignedStrokeBand: outside (1 + a)·w, inside (1 − a)·w, each
                // clipped to its side. A marked stroke is centred: half a head means nothing.
                const a = Math.max(-1, Math.min(1, st.align ?? 0));
                const aligned = a !== 0 && interior !== null && !plan.ends.some((e) => isStrokeMarker(e.cap));
                const halves: [number, "in" | "out" | "both"][] = aligned
                    ? [[(1 + a) * weight, "out"], [(1 - a) * weight, "in"]]
                    : [[weight, "both"]];
                const snapM = shape.fill ? this.snap(shape.fill, intWidth, dev) : null;
                const parent = snapM ? this.doc.group(this.cur, { transform: snapM }) : this.cur;
                for (const f of st.fill) {
                    const paint = fillPaint(f, this.spaceBounds(f, bounds), this.missing, this.assets);
                    if (!paint) continue;
                    const opacity = this.worldAlpha * ((f as any).opacity ?? 1);
                    for (const [width, side] of halves) {
                        if (width <= 0) continue;
                        const stroke = { paint, width, join: st.join as never, cap: plan.cap as never, miter: st.miterLimit, dash: plan.dash, dashPhase: plan.dashPhase };
                        if (side === "both") this.strokeLeaf(parent, geom, { opacity, stroke, blend: this.blendOf(f) }, plan.ends);
                        else this.strokeLeaf(side === "in" ? this.clipTo(parent, interior!) : this.clipOutside(parent, interior!), geom, { opacity, stroke }, plan.ends);
                    }
                }
            }
        }
    }

    /** strokeShapesForSpace: two or more shapes stroke as one figure, so
     *  overlaps show no seams: their union outline when every one is closed and
     *  whole, else their contours together (a union would close open ones),
     *  aligned against the union. Text keeps each shape apart. */
    private strokeShapes(): ShapeOut[] {
        if (this.shapes.length < 2 || this.shapes.some((s) => s.text)) return this.shapes;
        // A boolean result first: the union folds in after its own ops.
        const withPaths = this.shapes.filter((s) => s.members || (s.fill && s.fill.verbs.length)).sort((a, b) => (b.members ? 1 : 0) - (a.members ? 1 : 0));
        if (withPaths.length < 2) return this.shapes;
        const members: Member[] = [];
        for (const s of withPaths) {
            if (s.members) s.members.forEach((m, j) => members.push({ ...m, op: j === 0 ? "union" : m.op }));
            else members.push({ kind: "path", path: s.fill!, op: "union" });
        }
        if (withPaths.filter((s) => s.members).length > 1) this.missing.add("stroke:union-of-booleans");
        const bounds = withPaths.every((s) => s.bounds) ? withPaths.map((s) => s.bounds!).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]) : null;
        const open = withPaths.some((s) => !s.members && (s.stroke !== s.fill || s.trimmed || !isClosed(s.fill!)));
        if (!open) return [{ fill: null, stroke: null, interior: null, bounds, members }];
        // A boolean result has no contour of its own to add.
        if (withPaths.some((s) => s.members)) return this.shapes;
        return [{ fill: merge(withPaths.map((s) => s.fill!)), stroke: merge(withPaths.map((s) => s.stroke ?? s.fill!)), interior: null, alignInterior: members, bounds }];
    }

    /** A stroke leaf with its plan's ends re-capped (StrokeHandler.strokeBand):
     *  what the stroker put past each end masked away, then the end's own cap
     *  or marker filled with the stroke's paint, all in one group so the
     *  opacity and blend apply once. */
    private strokeLeaf(parent: Node, geom: Geom, props: LeafProps & { stroke: NonNullable<LeafProps["stroke"]> }, ends: PathEnd[]): Node {
        if (!ends.length) return this.leaf(parent, geom, props);
        const half = props.stroke.width / 2;
        // A little past the stroker's own cap, which reaches `half` beyond the end.
        const reach = half * 1.01 + 0.5;
        const capped = props.stroke.cap !== "butt";
        const cuts: PathData[] = [], adds: PathData[] = [];
        for (const e of ends) {
            if (isStrokeMarker(e.cap)) {
                // addMarker: the band cut back to where the marker takes over.
                const inset = markerInset(e.cap, e.size, e.weight);
                if (inset > 0 || capped) cuts.push(endBox({ ...e, x: e.x - e.dx * inset, y: e.y - e.dy * inset }, inset + reach, reach));
                adds.push(markerPath(e, e.cap));
                continue;
            }
            if (capped) cuts.push(endBox(e, reach, reach));
            if (e.reached && e.cap !== "butt") adds.push(e.cap === "round" ? endDisc(e, half) : endBox(e, half, half));
        }
        const g = this.doc.group(parent, { opacity: props.opacity ?? 1, blend: props.blend ?? "normal" });
        const inner = { ...props, opacity: 1, blend: "normal" as const };
        if (cuts.length) {
            const m = this.doc.group(g, { mask: "invertAlpha" });
            this.doc.pathNode(m, { path: merge(cuts), fill: BLACK });
            this.leaf(m, geom, inner);
        } else this.leaf(g, geom, inner);
        if (adds.length) this.doc.pathNode(g, { path: merge(adds), fill: props.stroke.paint });
        return g;
    }

    // Boolean groups: the outlines drawn in scope (in the space at beginBoolean) and folds them left to right
    // with the op, as one compound node's members.
    private booleans: { op: BooleanOperation; base: Mat | null; members: Member[] }[] = [];

    beginBoolean(op: BooleanOperation): void {
        this.booleans.push({ op, base: invert(this.device()), members: [] });
        this.resetSurface();
    }

    endBoolean(): void {
        const b = this.booleans.pop();
        this.resetSurface();
        if (!b || !b.members.length) return;
        const outer = this.booleans[this.booleans.length - 1];
        if (!outer) {
            this.shapes.push({ fill: null, stroke: null, interior: null, bounds: membersBounds(b.members), members: b.members });
            return;
        }
        // Nested: the result joins the outer fold. Folding the inner members
        // straight in is exact when the outer op distributes over the inner one
        // (a − (b ∪ c) = a − b − c, a ∩ (b ∩ c) = a ∩ b ∩ c, …) or it comes first.
        // The space here is the inner scope's, so this maps its members out.
        const into = this.relative(outer.base);
        const op = BOOLEAN_OP[outer.op];
        const start = !outer.members.length;
        if (!start && !b.members.slice(1).every((m) => m.op === (op === "cut" ? "union" : op))) this.missing.add("boolean:nested");
        b.members.forEach((m, k) => {
            const own = m.op ?? "union";
            const mop = start ? own : k === 0 || op === "cut" ? op : own;
            outer.members.push({ kind: "path", path: into ? transformPath(m.path!, into) : m.path!, op: mop });
        });
    }

    /** inv(base) · device: the current space in a boolean scope's space. */
    private relative(base: Mat | null): Mat | null {
        const m = this.device();
        if (!base || isProjective(m)) return null;
        return mulX(base, m) as Mat;
    }

    /** A shape drawn in a boolean scope: its outline as the next member. */
    private collect(shape: ShapeOut) {
        const b = this.booleans[this.booleans.length - 1];
        const path = shape.fill;
        if (!path || !path.verbs.length) return;
        const rel = this.relative(b.base);
        if (!rel) this.missing.add("boolean:projective");
        b.members.push({ kind: "path", path: rel ? transformPath(path, rel) : path, op: b.members.length ? BOOLEAN_OP[b.op] : "union" });
    }

    /** ShapeHandler.cut: the shapes before the last one unioned, minus the last. */
    private cut() {
        const withPaths = this.shapes.filter((s) => s.members || (s.fill && s.fill.verbs.length));
        this.resetSurface();
        if (!withPaths.length) return;
        const members: Member[] = [];
        withPaths.forEach((s, k) => {
            const op: MemberOp = k > 0 && k === withPaths.length - 1 ? "cut" : "union";
            if (!s.members) {
                members.push({ kind: "path", path: s.fill!, op });
                return;
            }
            if (k > 0) this.missing.add("cut:compound");
            s.members.forEach((m, j) => members.push({ ...m, op: j === 0 ? op : m.op }));
        });
        this.shapes.push({ fill: null, stroke: null, interior: null, bounds: membersBounds(members), members });
    }

    // Masks: the doc's group mask (its first child is the mask layer). Vector
    // masks clip to the mask's outline, so their paint is opaque here.
    private masks: { vector: boolean; open: boolean; apply: Set<string> | null; after: Node | null }[] = [];
    private get inVectorMask(): boolean {
        const m = this.masks[this.masks.length - 1];
        return !!m && m.open && m.vector;
    }

    beginMask(options?: MaskOptions): void {
        const mode = options?.mode ?? "alpha";
        const lum = mode === "luminance";
        const docMode = options?.inverted ? (lum ? "invertLuminance" : "invertAlpha") : (lum ? "luminance" : "alpha");
        const g = this.doc.group(this.cur, { mask: docMode as never });
        // The paints `apply` leaves out land after the masked group.
        const apply = options?.apply ? new Set<string>(Array.isArray(options.apply) ? options.apply : [options.apply]) : null;
        const after = apply ? this.doc.group(this.cur) : null;
        this.stack.push(g, this.doc.group(g));
        this.masks.push({ vector: mode === "vector", open: true, apply, after });
        this.resetSurface();
    }

    applyMask(): void {
        const m = this.masks[this.masks.length - 1];
        if (!m?.open) return;
        m.open = false;
        this.stack.pop();
        this.resetSurface();
    }

    endMask(): void {
        const m = this.masks.pop();
        if (!m) return;
        if (m.open) this.stack.pop();
        this.stack.pop();
        this.resetSurface();
    }
    private clips: { pushed: number; geom: Geom | null }[] = [];

    /** A Clip's outline: its shapes unioned, each cut subtracting the shape before it. */
    private clipGeom(clip: Clip): Geom | null {
        const members: Member[] = [];
        for (const op of clip.ops() as any[]) {
            if (op.kind === "cut") {
                if (members.length > 1) members[members.length - 1].op = "cut";
                continue;
            }
            const p = shapeOf(op)?.fill;
            if (p && p.verbs.length) members.push({ kind: "path", path: p, op: "union" });
        }
        if (!members.length) return null;
        return members.some((m) => m.op === "cut") ? { members } : { path: merge(members.map((m) => m.path!)) };
    }

    beginClip(clip: Clip): void {
        const geom = this.clipGeom(clip);
        if (!geom) {
            this.clips.push({ pushed: 0, geom: null });
            return;
        }
        const g = this.clipTo(this.cur, geom);
        // A compound clips as a mask: the content goes after the mask layer.
        if ("members" in geom) this.stack.push(g, this.doc.group(g));
        else this.stack.push(g);
        this.clips.push({ pushed: "members" in geom ? 2 : 1, geom });
    }

    endClip(): void {
        const n = this.clips.pop()?.pushed ?? 0;
        for (let i = 0; i < n; i++) this.stack.pop();
    }
    private cameras: number[] = [];

    /** beginCamera: clip to the viewport, then translate·rotate(−heading)·scale(zoom)·translate(−lookAt.x, +lookAt.y). */
    beginCamera(v: { x: number; y: number; width: number; height: number }, lookAt: Vector2, zoom: number, heading: number): void {
        const clipped = this.doc.group(this.cur, { clip: { x: v.x - v.width / 2, y: v.y - v.height / 2, w: v.width, h: v.height, r: 0 } });
        const r = (-heading * Math.PI) / 180, c = Math.cos(r) * zoom, sn = Math.sin(r) * zoom;
        const tx = -lookAt.x, ty = lookAt.y;
        const lens = this.doc.group(clipped, { transform: [c, sn, -sn, c, v.x + c * tx - sn * ty, v.y + sn * tx + c * ty] });
        this.stack.push(clipped, lens);
        this.cameras.push(2);
    }

    endCamera(): void {
        const n = this.cameras.pop() ?? 0;
        for (let i = 0; i < n; i++) this.stack.pop();
    }
    override beginEffects(effects: any[], target: "foreground" | "backdrop", width: number, height: number): void {
        // Foreground effects are already on the node's group (see transform).
        if (target !== "backdrop") return;
        for (const e of effects) if (e?.type === "shader") this.checkShader("effect", e);
        // Backdrop: a paint-less silhouette carrying the effects; the renderer
        // re-renders what lies beneath it through that shape (Layer::backdrop).
        // With no clip of its own the layer is bounded by the clips around it,
        // the viewport at most.
        let silhouette = this.clips[this.clips.length - 1]?.geom;
        if (!silhouette) {
            const [x, y, w, h] = this.viewportBox();
            silhouette = { path: new PathBuilder().moveTo(x, y).lineTo(x + w, y).lineTo(x + w, y + h).lineTo(x, y + h).close().build() };
        }
        this.leaf(this.cur, silhouette, { effects, effectBox: [-width / 2, -height / 2, width, height], effectTime: this.elapsed() });
    }
    override endEffects(): void {}

    private checkShader(scope: "fill" | "effect", shader: unknown): void {
        const nodeId = this.currentNodeStack[this.currentNodeStack.length - 1];
        for (const issue of shaderParamIssues(scope, shader as Parameters<typeof shaderParamIssues>[1])) {
            this.shaderIssues.push(nodeId === undefined ? issue : { ...issue, nodeId });
        }
    }
    override rasterize(): null { this.missing.add("rasterize"); return null; }
}
