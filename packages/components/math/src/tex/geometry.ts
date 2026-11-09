
import { PathCommand } from '@motionscript/sdk';

import { createBoundedCache } from '../kit/cache';

// --- MathJax, on demand ---

type MathJaxRuntime = typeof import('./mathjax');

let runtime: MathJaxRuntime | null = null;
let loading: Promise<void> | null = null;
// MathJax's DOM, a real one or its own DOM-free tree: read only through its accessors, so its element type is opaque here.
let adaptor: any = null;

/**
 * The asset key a node that typesets declares its loader under: the host waits
 * for it before laying the node out, and a scene with no formula never loads it.
 */
export const MATHJAX_LOADER = 'math:mathjax';

/** Load MathJax, once. A host that typesets outside a scene (a tool, a test) awaits this first. */
export function loadMathJax(): Promise<void> {
    loading ??= import('./mathjax').then((module) => {
        runtime = module;
        adaptor = module.adaptor;
    });
    return loading;
}

/** Whether MathJax has loaded, so a formula can be typeset now. */
export function mathJaxLoaded(): boolean {
    return runtime !== null;
}

/** What a formula is before MathJax has loaded: nothing to draw, and nothing cached. */
export function blankLatex(): LatexPathResult {
    return { tokens: [], parts: [], commands: [], width: 0, height: 0, bounds: [0, 0, 0, 0] };
}

/** MathJax is not loaded yet: what typesetting throws before {@link loadMathJax} has resolved. */
export class LatexNotLoaded extends Error {
    constructor() {
        super('MathJax is not loaded: declare the math:mathjax loader, or await loadMathJax(), before typesetting.');
        this.name = 'LatexNotLoaded';
    }
}

// --- Public API ---

/**
 * A formula MathJax could not typeset.
 *
 * MathJax does not throw on malformed TeX. It typesets an error box in place of
 * the formula and tags it `data-mjx-error`, so the failure arrives as a drawing:
 * nothing at all from the browser adaptor and a filled bar from the DOM-free
 * one, which left a host able to tell a bad formula from a blank one only by the
 * token count. {@link buildLatexPath} raises this instead, the same way under
 * both adaptors. `\require` is an error too, since only the packages named above
 * are loaded.
 */
export class LatexError extends Error {
    /** The formula that failed, as it was given. */
    readonly latex: string;
    /** MathJax's own description of what is wrong with it. */
    readonly reason: string;

    constructor(latex: string, reason: string) {
        super(`Cannot typeset "${latex}": ${reason}`);
        this.name = 'LatexError';
        this.latex = latex;
        this.reason = reason;
    }
}

/** A single rendered glyph or shape with its character key and path commands. */
export interface LatexToken {
    /** Character this token represents, or a synthetic key for non-glyph shapes. */
    token: string;
    path: PathCommand[];
    /** The source of the top-level term the token belongs to, `a^2` in `a^2 + b^2`; empty for none. */
    term?: string;
}

/**
 * A piece of a formula as its source wrote it: `x^2`, `\frac{d}{dx}`, a lone
 * `+`. Every group the typesetter makes is one, so parts nest.
 */
export interface LatexPart {
    /** The part's own source. */
    latex: string;
    /** The tokens it draws, as a span of the formula's token list: `from` up to, not including, `to`. */
    from: number;
    to: number;
    /** The index of the part it sits in, or -1 at the top. */
    parent: number;
}

export interface LatexPathResult {
    /** All tokens in render order. */
    tokens: LatexToken[];
    /** Every part of the formula, outermost first, in source order. */
    parts: LatexPart[];
    /** Flat array of all path commands (for legacy single-path rendering). */
    commands: PathCommand[];
    width: number;
    height: number;
    /**
     * Bounding box over every token, in token coordinate space:
     * [minX, minY, maxX, maxY]. All tokens share this frame, so passing it as
     * each path's center frame keeps their relative layout (instead of each
     * glyph centering on its own bbox).
     */
    bounds: [number, number, number, number];
}

