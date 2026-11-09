import type { DotGridFillResolved, FractalNoiseFillResolved, GridFillResolved, NoiseFillResolved, Scene3D, StripeFillResolved } from "@motionscript/core";
// The document both backends draw: a small Figma-like node tree. It stands in
// for what core's evaluator hands a renderer each frame (transforms, sizes,
// paints, the Graphics2D op lists of component renders).
//
// Mutations go through `touch`, which records a per-node dirty mask. Only the
// retained backend reads the masks.

export type RGBA = [number, number, number, number];
export type Mat = [number, number, number, number, number, number];
/**
 * A projective transform: `Mat`'s a b c d e f plus the perspective row g h i,
 * mapping (x, y) to ((a·x + c·y + e) / w, (b·x + d·y + f) / w) with
 * w = g·x + h·y + i — the engine's Matrix2D [a c e / b d f / g h i].
 */
export type Mat3 = [number, number, number, number, number, number, number, number, number];
/** A node transform: affine (the fast path) or projective. */
export type Xform = Mat | Mat3;

export interface Stop {
    offset: number;
    color: RGBA;
}

export type TileMode = "clamp" | "repeat" | "mirror" | "decal";

/** An image or video frame the backend samples; `version` bumps when a video frame changes. */
export interface ImageAsset {
    id: number;
    width: number;
    height: number;
    /** Null for a 3D scene, which the renderer draws itself. */
    source: ImageBitmap | VideoFrame | HTMLCanvasElement | OffscreenCanvas | null;
    /** A core `Scene3D` drawn into this image at width × height logical px
     *  (× the viewport scale): the shape's device size. */
    scene3d?: Scene3D;
    /** Device px per logical px a 3D scene renders at (default: the viewport's). */
    scale3d?: number;
    /** What the 3D scene's textures come from: images by their `src`, and
     *  `Tex.surface` textures by descriptor (each a surface asset). */
    links3d?: { images?: Record<string, ImageAsset>; surfaces?: Map<object, ImageAsset> };
    /** A `Tex.surface` source: this detached subtree drawn at width × height
     *  px (pixel ratio 1, as the engine's default), origin top-left. */
    surface?: Node;
    mipmaps: boolean;
    version: number;
}

/** Media fit modes: fill = cover, fit = contain. */
export type ImageFit = "fill" | "fit" | "stretch" | "tile";

export type Paint =
    | { kind: "solid"; color: RGBA }
    | { kind: "linear"; from: [number, number]; to: [number, number]; stops: Stop[]; tile?: TileMode }
    | { kind: "radial"; center: [number, number]; radius: number; stops: Stop[]; tile?: TileMode }
    /** Angles in degrees, clockwise from +x (y-down). */
    | { kind: "sweep"; center: [number, number]; startAngle: number; endAngle: number; stops: Stop[]; tile?: TileMode }
    /** An image placed in `box` (x, y, w, h, local units) by `fit`. */
    | { kind: "image"; image: ImageAsset; fit?: ImageFit; box: [number, number, number, number];
        /** Image px → local, overriding fit/box (adapter/geometry/image-matrix.ts). */
        matrix?: Mat; tile?: TileMode }
    /** One of the engine's procedural fills, resolved by @motionscript/core,
     *  over the shape's bounds `box` (x, y, w, h, local units). */
    | { kind: "procedural"; fill: ProceduralFill; box: [number, number, number, number] }
    /** A user WGSL fill (DESIGN.md §6.1) over `box` (x, y, w, h, local units):
     *  its source, `Params` values by name, the node's elapsed seconds, and the
     *  image `sample_texture` reads. */
    | { kind: "shader"; source: string; uniforms: Record<string, number | number[]>; box: [number, number, number, number]; time: number; texture?: ImageAsset };

export type ProceduralFill =
    | DotGridFillResolved | GridFillResolved | StripeFillResolved | NoiseFillResolved | FractalNoiseFillResolved;

export interface StrokeStyle {
    paint: Paint;
    width: number;
    join?: "miter" | "round" | "bevel";
    cap?: "butt" | "round" | "square";
    miter?: number;
    dash?: number[];
    dashPhase?: number;
}

export interface Shadow {
    dx: number;
    dy: number;
    sigma: number;
    spread: number;
    color: RGBA;
}

export type Filter =
    | { kind: "blur"; sigma: number }
    | { kind: "dropShadow"; dx: number; dy: number; sigma: number; color: RGBA };

