// Encodes core's Scene3D into the word stream ms-render3d decodes
// (crates/render3d/src/scene.rs; format in docs-3d-renderer.md).
//
// The encoder stays thin: it writes the descriptors' own values (NaN for an
// unset number, so the renderer applies three's defaults), parses colours
// with core's parseColor (gamma-encoded sRGB; the renderer linearizes), and
// calls core's own helpers where core already owns the answer: camera
// placement, cylinder radii, rounded boxes and parametric surfaces (both
// evaluate to buffers here).

import {
    resolveTexture3D, type Texture3D, type ImageTexture3D, type DataTexture3D, type SurfaceTexture3D,
    cylinderRadii, evaluateParametric, evaluateRoundedBox, parseColor,
    resolveCameraPlacement, resolveShadowOptions3D, segmentsOf,
    type BufferGeometry3D, type CameraData3D, type Color, type Geometry3D,
    type LightData3D, type Material3D, type Scene3D, type Transform3D,
} from "@motionscript/core";

export const MAGIC = 0x52334431;
export const VERSION = 3;

type Vec = { x: number; y: number; z: number };
type VecIn = Vec | readonly number[] | number | undefined;

function vec(v: VecIn): Vec {
    if (v === undefined) return { x: 0, y: 0, z: 0 };
    if (typeof v === "number") return { x: v, y: v, z: v };
    if (Array.isArray(v)) return { x: v[0] ?? 0, y: v[1] ?? 0, z: v[2] ?? 0 };
    const o = v as Vec;
    return { x: o.x ?? 0, y: o.y ?? 0, z: o.z ?? 0 };
}

const EULER: Record<string, number> = { XYZ: 0, YXZ: 1, ZXY: 2, ZYX: 3, YZX: 4, XZY: 5 };
const TONE: Record<string, number> = { none: 0, linear: 1, reinhard: 2, cineon: 3, aces: 4, agx: 5, neutral: 6 };
const GEOMETRY: Record<string, number> = {
    box: 0, sphere: 1, plane: 2, cylinder: 3, cone: 4, torus: 5, torusKnot: 6, circle: 7, ring: 8, buffer: 9,
    capsule: 10, polyhedron: 11, lathe: 12, tube: 13, edges: 14, wireframe: 15,
};
const POLYHEDRON: Record<string, number> = { tetrahedron: 0, octahedron: 1, icosahedron: 2, dodecahedron: 3 };
const MATERIAL: Record<string, number> = {
    basic: 0, standard: 1, physical: 2, lambert: 3, phong: 4, normal: 5, points: 6, lineBasic: 7,
    lineDashed: 8, sprite: 9, shadow: 10, toon: 11, matcap: 12, depth: 13, shader: 14,
};
const LIGHT: Record<string, number> = { ambient: 0, hemisphere: 1, directional: 2, point: 3, spot: 4, area: 5 };
const FACES: Record<string, number> = { front: 0, back: 1, both: 2 };
const BLEND: Record<string, number> = { normal: 0, additive: 1, subtractive: 2, multiply: 3, none: 4 };
const MAP_KEYS = ["map", "gradientMap", "alphaMap", "aoMap", "normalMap", "roughnessMap", "metalnessMap", "emissionMap", "envMap", "lightMap", "displacementMap"];

/** What a scene recorded that this encoder or the renderer does not draw yet. */
export interface EncodeReport {
    unsupported: Set<string>;
}

/** A texture the host must provide to the renderer under `id`. */
export interface TextureRequest {
    id: number;
    srgb: boolean;
    texture: ImageTexture3D | DataTexture3D | SurfaceTexture3D;
}

/**
 * Texture identity across frames: an image by `src`, data and surfaces by descriptor object. The host uploads
 * every request in `pending` (pixels for images and data, the 2D raster for
 * surfaces) and clears it.
 */
export class TextureTable {
    private byKey = new Map<unknown, Map<boolean, number>>();
    private next = 1;
    readonly pending: TextureRequest[] = [];
    readonly all = new Map<number, TextureRequest>();