/**
 * A formula's glyph geometry, before a type size is applied to it.
 *
 * The dividing line this whole module's caching turns on. Getting here is the
 * expensive part — MathJax lays the formula out, then the SVG it produces is
 * parsed, its glyph dictionary resolved and every `<use>` walked through its
 * transform stack — and **none of it depends on `fontSize`**: `mjDoc.convert`
 * is called at a fixed em/ex, and the size arrives at the very end as one
 * uniform scale (see {@link scaleLatexGeometry}).
 *
 * So this is what gets remembered per formula, and the size is applied to it
 * afresh. A formula animating from 24pt to 120pt is one trip through MathJax
 * and one DOM parse, not one per frame.
 */
interface LatexGeometry {
    tokens: RawToken[];
    parts: LatexPart[];
    /** Box over every command, in the SVG's own coordinates. */
    box: { minX: number; minY: number; maxX: number; maxY: number };
    /** The formula's height in `ex`, as MathJax reported it. */
    heightEx: number;
}

/**
 * Formulas already worked out, and formulas already sized.
 *
 * `buildLatexPath` is a pure function of `(text, fontSize)` and used to have no
 * memory, which made every caller pay full price for a question it had already
 * asked. The callers are not occasional about it either: constructing a `Latex`
 * resolves its formula, and so does every `to({ latex })` the moment it starts,
 * so a scene re-resolves every formula in it whenever it is rebuilt *and*
 * whenever the playhead moves backwards, since a backward seek replays the
 * scene's generator from its first frame. An editor that rebuilds on a keystroke
 * and seeks on a click asks for the same handful of formulas hundreds of times.
 *
 * Two memos, each keyed by what its stage actually depends on, and deliberately
 * different sizes:
 *
 * - {@link geometryCache} is everything up to the type size, keyed by the text
 *   alone. This is the expensive one, and it is generously sized because
 *   nothing a scene does can churn it: a deck holds as many distinct formulas
 *   as it holds, and it holds them for as long as it is open.
 * - {@link pathCache} is the finished result, keyed by text *and* size. Small
 *   on purpose: an animated `fontSize` inserts a distinct key every frame, and
 *   the right thing for a stream like that is to churn a little memo rather
 *   than a big one. What a miss costs here is arithmetic over glyphs already
 *   worked out — no MathJax, no parse.
 */
const geometryCache = createBoundedCache<LatexGeometry>(128);
const pathCache = createBoundedCache<LatexPathResult>(64);

export function buildLatexPath(text: string, fontSize: number): LatexPathResult {
    // NUL rather than a punctuation separator, so no formula can spell a key
    // belonging to another size.
    const key = `${fontSize}\0${text}`;

    const hit = pathCache.get(key);
    if (hit) return lend(hit);

    let geometry = geometryCache.get(text);
    if (!geometry) {
        geometry = buildLatexGeometry(text);
        geometryCache.set(text, geometry);
    }

    const result = scaleLatexGeometry(geometry, fontSize);
    pathCache.set(key, result);
    return lend(result);
}

/** Typeset `text` and reduce the SVG MathJax returns to glyph geometry. */
function buildLatexGeometry(text: string): LatexGeometry {
    if (!runtime) throw new LatexNotLoaded();
    const svgEl = adaptor.firstChild(runtime.convert(text));
    const failure = mathJaxError(svgEl);
    if (failure !== null) throw new LatexError(text, failure);

    const heightAttr = adaptor.getAttribute(svgEl, 'height') ?? '';

    return parseLatexSvg(svgEl, parseFloat(heightAttr) || 0);
}

/**
 * MathJax's description of the error box in a typeset formula, or `null` when
 * there is none. Read through the adaptor, so a real DOM and the DOM-free tree
 * give the same answer.
 */
function mathJaxError(svgEl: unknown): string | null {
    for (const el of adaptor.tags(svgEl, 'g') as unknown[]) {
        const reason = adaptor.getAttribute(el, 'data-mjx-error');
        if (reason !== null && reason !== undefined) return String(reason) || 'unknown error';
    }
    return null;
}