export const BLEND_MODES = [
    "normal", "multiply", "screen", "overlay", "darken", "lighten", "colorDodge", "colorBurn",
    "hardLight", "softLight", "difference", "exclusion", "hue", "saturation", "color", "luminosity", "plus",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const VERB = { move: 0, line: 1, quad: 2, cubic: 3, close: 4 } as const;

export interface PathData {
    verbs: Uint8Array;
    points: Float32Array;
}

export type Kind = "group" | "rect" | "ellipse" | "path" | "compound" | "text";
export const KIND_CODE: Record<Kind, number> = { group: 0, rect: 1, ellipse: 2, path: 3, compound: 4, text: 5 };

export interface TextRunSpec {
    text: string;
    family: string;
    size: number;
    weight?: number;
    italic?: boolean;
    letterSpacing?: number;
    decoration?: "underline" | "lineThrough";
    /** This run's own fill (rich text spans); default: the node's fill. */
    paint?: Paint;
}

/**
 * A text block, as core's TextState/RichTextState reaches the renderer. The
 * node's local space is block-local: the block is centred on the origin.
 */
export interface TextSpec {
    runs: TextRunSpec[];
    align?: "left" | "right" | "center" | "justify";
    verticalAlign?: "top" | "center" | "bottom";
    /** Wrap at `width` (when > 0); otherwise `width` only anchors alignment. */
    wrap?: boolean;
    width?: number;
    height?: number;
    /** 0 = the font's own line height, else a multiple of each run's size. */
    lineHeight?: number;
    /** Single-run text: fit the box (`width` × `height`), wrapping at `minFontSize` when `wrap`. */
    fontSize?: "autofit";
    minFontSize?: number;
    /** Text on a path (path space = the node's local space; one line). */
    path?: PathData;
}

/** How a compound member combines with the members before it. */
export type MemberOp = "union" | "cut" | "intersect" | "exclude";
export const MEMBER_OP: Record<MemberOp, number> = { union: 0, cut: 1, intersect: 2, exclude: 3 };

/**
 * One member of a compound shape (core's Graphics2D shape union, a boolean
 * group). Members apply in order: unioned with the result so far, cut out of
 * it, intersected with it or excluded (xor) from it.
 */
export interface Member {
    kind: "rect" | "ellipse" | "path";
    /** Shorthand for `op: "cut"`. */
    cut?: boolean;
    op?: MemberOp;
    transform?: Mat;
    w?: number;
    h?: number;
    radii?: [number, number, number, number];
    path?: PathData;
    evenOdd?: boolean;
}

/** `invertAlphaEroded` / `alphaDilated`: the mask shrunk / grown by one device px first. */
export type MaskMode = "alpha" | "luminance" | "invertAlpha" | "invertLuminance" | "invertAlphaEroded" | "alphaDilated";
export const MASK_CODE: Record<MaskMode, number> = { alpha: 1, luminance: 2, invertAlpha: 3, invertLuminance: 4, invertAlphaEroded: 5, alphaDilated: 6 };

export const D = {
    CREATE: 1 << 0,
    CHILDREN: 1 << 1,
    TRANSFORM: 1 << 2,
    SIZE: 1 << 3,
    RADII: 1 << 4,
    FILL: 1 << 5,
    STROKE: 1 << 6,
    SHADOWS: 1 << 7,
    OPACITY: 1 << 8,
    BLEND: 1 << 9,
    CLIP: 1 << 10,
    FILTER: 1 << 11,
    PATH: 1 << 12,
    MEMBERS: 1 << 13,
    MASK: 1 << 14,
    TEXT: 1 << 15,
    EFFECTS: 1 << 16,
    ALL: (1 << 17) - 1,
} as const;

export class Node {
    children: Node[] = [];
    transform: Xform = [1, 0, 0, 1, 0, 0];
    opacity = 1;
    blend: BlendMode = "normal";
    w = 0;
    h = 0;
    radii: [number, number, number, number] = [0, 0, 0, 0];
    fill?: Paint;
    stroke?: StrokeStyle;
    shadows: Shadow[] = [];
    /** Rounded-rect clip, or a path clip when `path` is set (x/y/w/h/r ignored). */
    clip?: { x: number; y: number; w: number; h: number; r: number; path?: PathData; evenOdd?: boolean };
    /** Group mask: the first child masks the rest. */
    mask?: MaskMode;
    members?: Member[];
    text?: TextSpec;
    /** core NodeEffects (built with core's `Effects`), in authored order. */
    effects?: object[];
    /** Seconds the node's effects animate with (its elapsed time). */
    effectTime?: number;
    /** The box effects measure against (local x, y, w, h); default: the content bounds. */
    effectBox?: [number, number, number, number];
    filter?: Filter;
    path?: PathData;
    evenOdd = false;
    dirty = D.ALL;

    constructor(readonly id: number, readonly kind: Kind) {}
}

type Props = Partial<Omit<Node, "id" | "kind" | "children" | "dirty">>;

export class Doc {
    readonly root: Node;
    readonly nodes: Node[] = [];
    readonly images: ImageAsset[] = [];
    readonly dirty = new Set<Node>();
    private nextId = 0;

    constructor(readonly width: number, readonly height: number, readonly background: RGBA) {
        this.root = this.make("group", {});
    }

    private make(kind: Kind, props: Props): Node {
        const n = new Node(this.nextId++, kind);
        Object.assign(n, props);
        this.nodes.push(n);
        this.dirty.add(n);
        return n;
    }

    add(parent: Node, kind: Kind, props: Props): Node {
        const n = this.make(kind, props);
        parent.children.push(n);
        this.touch(parent, D.CHILDREN);
        return n;
    }

    group(parent: Node, props: Props = {}) {
        return this.add(parent, "group", props);
    }
    rect(parent: Node, props: Props) {
        return this.add(parent, "rect", props);
    }
    ellipse(parent: Node, props: Props) {
        return this.add(parent, "ellipse", props);
    }
    pathNode(parent: Node, props: Props) {
        return this.add(parent, "path", props);
    }
    compound(parent: Node, props: Props) {
        return this.add(parent, "compound", props);
    }
    textNode(parent: Node, props: Props) {
        return this.add(parent, "text", props);
    }

    addImage(source: ImageAsset["source"], width: number, height: number, opts: { mipmaps?: boolean } = {}): ImageAsset {
        const asset: ImageAsset = { id: this.images.length, width, height, source, mipmaps: opts.mipmaps ?? true, version: 1 };
        this.images.push(asset);
        return asset;
    }

    addScene3D(scene: Scene3D, width: number, height: number, links3d?: ImageAsset["links3d"]): ImageAsset {
        const asset: ImageAsset = { id: this.images.length, width, height, source: null, mipmaps: false, version: 1, scene3d: scene, links3d };
        this.images.push(asset);
        return asset;
    }

    /** A group outside the drawn tree, for a surface's content. */
    detached(props: Props = {}): Node {
        return this.make("group", props);
    }

    addSurface(root: Node, width: number, height: number): ImageAsset {
        const asset: ImageAsset = { id: this.images.length, width, height, source: null, mipmaps: false, version: 1, surface: root };
        this.images.push(asset);
        return asset;
    }

    touch(n: Node, bits: number) {
        n.dirty |= bits;
        this.dirty.add(n);
    }

    /** Marks every node fully dirty (a backend attached after the fact). */
    touchAll() {
        for (const n of this.nodes) this.touch(n, D.ALL);
    }
}

// ── matrices ─────────────────────────────────────────────────────────────────

export function mat(tx: number, ty: number, rot = 0, scale = 1, px = 0, py = 0): Mat {
    // translate(tx,ty) · rotate(rot) · scale(scale) · translate(-px,-py)
    const c = Math.cos(rot) * scale;
    const s = Math.sin(rot) * scale;
    return [c, s, -s, c, tx - (c * px - s * py), ty - (s * px + c * py)];
}

export function translate(x: number, y: number): Mat {
    return [1, 0, 0, 1, x, y];
}

/** True when `m` carries a perspective row (not 0 0 1). */
export function isProjective(m: Xform): m is Mat3 {
    return m.length === 9 && (m[6] !== 0 || m[7] !== 0 || m[8] !== 1);
}

/** `m` as a row-major 3×3 [a c e / b d f / g h i]. */
function rowMajor(m: Xform): number[] {
    return m.length === 9 ? [m[0], m[2], m[4], m[1], m[3], m[5], m[6], m[7], m[8]] : [m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1];
}

/** `p · c` (apply `c` first), projective. */
export function mul3(p: Xform, c: Xform): Mat3 {
    const P = rowMajor(p), C = rowMajor(c);
    const r = new Array<number>(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = P[i * 3] * C[j] + P[i * 3 + 1] * C[3 + j] + P[i * 3 + 2] * C[6 + j];
    return [r[0], r[3], r[1], r[4], r[2], r[5], r[6], r[7], r[8]];
}

/** `p · c`, staying affine (six numbers) when both are. */
export function mulX(p: Xform, c: Xform): Xform {
    if (p.length === 9 || c.length === 9) return mul3(p, c);
    return [
        p[0] * c[0] + p[2] * c[1], p[1] * c[0] + p[3] * c[1],
        p[0] * c[2] + p[2] * c[3], p[1] * c[2] + p[3] * c[3],
        p[0] * c[4] + p[2] * c[5] + p[4], p[1] * c[4] + p[3] * c[5] + p[5],
    ];
}

// ── paths ────────────────────────────────────────────────────────────────────

export class PathBuilder {
    private verbs: number[] = [];
    private pts: number[] = [];
    moveTo(x: number, y: number) {
        this.verbs.push(VERB.move);
        this.pts.push(x, y);
        return this;
    }
    lineTo(x: number, y: number) {
        this.verbs.push(VERB.line);
        this.pts.push(x, y);
        return this;
    }
    quadTo(x1: number, y1: number, x: number, y: number) {
        this.verbs.push(VERB.quad);
        this.pts.push(x1, y1, x, y);
        return this;
    }
    cubicTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
        this.verbs.push(VERB.cubic);
        this.pts.push(x1, y1, x2, y2, x, y);
        return this;
    }
    close() {
        this.verbs.push(VERB.close);
        return this;
    }
    build(): PathData {
        return { verbs: Uint8Array.from(this.verbs), points: Float32Array.from(this.pts) };
    }
}

/** Path data mapped through an affine transform (Béziers map control point by control point). */
export function transformPath(d: PathData, m: Mat): PathData {
    const pts = new Float32Array(d.points.length);
    for (let i = 0; i < pts.length; i += 2) {
        const x = d.points[i], y = d.points[i + 1];
        pts[i] = m[0] * x + m[2] * y + m[4];
        pts[i + 1] = m[1] * x + m[3] * y + m[5];
    }
    return { verbs: d.verbs, points: pts };
}

/** Control-point bounds of a path: x0 y0 x1 y1. */
export function pathBounds(d: PathData): [number, number, number, number] {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < d.points.length; i += 2) {
        x0 = Math.min(x0, d.points[i]); x1 = Math.max(x1, d.points[i]);
        y0 = Math.min(y0, d.points[i + 1]); y1 = Math.max(y1, d.points[i + 1]);
    }
    return Number.isFinite(x0) ? [x0, y0, x1, y1] : [0, 0, 0, 0];
}