    id(texture: Texture3D, srgb: boolean): number {
        const resolved = resolveTexture3D(texture);
        const key = "src" in resolved ? resolved.src : resolved;
        let slot = this.byKey.get(key);
        if (!slot) this.byKey.set(key, (slot = new Map()));
        let id = slot.get(srgb);
        if (id === undefined) {
            id = this.next++;
            slot.set(srgb, id);
            const req = { id, srgb, texture: resolved };
            this.pending.push(req);
            this.all.set(id, req);
        }
        return id;
    }
}

class Writer {
    private buf = new ArrayBuffer(1 << 16);
    private u32 = new Uint32Array(this.buf);
    private f32 = new Float32Array(this.buf);
    n = 0;

    private room(k: number): void {
        if (this.n + k <= this.u32.length) return;
        let size = this.buf.byteLength * 2;
        while (size / 4 < this.n + k) size *= 2;
        const next = new ArrayBuffer(size);
        new Uint32Array(next).set(this.u32.subarray(0, this.n));
        this.buf = next;
        this.u32 = new Uint32Array(next);
        this.f32 = new Float32Array(next);
    }
    u(v: number): void { this.room(1); this.u32[this.n++] = v >>> 0; }
    f(v: number | undefined): void { this.room(1); this.f32[this.n++] = v === undefined ? NaN : v; }
    v3(v: Vec): void { this.f(v.x); this.f(v.y); this.f(v.z); }
    floats(a: ArrayLike<number>): void {
        this.room(a.length);
        for (let i = 0; i < a.length; i++) this.f32[this.n++] = a[i];
    }
    words(a: ArrayLike<number>): void {
        this.room(a.length);
        for (let i = 0; i < a.length; i++) this.u32[this.n++] = a[i] >>> 0;
    }
    color(c: Color | undefined): void {
        if (c === undefined) { this.u(0); this.f(0); this.f(0); this.f(0); this.f(0); return; }
        const [r, g, b, a] = typeof c === "string" ? parseColor(c) : (c as readonly number[]);
        this.u(1); this.f(r); this.f(g); this.f(b); this.f(a ?? 1);
    }
    segments(s: number | readonly number[] | undefined): void {
        if (s === undefined) { this.u(0); this.f(NaN); this.f(NaN); this.f(NaN); return; }
        if (typeof s === "number") { this.u(1); this.f(s); this.f(NaN); this.f(NaN); return; }
        this.u(2); this.f(s[0]); this.f(s[1]); this.f(s[2]);
    }
    result(): Uint32Array { return this.u32.slice(0, this.n); }
    /** Words `from..n` as a map key. */
    key(from: number): string { return Array.prototype.join.call(this.u32.subarray(from, this.n), ","); }
    copy(from: number): Uint32Array { return this.u32.slice(from, this.n); }
    same(from: number, words: Uint32Array): boolean {
        if (this.n - from !== words.length) return false;
        const u = this.u32;
        for (let i = 0; i < words.length; i++) if (u[from + i] !== words[i]) return false;
        return true;
    }
    set(i: number, v: number): void { this.u32[i] = v >>> 0; }
    append(other: Writer): void {
        this.room(other.n);
        this.u32.set(other.u32.subarray(0, other.n), this.n);
        this.n += other.n;
    }
}

function writeTransform(w: Writer, t: Transform3D | undefined): void {
    if (!t) { w.u(0); return; }
    let flags = 0;
    if (t.position !== undefined) flags |= 1;
    if (t.rotation !== undefined) flags |= 2;
    if (t.quaternion !== undefined) flags |= 4;
    if (t.scale !== undefined) flags |= 8;
    if (t.lookAt !== undefined) flags |= 16;
    if (t.visible === false) flags |= 32;
    if (t.shadow !== undefined) flags |= 64;
    if (t.renderOrder !== undefined) flags |= 128;
    w.u(flags);
    if (flags & 1) w.v3(vec(t.position as VecIn));
    if (flags & 2) {
        w.v3(vec(t.rotation as VecIn));
        w.u(EULER[(t.rotation as { order?: string }).order ?? "XYZ"] ?? 0);
    }
    if (flags & 4) { const q = t.quaternion!; w.f(q.x); w.f(q.y); w.f(q.z); w.f(q.w); }
    if (flags & 8) w.v3(vec(t.scale as VecIn));
    if (flags & 16) w.v3(vec(t.lookAt as VecIn));
    if (flags & 64) {
        const s = t.shadow;
        w.u(s === false ? 0 : s === true ? 1 : s === "cast" ? 2 : s === "receive" ? 3 : 4);
    }
    if (flags & 128) w.f(t.renderOrder);
}