/**
 * A cached result, handed out safely.
 *
 * `tokens`, `commands` and the path arrays inside them are shared: they are read
 * by everything downstream and written by none of it — `Latex` maps tokens into
 * its own wrappers, and the morph builds new paths rather than editing the ones
 * it is given — so copying them would be copying the whole formula for nothing.
 *
 * `bounds` is copied, because it is the one field a caller *stores*: `Latex`
 * assigns `result.bounds` straight to `this._bounds` and hands it to the
 * renderer as a shared centring frame. That was one node holding its own array
 * before there was a memo, and would be two nodes drawing the same formula
 * holding one array between them after — four numbers is not a price worth
 * paying to find out whether anything downstream ever writes to it.
 */
function lend(result: LatexPathResult): LatexPathResult {
    const [minX, minY, maxX, maxY] = result.bounds;
    return { ...result, bounds: [minX, minY, maxX, maxY] };
}

// --- High-Speed Matrix Math ---

type Matrix = [number, number, number, number, number, number]; // [a, b, c, d, tx, ty]
const identityMatrix: Matrix = [1, 0, 0, 1, 0, 0];

function multiplyMatrix(m1: Matrix, m2: Matrix): Matrix {
    return [
        m1[0] * m2[0] + m1[2] * m2[1],
        m1[1] * m2[0] + m1[3] * m2[1],
        m1[0] * m2[2] + m1[2] * m2[3],
        m1[1] * m2[2] + m1[3] * m2[3],
        m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
        m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
    ];
}

function parseTransform(str: string | null): Matrix {
    if (!str) return identityMatrix;
    let m: Matrix = [...identityMatrix];
    const re = /([a-z]+)\(([^)]+)\)/g;
    let match;
    while ((match = re.exec(str)) !== null) {
        const type = match[1];
        const args = match[2].split(/[ ,]+/).map(parseFloat);
        if (type === 'translate') {
            m = multiplyMatrix(m, [1, 0, 0, 1, args[0] || 0, args[1] || 0]);
        } else if (type === 'scale') {
            const sx = args[0] || 1;
            const sy = args[1] !== undefined ? args[1] : sx;
            m = multiplyMatrix(m, [sx, 0, 0, sy, 0, 0]);
        } else if (type === 'matrix') {
            m = multiplyMatrix(m, [args[0], args[1], args[2], args[3], args[4], args[5]]);
        }
    }
    return m;
}

function applyMatrix(x: number, y: number, m: Matrix): [number, number] {
    return [
        x * m[0] + y * m[2] + m[4],
        x * m[1] + y * m[3] + m[5],
    ];
}

// --- Glyph ID → character decoding ---

/**
 * MathJax SVG glyph IDs look like "MJX-1-TEX-N-78" or "MJX-1-TEX-I-1D465".
 * The last segment is the Unicode codepoint in hex.
 */
function glyphIdToChar(id: string): string {
    const parts = id.split('-');
    const hex = parts[parts.length - 1];
    const cp = parseInt(hex, 16);
    if (!isNaN(cp)) {
        try { return String.fromCodePoint(cp); } catch { /* fall through */ }
    }
    return id;
}

// --- Core Fast Traversal Engine ---

type RawToken = { token: string; cmds: Array<{ cmd: string; args: number[] }>; term?: string };

/** The tag name of a node's parent, or "" at the root. */
function parentKind(node: unknown): string {
    const parent = adaptor.parent(node);
    return parent ? String(adaptor.kind(parent)).toLowerCase() : "";
}

/**
 * The size-independent half: MathJax's own SVG tree in, glyph geometry out.
 *
 * Walked through the **adaptor** rather than a `DOMParser`. MathJax already
 * builds this tree, and the adaptor is its own abstraction over "a real DOM" and
 * "the DOM-free `LiteElement` tree" — the two this module already picks between
 * at load. Serialising it to a string and parsing it back needed a `DOMParser`,
 * which Node does not have, so every LaTeX node threw `DOMParser is not defined`
 * and could not render headlessly at all: no export, and nothing the visual
 * suite could check.
 *
 * Reading the tree directly is also one representation instead of three (tree →
 * string → tree), so a browser and a headless host cannot disagree about how the
 * markup re-parsed.
 */