export function memberOp(m: Member): MemberOp {
    return m.op ?? (m.cut ? "cut" : "union");
}

/**
 * Where an image paint puts the image: image pixel (u, v) lands at local
 * (ox + u·sx, oy + v·sy). Same rules as `computeImageMatrix` for the plain
 * cases: fill covers the box (centred), fit is contained
 * (centred, transparent outside), stretch maps the image onto the box, tile
 * repeats it at its natural size from the box origin.
 */
/** Image px → local, and the tile mode, for an image paint. */
export function imageMatrix(p: Extract<Paint, { kind: "image" }>): { m: Mat; tile: TileMode } {
    if (p.matrix) return { m: p.matrix, tile: p.tile ?? "clamp" };
    const { sx, sy, ox, oy, tile } = imagePlacement(p);
    return { m: [sx, 0, 0, sy, ox, oy], tile };
}

export function imagePlacement(p: Extract<Paint, { kind: "image" }>): { sx: number; sy: number; ox: number; oy: number; tile: TileMode } {
    const [x, y, w, h] = p.box;
    const iw = p.image.width, ih = p.image.height;
    const fit = p.fit ?? "fill";
    if (fit === "stretch") return { sx: w / iw, sy: h / ih, ox: x, oy: y, tile: "clamp" };
    if (fit === "tile") return { sx: 1, sy: 1, ox: x, oy: y, tile: "repeat" };
    const s = fit === "fill" ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
    return { sx: s, sy: s, ox: x + (w - iw * s) / 2, oy: y + (h - ih * s) / 2, tile: fit === "fill" ? "clamp" : "decal" };
}