function writeBuffer(w: Writer, b: BufferGeometry3D): void {
    const n = Math.floor(b.position.length / 3);
    const flags = (b.normal ? 1 : 0) | (b.uv ? 2 : 0) | (b.color ? 4 : 0) | (b.index ? 8 : 0)
        | (b.computeNormals ? 16 : 0);
    w.u(GEOMETRY.buffer);
    w.u(flags);
    w.u(n);
    w.u(b.index?.length ?? 0);
    w.floats(b.position);
    if (b.normal) w.floats(b.normal);
    if (b.uv) w.floats(b.uv);
    if (b.color) w.floats(b.color);
    if (b.index) w.words(b.index);
}

function writeGeometry(w: Writer, g: Geometry3D, report: EncodeReport): void {
    switch (g.type) {
        case "box": {
            if ((g.cornerRadius ?? 0) > 0) {
                const [sx, sy, sz] = segmentsOf(g.segments, [1, 1, 1]);
                writeBuffer(w, evaluateRoundedBox({
                    width: g.width ?? 1, height: g.height ?? 1, depth: g.depth ?? 1,
                    radius: g.cornerRadius!, segments: [sx, sy, sz],
                }));
                return;
            }
            w.u(GEOMETRY.box); w.f(g.width); w.f(g.height); w.f(g.depth); w.segments(g.segments);
            return;
        }
        case "sphere":
            w.u(GEOMETRY.sphere); w.f(g.radius); w.segments(g.segments);
            w.f(g.startAngle); w.f(g.sweep); w.f(g.startLatitude); w.f(g.latitudeSweep);
            return;
        case "plane":
            w.u(GEOMETRY.plane); w.f(g.width); w.f(g.height); w.segments(g.segments);
            return;
        case "cylinder": {
            const [top, bottom] = cylinderRadii(g.radius);
            w.u(GEOMETRY.cylinder); w.f(top); w.f(bottom); w.f(g.height); w.segments(g.segments);
            w.u(g.capped === false ? 0 : 1); w.f(g.startAngle); w.f(g.sweep);
            return;
        }
        case "cone":
            w.u(GEOMETRY.cone); w.f(g.radius); w.f(g.height); w.segments(g.segments);
            w.u(g.capped === false ? 0 : 1); w.f(g.startAngle); w.f(g.sweep);
            return;
        case "torus":
            w.u(GEOMETRY.torus); w.f(g.radius); w.f(g.thickness); w.segments(g.segments);
            w.f(g.startAngle); w.f(g.sweep);
            return;
        case "torusKnot":
            w.u(GEOMETRY.torusKnot); w.f(g.radius); w.f(g.thickness); w.segments(g.segments);
            w.f(g.windings?.[0]); w.f(g.windings?.[1]);
            return;
        case "circle":
            w.u(GEOMETRY.circle); w.f(g.radius); w.segments(g.segments); w.f(g.startAngle); w.f(g.sweep);
            return;
        case "ring":
            w.u(GEOMETRY.ring); w.f(g.radius); w.f(g.innerRadius); w.segments(g.segments);
            w.f(g.startAngle); w.f(g.sweep);
            return;
        case "buffer":
            writeBuffer(w, g);
            return;
        case "parametric":
            writeBuffer(w, evaluateParametric(g));
            return;
        case "capsule":
            w.u(GEOMETRY.capsule); w.f(g.radius); w.f(g.height); w.segments(g.segments);
            return;
        case "polyhedron": {
            // A polyhedron's segments are a detail count where 0 (unset) is
            // the plain solid.
            w.u(GEOMETRY.polyhedron); w.u(POLYHEDRON[g.shape ?? "icosahedron"] ?? 2); w.f(g.radius);
            w.f(g.segments === undefined ? 0 : segmentsOf(g.segments, [1])[0]);
            return;
        }
        case "lathe":
            w.u(GEOMETRY.lathe); w.u(g.points.length);
            for (const p of g.points) { const v = vec(p as VecIn); w.f(v.x); w.f(v.y); }
            w.segments(g.segments); w.f(g.startAngle); w.f(g.sweep);
            return;
        case "tube":
            w.u(GEOMETRY.tube); w.u(g.points.length);
            for (const p of g.points) w.v3(vec(p as VecIn));
            w.u(g.closed ? 1 : 0); w.f(g.radius); w.segments(g.segments);
            return;
        case "edges":
            w.u(GEOMETRY.edges); w.f(g.thresholdAngle);
            writeGeometry(w, g.source, report);
            return;
        case "wireframe":
            w.u(GEOMETRY.wireframe);
            writeGeometry(w, g.source, report);
            return;
        default:
            report.unsupported.add(`geometry:${g.type}`);
            w.u(255);
    }
}