function parseLatexSvg(svgEl: unknown, heightEx: number): LatexGeometry {
    // Pre-parse the glyph dictionary. `tags` reaches every <path> in the tree,
    // including the ones inside <defs> that the `use` elements reference.
    const glyphMap = new Map<string, Array<{ cmd: string; args: number[] }>>();
    for (const el of adaptor.tags(svgEl, 'path') as unknown[]) {
        const id = adaptor.getAttribute(el, 'id');
        const d = adaptor.getAttribute(el, 'd');
        if (id && d) {
            glyphMap.set(`#${id}`, expandToAbsolute(tokenisePath(d)));
        }
    }

    // Collect raw tokens — each <use> is one token, rects/paths are grouped as synthetic tokens
    const rawTokens: RawToken[] = [];
    const parts: LatexPart[] = [];
    let synthIdx = 0;

    function pushCmds(token: string, cmds: Array<{ cmd: string; args: number[] }>) {
        rawTokens.push({ token, cmds });
    }

    function traverse(node: unknown, currentMatrix: Matrix, within: number) {
        let nodeMatrix = currentMatrix;

        const transformStr = adaptor.getAttribute(node, "transform");
        if (transformStr) {
            nodeMatrix = multiplyMatrix(nodeMatrix, parseTransform(transformStr));
        }

        const nodeName = String(adaptor.kind(node)).toLowerCase();

        // MathJax tags each group with the source it typeset; the root's is the whole formula.
        let part = within;
        const source = nodeName === "g" ? adaptor.getAttribute(node, "data-latex") : null;
        if (source && adaptor.getAttribute(node, "data-mml-node") !== "math") {
            part = parts.length;
            parts.push({ latex: String(source), from: rawTokens.length, to: rawTokens.length, parent: within });
        }

        if (nodeName === "use") {
            const href = adaptor.getAttribute(node, "href") || adaptor.getAttribute(node, "xlink:href");
            const x = parseFloat(adaptor.getAttribute(node, "x") || "0");
            const y = parseFloat(adaptor.getAttribute(node, "y") || "0");

            if (href && glyphMap.has(href)) {
                const glyphCommands = glyphMap.get(href)!;
                const cmds: Array<{ cmd: string; args: number[] }> = [];
                for (const gc of glyphCommands) {
                    const shiftedArgs = [...gc.args];
                    for (let j = 0; j < shiftedArgs.length; j += 2) {
                        const [nx, ny] = applyMatrix(shiftedArgs[j] + x, shiftedArgs[j + 1] + y, nodeMatrix);
                        shiftedArgs[j] = nx;
                        shiftedArgs[j + 1] = ny;
                    }
                    cmds.push({ cmd: gc.cmd, args: shiftedArgs });
                }
                // Derive character from glyph ID
                const rawId = href.startsWith('#') ? href.slice(1) : href;
                pushCmds(glyphIdToChar(rawId), cmds);
            }
        } else if (nodeName === "rect") {
            const x = parseFloat(adaptor.getAttribute(node, "x") || "0");
            const y = parseFloat(adaptor.getAttribute(node, "y") || "0");
            const w = parseFloat(adaptor.getAttribute(node, "width") || "0");
            const h = parseFloat(adaptor.getAttribute(node, "height") || "0");

            if (w > 0 && h > 0) {
                const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
                const tp = pts.map(p => applyMatrix(p[0], p[1], nodeMatrix));
                pushCmds(`__rect_${synthIdx++}`, [
                    { cmd: 'M', args: [tp[0][0], tp[0][1]] },
                    { cmd: 'L', args: [tp[1][0], tp[1][1]] },
                    { cmd: 'L', args: [tp[2][0], tp[2][1]] },
                    { cmd: 'L', args: [tp[3][0], tp[3][1]] },
                    { cmd: 'Z', args: [] },
                ]);
            }
        } else if (nodeName === "path" && parentKind(node) !== "defs") {
            const d = adaptor.getAttribute(node, "d");
            if (d) {
                const abs = expandToAbsolute(tokenisePath(d));
                const cmds: Array<{ cmd: string; args: number[] }> = [];
                for (const gc of abs) {
                    const shiftedArgs = [...gc.args];
                    for (let j = 0; j < shiftedArgs.length; j += 2) {
                        const [nx, ny] = applyMatrix(shiftedArgs[j], shiftedArgs[j + 1], nodeMatrix);
                        shiftedArgs[j] = nx;
                        shiftedArgs[j + 1] = ny;
                    }
                    cmds.push({ cmd: gc.cmd, args: shiftedArgs });
                }
                pushCmds(`__path_${synthIdx++}`, cmds);
            }
        }

        for (const child of adaptor.childNodes(node) as unknown[]) {
            // A text node's kind is "#text"; only elements carry geometry, and
            // <defs> holds the dictionary rather than anything drawn.
            const kind = String(adaptor.kind(child)).toLowerCase();
            if (kind.startsWith("#") || kind === "defs") continue;
            traverse(child, nodeMatrix, part);
        }
        if (part !== within) parts[part].to = rawTokens.length;
    }

    traverse(svgEl, identityMatrix, -1);

    for (const part of parts) {
        if (part.parent !== -1) continue;
        for (let i = part.from; i < part.to; i++) rawTokens[i].term = part.latex;
    }

    // Bounding box across all raw commands, in the SVG's own coordinates.
    const box = svgBBox(rawTokens.flatMap(t => t.cmds));
    return { tokens: rawTokens, parts, box, heightEx };
}

/**
 * The size-dependent half: glyph geometry in, a laid-out formula out.
 *
 * Everything here is one uniform scale about the geometry's own centre, which
 * is exactly why {@link LatexGeometry} is worth remembering on its own.
 */
function scaleLatexGeometry(geometry: LatexGeometry, fontSize: number): LatexPathResult {
    const { tokens: rawTokens, parts, box, heightEx } = geometry;
    if (rawTokens.length === 0) return { tokens: [], parts: [], commands: [], width: 0, height: 0, bounds: [0, 0, 0, 0] };

    const { minX, minY, maxX, maxY } = box;
    const svgW = maxX - minX;
    const svgH = maxY - minY;

    let scale: number;
    if (heightEx > 0 && svgH > 0) {
        const exInCoords = svgH / heightEx;
        scale = fontSize / (2 * exInCoords);
    } else {
        scale = svgH > 0 ? fontSize / svgH : 1;
    }

    const ocx = (minX + maxX) / 2;
    const ocy = (minY + maxY) / 2;

    const tx = (svgX: number) => (svgX - ocx) * scale;
    const ty = (svgY: number) => (svgY - ocy) * scale;

    function rawCmdsToPathCommands(cmds: Array<{ cmd: string; args: number[] }>): PathCommand[] {
        const out: PathCommand[] = [];
        for (const { cmd, args: a } of cmds) {
            switch (cmd) {
                case 'M': out.push({ type: 'M', x: tx(a[0]), y: ty(a[1]) }); break;
                case 'L': out.push({ type: 'L', x: tx(a[0]), y: ty(a[1]) }); break;
                case 'Q': out.push({ type: 'Q', x1: tx(a[0]), y1: ty(a[1]), x: tx(a[2]), y: ty(a[3]) }); break;
                case 'C': out.push({ type: 'C', x1: tx(a[0]), y1: ty(a[1]), x2: tx(a[2]), y2: ty(a[3]), x: tx(a[4]), y: ty(a[5]) }); break;
                case 'Z': out.push({ type: 'Z' }); break;
            }
        }
        return out;
    }

    const tokens: LatexToken[] = rawTokens.map(rt => ({
        token: rt.token,
        path: rawCmdsToPathCommands(rt.cmds),
        ...(rt.term !== undefined && { term: rt.term }),
    }));

    const commands = tokens.flatMap(t => t.path);

    // Shared center frame for all tokens, in token coordinate space. tx/ty map
    // the SVG bbox corners; this is the frame every token's path is laid out in.
    const bounds: [number, number, number, number] = [
        tx(minX), ty(minY), tx(maxX), ty(maxY),
    ];

    return { tokens, parts, commands, width: svgW * scale, height: svgH * scale, bounds };
}