/** Fixed: keyed by its own words. Rounded: a box evaluated to a buffer, keyed
 *  by its parameters. Slot: buffer data, keyed by where it is drawn. */
function classify(g: Geometry3D): "fixed" | "rounded" | "slot" {
    switch (g.type) {
        case "buffer": case "parametric": return "slot";
        case "box": return (g.cornerRadius ?? 0) > 0 ? "rounded" : "fixed";
        case "edges": case "wireframe": return classify(g.source) === "fixed" ? "fixed" : "slot";
        default: return "fixed";
    }
}

/** A geometry's structure without its data, as the reconciler's `geometrySignature`. */
function signature(g: Geometry3D): string {
    const bag = g as unknown as Record<string, unknown>;
    let out: string = g.type;
    for (const k of Object.keys(bag).sort()) {
        const v = bag[k];
        if (k === "type" || k === "revision" || k === "staticData" || v === undefined || typeof v === "function") continue;
        if (k === "source") out += `|source=${signature(v as Geometry3D)}`;
        else if (ArrayBuffer.isView(v) || (Array.isArray(v) && v.length > 3)) out += `|${k}#${(v as ArrayLike<number>).length}`;
        else out += `|${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`;
    }
    return out;
}

interface Slot {
    id: number;
    revision: number | undefined;
    /** A buffer's arrays, compared by identity when a revision or `staticData` vouches for them. */
    arrays: readonly unknown[];
    words: Uint32Array;
}

function arraysOf(g: Geometry3D): readonly unknown[] {
    if (g.type !== "buffer") return [];
    return [g.position, g.normal, g.uv, g.color, g.index, g.computeNormals];
}

/**
 * Geometry the renderer keeps across frames (stream v3). A geometry is sent
 * once as a def (id and geometry) and drawn by reference (geometry type 16).
 * An id's content never changes: new content takes a new id, and an id no
 * draw refers to in a frame is dropped, here and by the renderer, at that
 * frame. One table per renderer scene, beside its {@link TextureTable}.
 *
 * Fixed-shape geometry is keyed by its words. A buffer or parametric surface
 * is keyed by its slot, as the reconciler keys a drawable
 * (`<node>|<kind>|<signature>|<nth>`): an unchanged `revision` (and, for a
 * buffer, the same arrays) reuses the def without evaluating or copying it;
 * otherwise its fresh words are compared with the slot's last ones.
 */
export class GeometryTable {
    private next = 1;
    private byKey = new Map<string, number>();
    private slots = new Map<string, Slot>();
    private live = new Set<number>();
    private nth = new Map<string, number>();
    private defs = new Writer();
    private count = 0;

    /** Starts a frame. */
    begin(): void {
        this.live.clear();
        this.nth.clear();
        this.defs.n = 0;
        this.count = 0;
    }

    /** Ends a frame: writes its new defs and forgets what it didn't draw. */
    end(w: Writer): void {
        w.u(this.count);
        w.append(this.defs);
        for (const [k, id] of this.byKey) if (!this.live.has(id)) this.byKey.delete(k);
        for (const [k, s] of this.slots) if (!this.live.has(s.id)) this.slots.delete(k);
    }