// --- Parts ---

// Spacing and grouping braces are how a source is written, not what it says:
// `x^{2}` and `x^2` name one part.
function partKey(latex: string): string {
    return latex.replace(/[\s{}]/g, "");
}

/**
 * The sources of a formula's parts, each once, in the order written: what a
 * host offers to pick a part from. Empty for a formula that will not typeset.
 */
export function latexPartNames(source: string): string[] {
    if (source.trim() === "") return [];
    let parts: LatexPart[];
    try {
        parts = buildLatexPath(source, 16).parts;
    } catch {
        return [];
    }
    const seen = new Set<string>();
    const names: string[] = [];
    for (const part of parts) {
        const key = partKey(part.latex);
        if (part.to <= part.from || key === "" || seen.has(key)) continue;
        seen.add(key);
        names.push(part.latex);
    }
    return names;
}

/**
 * The token spans `selector` names in a formula, in source order: every part
 * whose source it is, and every run of neighbouring parts that spell it
 * together (`b^2 = c^2` in `a^2 + b^2 = c^2`). Empty when it names nothing.
 */
export function findLatexParts(parts: readonly LatexPart[], selector: string): Array<[from: number, to: number]> {
    const wanted = partKey(selector);
    if (wanted === "") return [];
    const found = new Map<string, [number, number]>();
    const keep = (from: number, to: number) => {
        if (to > from) found.set(`${from}:${to}`, [from, to]);
    };
    const children = new Map<number, number[]>();
    parts.forEach((part, i) => {
        if (partKey(part.latex) === wanted) keep(part.from, part.to);
        const siblings = children.get(part.parent);
        if (siblings) siblings.push(i);
        else children.set(part.parent, [i]);
    });
    for (const siblings of children.values()) {
        for (let a = 0; a < siblings.length; a++) {
            let spelled = "";
            for (let b = a; b < siblings.length && spelled.length < wanted.length; b++) {
                spelled += partKey(parts[siblings[b]].latex);
                if (b > a && spelled === wanted) keep(parts[siblings[a]].from, parts[siblings[b]].to);
            }
        }
    }
    return [...found.values()].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

// --- SVG Path Utilities ---

type RawCmd = { cmd: string; args: number[] };

function tokenisePath(d: string): RawCmd[] {
    const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
    const out: RawCmd[] = [];
    let cur: RawCmd | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(d)) !== null) {
        if (m[1]) { cur = { cmd: m[1], args: [] }; out.push(cur); }
        else if (cur) cur.args.push(parseFloat(m[2]));
    }
    return out;
}

function argCount(cmd: string): number {
    switch (cmd.toUpperCase()) {
        case 'M': return 2; case 'L': return 2; case 'H': return 1; case 'V': return 1;
        case 'C': return 6; case 'S': return 4; case 'Q': return 4; case 'T': return 2;
        case 'A': return 7; case 'Z': return 0; default: return 0;
    }
}

interface Pt { x: number; y: number }