    /** The def id for `g`, drawn by an op of `kind` in node scope `scope`. */
    ref(g: Geometry3D, scope: string, kind: string, report: EncodeReport): number {
        const d = this.defs;
        const shape = classify(g);
        if (shape !== "slot") {
            let key: string | undefined;
            if (shape === "rounded") {
                const b = g as Extract<Geometry3D, { type: "box" }>;
                key = `rounded|${b.width}|${b.height}|${b.depth}|${b.cornerRadius}|${JSON.stringify(b.segments)}`;
                const known = this.byKey.get(key);
                if (known !== undefined) return this.use(known);
            }
            const start = d.n;
            d.u(0);
            writeGeometry(d, g, report);
            key ??= d.key(start + 1);
            const known = this.byKey.get(key);
            if (known !== undefined) {
                d.n = start;
                return this.use(known);
            }
            const id = this.add(start);
            this.byKey.set(key, id);
            return id;
        }
        const base = `${scope}|${kind}|${signature(g)}`;
        const n = this.nth.get(base) ?? 0;
        this.nth.set(base, n + 1);
        const key = `${base}|${n}`;
        const slot = this.slots.get(key);
        const revision = (g as { revision?: number }).revision;
        const arrays = arraysOf(g);
        if (slot && slot.revision === revision) {
            if (g.type === "parametric" && revision !== undefined) return this.use(slot.id);
            if (g.type === "buffer" && (revision !== undefined || g.staticData === true)
                && arrays.every((a, i) => a === slot.arrays[i])) return this.use(slot.id);
        }
        const start = d.n;
        d.u(0);
        writeGeometry(d, g, report);
        if (slot && d.same(start + 1, slot.words)) {
            d.n = start;
            slot.revision = revision;
            slot.arrays = arrays;
            return this.use(slot.id);
        }
        const id = this.add(start);
        this.slots.set(key, { id, revision, arrays, words: d.copy(start + 1) });
        return id;
    }

    private use(id: number): number {
        this.live.add(id);
        return id;
    }

    /** The def written at `start` (its id word first) becomes a new id. */
    private add(start: number): number {
        const id = this.next++;
        this.defs.set(start, id);
        this.count++;
        return this.use(id);
    }
}

const WRAP: Record<string, number> = { clamp: 0, repeat: 1, mirror: 2 };

function pair(v: unknown, d: number): [number, number] {
    if (v === undefined) return [d, d];
    if (Array.isArray(v)) return [v[0] ?? d, v[1] ?? d];
    const o = v as { x?: number; y?: number };
    return [o.x ?? d, o.y ?? d];
}

/** The map slot: id, three's `Texture.matrix` (setUvTransform), sampler flags. */
function writeMap(w: Writer, map: Texture3D | undefined, textures: TextureTable | undefined, report: EncodeReport): void {
    if (map === undefined || !textures) {
        if (map !== undefined) report.unsupported.add("texture:map");
        w.u(0); w.u(0); w.f(1); w.f(0); w.f(0); w.f(0); w.f(1); w.f(0); w.u(0);
        return;
    }
    const t = resolveTexture3D(map);
    const srgb = t.colorSpace !== "linear";
    w.u(1);
    w.u(textures.id(map, srgb));
    const [tx, ty] = pair(t.offset, 0);
    const [sx, sy] = pair(t.repeat, 1);
    const [cx, cy] = pair(t.center, 0);
    const r = ((t.rotation ?? 0) * Math.PI) / 180;
    const c = Math.cos(r), s = Math.sin(r);
    w.f(sx * c); w.f(sx * s); w.f(-sx * (c * cx + s * cy) + cx + tx);
    w.f(-sy * s); w.f(sy * c); w.f(-sy * (-s * cx + c * cy) + cy + ty);
    // Images and surfaces are DataTextures with flipY (true unless stated);
    // plain data textures keep three's DataTexture default, false.
    const flip = t.flipY ?? !("data" in t);
    w.u((WRAP[t.wrapS ?? "clamp"] ?? 0) | ((WRAP[t.wrapT ?? "clamp"] ?? 0) << 2) | (flip ? 16 : 0)
        | (t.magFilter === "nearest" ? 32 : 0) | (t.minFilter === "nearest" ? 64 : 0));
}

function writeMaterial(w: Writer, m: Material3D, report: EncodeReport, textures?: TextureTable): void {
    const bag = m as unknown as Record<string, unknown>;
    w.u(MATERIAL[m.type] ?? 1);
    if (!["basic", "standard", "physical", "lambert", "phong", "normal", "lineBasic", "lineDashed", "sprite", "shadow", "points", "toon", "depth"].includes(m.type)) {
        report.unsupported.add(`material:${m.type}`);
    }
    for (const k of MAP_KEYS) if (k !== "map" && k !== "gradientMap" && bag[k] !== undefined) report.unsupported.add(`texture:${k}`);
    if (bag.gradientMap !== undefined && m.type !== "toon") report.unsupported.add("texture:gradientMap");
    // Physical draws as standard plus clearcoat and transmission; the other lobes are unsupported.
    for (const k of ["sheen", "iridescence", "anisotropy", "dispersion"]) {
        if (typeof bag[k] === "number" && (bag[k] as number) > 0) report.unsupported.add(`physical:${k}`);
    }
    w.color(bag.color as Color | undefined);
    w.f(bag.opacity as number | undefined);
    w.f(bag.roughness as number | undefined);
    w.f(bag.metalness as number | undefined);
    w.color(bag.emission as Color | undefined);
    w.f(bag.emissionStrength as number | undefined);
    w.f(bag.envMapIntensity as number | undefined);
    let flags = 0;
    if (bag.transparent === true) flags |= 1;
    if (bag.wireframe === true) flags |= 4;
    if (bag.vertexColors === true) flags |= 8;
    if (bag.shading === "flat") flags |= 16;
    if (bag.toneMapped === false) flags |= 32;
    if (bag.visible === false) flags |= 64;
    if (bag.depthTest === false) flags |= 128;
    if (bag.depthWrite !== undefined) flags |= 256 | (bag.depthWrite ? 512 : 0);
    if (bag.sizeAttenuation === false) flags |= 1024;
    w.u(flags);
    w.u(FACES[(bag.faces as string) ?? "front"] ?? 0);
    w.u(BLEND[(bag.blend as string) ?? "normal"] ?? 0);
    w.f(bag.alphaTest as number | undefined);
    w.f(bag.size as number | undefined);
    w.color(bag.specular as Color | undefined);
    w.f(bag.shininess as number | undefined);
    writeMap(w, bag.map as Texture3D | undefined, textures, report);
    // v2: physical layers, dashes, the toon gradient.
    w.f(bag.clearcoat as number | undefined);
    w.f(bag.clearcoatRoughness as number | undefined);
    w.f(bag.transmission as number | undefined);
    w.f(bag.thickness as number | undefined);
    w.f(bag.ior as number | undefined);
    w.f(bag.attenuationDistance as number | undefined);
    w.color(bag.attenuationColor as Color | undefined);
    w.f(bag.dashSize as number | undefined);
    w.f(bag.gapSize as number | undefined);
    w.f(bag.scale as number | undefined);
    writeMap(w, m.type === "toon" ? bag.gradientMap as Texture3D | undefined : undefined, textures, report);
}

function writeLight(w: Writer, l: LightData3D, t: Transform3D | undefined): void {
    const bag = l as unknown as Record<string, unknown>;
    w.u(LIGHT[l.type] ?? 0);
    w.color(bag.color as Color | undefined);
    w.f(l.intensity);
    w.color(bag.sky as Color | undefined);
    w.color(bag.ground as Color | undefined);
    w.f(bag.distance as number | undefined);
    w.f(bag.decay as number | undefined);
    w.f(bag.angle as number | undefined);
    w.f(bag.penumbra as number | undefined);
    const target = bag.target as VecIn;
    w.u(target === undefined ? 0 : 1);
    w.v3(vec(target));
    const declared = bag.shadow as Parameters<typeof resolveShadowOptions3D>[0];
    const options = declared === undefined ? null : resolveShadowOptions3D(declared);
    w.u(options ? 1 : 0);
    w.f(options?.softness);
    w.f(options?.extent);
    w.f(bag.width as number | undefined);
    w.f(bag.height as number | undefined);
    writeTransform(w, t);
}

function writeCamera(w: Writer, c: CameraData3D): void {
    w.u(c.type === "orthographic" ? 1 : 0);
    const placement = resolveCameraPlacement(c);
    writeTransform(w, { ...c, position: placement.position, lookAt: placement.lookAt });
    w.f(c.type === "perspective" ? c.fov : undefined);
    w.f(c.zoom);
    w.f(c.type === "orthographic" ? c.frustumHeight : undefined);
    w.f(c.near);
    w.f(c.far);
    w.f(c.distance);
}