function expandToAbsolute(raw: RawCmd[]): Array<{ cmd: string; args: number[] }> {
    const out: Array<{ cmd: string; args: number[] }> = [];
    let cx = 0, cy = 0;
    let mx = 0, my = 0;
    let prevCmd = '';
    let prevCtrl: Pt = { x: 0, y: 0 };

    for (const { cmd, args } of raw) {
        const up = cmd.toUpperCase();
        const rel = cmd === cmd.toLowerCase() && up !== 'Z';
        const n = argCount(up);
        const reps = n === 0 ? 1 : Math.max(1, Math.ceil(args.length / n));

        for (let r = 0; r < reps; r++) {
            const a = args.slice(r * n, r * n + n);
            const absX = (i: number) => rel ? a[i] + cx : a[i];
            const absY = (i: number) => rel ? a[i] + cy : a[i];

            switch (up) {
                case 'M': {
                    const x = absX(0), y = absY(1);
                    const emitCmd = r === 0 ? 'M' : 'L';
                    out.push({ cmd: emitCmd, args: [x, y] });
                    cx = x; cy = y;
                    if (r === 0) { mx = x; my = y; }
                    prevCmd = emitCmd;
                    prevCtrl = { x: cx, y: cy };
                    break;
                }
                case 'Z':
                    out.push({ cmd: 'Z', args: [] });
                    cx = mx; cy = my;
                    prevCmd = 'Z';
                    break;
                case 'L': {
                    const x = absX(0), y = absY(1);
                    out.push({ cmd: 'L', args: [x, y] });
                    cx = x; cy = y;
                    prevCmd = 'L';
                    prevCtrl = { x: cx, y: cy };
                    break;
                }
                case 'H': {
                    const x = rel ? a[0] + cx : a[0];
                    out.push({ cmd: 'L', args: [x, cy] });
                    cx = x;
                    prevCmd = 'L';
                    prevCtrl = { x: cx, y: cy };
                    break;
                }
                case 'V': {
                    const y = rel ? a[0] + cy : a[0];
                    out.push({ cmd: 'L', args: [cx, y] });
                    cy = y;
                    prevCmd = 'L';
                    prevCtrl = { x: cx, y: cy };
                    break;
                }
                case 'C': {
                    const x1 = absX(0), y1 = absY(1);
                    const x2 = absX(2), y2 = absY(3);
                    const x = absX(4), y = absY(5);
                    out.push({ cmd: 'C', args: [x1, y1, x2, y2, x, y] });
                    prevCtrl = { x: x2, y: y2 };
                    cx = x; cy = y;
                    prevCmd = 'C';
                    break;
                }
                case 'S': {
                    const x1 = prevCmd === 'C' || prevCmd === 'S' ? 2 * cx - prevCtrl.x : cx;
                    const y1 = prevCmd === 'C' || prevCmd === 'S' ? 2 * cy - prevCtrl.y : cy;
                    const x2 = absX(0), y2 = absY(1);
                    const x = absX(2), y = absY(3);
                    out.push({ cmd: 'C', args: [x1, y1, x2, y2, x, y] });
                    prevCtrl = { x: x2, y: y2 };
                    cx = x; cy = y;
                    prevCmd = 'S';
                    break;
                }
                case 'Q': {
                    const x1 = absX(0), y1 = absY(1);
                    const x = absX(2), y = absY(3);
                    out.push({ cmd: 'Q', args: [x1, y1, x, y] });
                    prevCtrl = { x: x1, y: y1 };
                    cx = x; cy = y;
                    prevCmd = 'Q';
                    break;
                }
                case 'T': {
                    const x1 = prevCmd === 'Q' || prevCmd === 'T' ? 2 * cx - prevCtrl.x : cx;
                    const y1 = prevCmd === 'Q' || prevCmd === 'T' ? 2 * cy - prevCtrl.y : cy;
                    const x = absX(0), y = absY(1);
                    out.push({ cmd: 'Q', args: [x1, y1, x, y] });
                    prevCtrl = { x: x1, y: y1 };
                    cx = x; cy = y;
                    prevCmd = 'T';
                    break;
                }
            }
        }
    }

    if (out.length > 0 && out[out.length - 1].cmd !== 'Z') {
        out.push({ cmd: 'Z', args: [] });
    }

    return out;
}

function svgBBox(abs: Array<{ cmd: string; args: number[] }>): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const touch = (x: number, y: number) => {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
    };
    for (const { cmd, args } of abs) {
        switch (cmd) {
            case 'M': case 'L': touch(args[0], args[1]); break;
            case 'C': touch(args[0], args[1]); touch(args[2], args[3]); touch(args[4], args[5]); break;
            case 'Q': touch(args[0], args[1]); touch(args[2], args[3]); break;
        }
    }
    return { minX, minY, maxX, maxY };
}