/**
 * Encodes a recorded scene. `report` collects what will not draw. With
 * `geometries`, geometry goes by reference to defs the renderer keeps (pass
 * the same table every frame of one renderer scene); without, inline.
 */
export function encodeScene3D(
    scene: Scene3D,
    report: EncodeReport = { unsupported: new Set() },
    textures?: TextureTable,
    geometries?: GeometryTable,
): Uint32Array {
    const w = new Writer();
    geometries?.begin();
    // The node scopes the ops sit in (core puts the node id on a push's `key`).
    const scopes: string[] = [""];
    const geometry = (g: Geometry3D, kind: string) => {
        if (!geometries) return writeGeometry(w, g, report);
        w.u(16);
        w.u(geometries.ref(g, scopes[scopes.length - 1], kind, report));
    };
    w.u(MAGIC);
    w.u(VERSION);

    const tone = scene.toneSettings();
    w.u(TONE[tone?.mapping ?? "aces"] ?? 4);
    w.f(tone?.exposure);
    const shadows = scene.shadowSettings();
    w.u(shadows?.enabled === true ? 1 : 0);
    w.u(shadows?.quality === "low" ? 0 : shadows?.quality === "high" ? 2 : 1);
    const fog = scene.fogDescriptor();
    w.u(!fog ? 0 : fog.density !== undefined ? 2 : 1);
    w.color(fog?.color);
    w.f(fog?.near);
    w.f(fog?.far);
    w.f(fog?.density);
    const env = scene.environmentDescriptor();
    w.u(env?.preset === "studio" ? 1 : 0);
    w.f(env?.intensity);
    w.u(env?.background ? 1 : 0);
    w.f(env?.blur);
    if (scene.postEffects().length > 0) report.unsupported.add("post");

    const ops = scene.ops();
    w.u(ops.length);
    for (const op of ops) {
        switch (op.kind) {
            case "push": {
                const key = (op.transform as { key?: unknown } | undefined)?.key;
                scopes.push(key === undefined ? `${scopes[scopes.length - 1]}/${scopes.length}` : String(key));
                w.u(1); writeTransform(w, op.transform);
                break;
            }
            case "pop": if (scopes.length > 1) scopes.pop(); w.u(2); break;
            case "light":
                w.u(3); writeLight(w, op.light, op.transform);
                break;
            case "camera": w.u(4); writeCamera(w, op.camera); break;
            case "mesh": {
                w.u(5);
                geometry(op.geometry, op.kind);
                const list = Array.isArray(op.material) ? (op.material as readonly Material3D[]) : [op.material as Material3D];
                w.u(Array.isArray(op.material) ? list.length : 1);
                for (const m of list) writeMaterial(w, m, report, textures);
                writeTransform(w, op.transform);
                break;
            }
            case "instances": {
                w.u(6);
                geometry(op.geometry, op.kind);
                writeMaterial(w, op.material, report, textures);
                writeTransform(w, op.transform);
                w.u(op.instances.length);
                for (const t of op.instances) writeTransform(w, t);
                const colors = op.colors ?? [];
                w.u(colors.length);
                for (const c of colors) {
                    const [r, g, b, a] = typeof c === "string" ? parseColor(c) : (c as readonly number[]);
                    w.f(r); w.f(g); w.f(b); w.f(a ?? 1);
                }
                break;
            }
            case "points":
                w.u(7); geometry(op.geometry, op.kind); writeMaterial(w, op.material, report, textures);
                writeTransform(w, op.transform);
                break;
            case "line":
                w.u(8); geometry(op.geometry, op.kind); writeMaterial(w, op.material, report, textures);
                w.u(op.mode === "segments" ? 1 : op.mode === "loop" ? 2 : 0);
                writeTransform(w, op.transform);
                break;
            case "sprite":
                w.u(9); writeMaterial(w, op.material, report, textures); writeTransform(w, op.transform);
                break;
            case "model":
                report.unsupported.add("model");
                w.u(10); writeTransform(w, op.transform);
                break;
        }
    }
    if (geometries) geometries.end(w);
    else w.u(0);
    return w.result();
}
