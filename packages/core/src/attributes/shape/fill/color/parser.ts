/**
 * CSS colour string -> normalized [R, G, B, A] tuple (0-1, for GPU uniforms). Accepts named colours (CSS plus theme
 * aliases via {@link setTheme}), hex, rgb/hsl, lab/lch, oklab/oklch and a Tailwind-style opacity suffix (`"white/10"`).
 * No DOM, no `getComputedStyle`.
 */

import { CSS_COLOR_MAP } from './constants';

/** Normalized RGBA color: `[red, green, blue, alpha]` each in the 0–1 range. */
export type NormalizedColor = [number, number, number, number];

/** Loose color input accepted by prop interfaces — CSS string or pre-normalized tuple. */
export type Color = string | NormalizedColor;

function gammaEncode(c: number): number {
    c = Math.max(0, Math.min(1, c));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function linearToSrgb(r: number, g: number, b: number, a: number): NormalizedColor {
    return [gammaEncode(r), gammaEncode(g), gammaEncode(b), a];
}

/** Bradford-adapted XYZ D65 → linear-light sRGB matrix (IEC 61966-2-1). */
function xyzD65ToLinearSrgb(X: number, Y: number, Z: number): [number, number, number] {
    return [
        3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
        -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z,
        0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
    ];
}

/** Splits a colour function's inner content into three channel tokens and an alpha (slash or legacy comma form, via {@link readAlpha}). `null` on a wrong argument count or non-numeric alpha. */
function parseArgs(inner: string): { tokens: string[]; alpha: number } | null {
    const slashIdx = inner.lastIndexOf('/');
    let alphaToken: string | undefined;
    let colorPart = inner;
    if (slashIdx !== -1) {
        alphaToken = inner.slice(slashIdx + 1).trim();
        colorPart = inner.slice(0, slashIdx);
    }
    const tokens = colorPart.trim().split(/[\s,]+/).filter(Boolean);
    if (tokens.length === 4 && alphaToken === undefined) alphaToken = tokens.pop();
    if (tokens.length !== 3) return null;
    const alpha = alphaToken === undefined ? 1 : readAlpha(alphaToken);
    if (!Number.isFinite(alpha)) return null;
    return { tokens, alpha };
}

/** Reads an alpha token: a number, or a percentage (`50%` is 0.5). `NaN` if neither. */
function readAlpha(token: string): number {
    return token.endsWith('%') ? Number(token.slice(0, -1)) / 100 : Number(token);
}

/** Reads a channel token as a number, scaling a percentage to `percentScale` and a bare number by `1 / numberScale`. `NaN` if it is not a number. */
function readChannel(token: string, percentScale: number, numberScale = 1): number {
    return token.endsWith('%') ? (Number(token.slice(0, -1)) / 100) * percentScale : Number(token) / numberScale;
}

const ANGLE_UNIT_DEGREES: Record<string, number> = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 };

/** Reads a CSS hue/angle token to degrees. A bare number is degrees; an unknown unit or a non-number is `NaN`. */
function readHue(token: string): number {
    const m = token.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/);
    if (!m) return NaN;
    return Number(m[1]) * ANGLE_UNIT_DEGREES[m[2] ?? 'deg'];
}

/** Returns `color` when every component is finite, otherwise `null` (unsupported format). */
function finiteColor(color: NormalizedColor): NormalizedColor | null {
    return color.every(Number.isFinite) ? color : null;
}

// Use a globalThis key so multiple bundled copies of this module (e.g. the
// prebuilt player bundle and the Vite-compiled user code) share one map.
const _g = globalThis as Record<string, unknown>;
if (!_g.__msThemeMap) _g.__msThemeMap = new Map<string, NormalizedColor>();
const THEME_COLOR_MAP = _g.__msThemeMap as Map<string, NormalizedColor>;

// Colours already parsed, by the string as given: a scene repeats its strings every
// frame. Shared like the theme, and cleared with it, since a name resolves through it.
if (!_g.__msParsedColors) _g.__msParsedColors = new Map<string, NormalizedColor>();
const PARSED = _g.__msParsedColors as Map<string, NormalizedColor>;

// Typography presets share the same global-map pattern so bundled copies read one registry.
if (!_g.__msTypographyMap) _g.__msTypographyMap = new Map<string, Record<string, unknown>>();
const TYPOGRAPHY_MAP = _g.__msTypographyMap as Map<string, Record<string, unknown>>;

// Structural mirror of `Theme` declared locally so this module stays a leaf (`config.ts` imports `Color` from
// here; importing `Theme` back would be a cycle). Typography presets are stored opaquely, hence the loose `object`.
type ColorTokenInput = Color | { [key: string]: ColorTokenInput };
interface ThemeInput {
    colors?: Record<string, ColorTokenInput>;
    typography?: Record<string, object>;
}

/** Flattens nested colour groups into dash-joined lowercase keys (`brand-500`), parsing each leaf. Arrays and strings are leaves. */
function flattenColors(
    tokens: Record<string, ColorTokenInput> | undefined,
    prefix: string,
    out: Map<string, NormalizedColor>,
): void {
    if (!tokens) return;
    for (const [name, token] of Object.entries(tokens)) {
        const key = prefix ? `${prefix}-${name}` : name;
        if (token != null && !Array.isArray(token) && typeof token === 'object') {
            flattenColors(token as Record<string, ColorTokenInput>, key, out);
        } else {
            const color = token as Color;
            out.set(key.toLowerCase(), Array.isArray(color) ? (color as NormalizedColor) : parseColor(color));
        }
    }
}

/**
 * Registers a project theme: named colours (usable in any colour string; they win over CSS names) and typography
 * presets (selected via `variant`). No argument, `null` or `{}` clears both, since a host reading a document's
 * optional `theme` from storage gets `null`. The `default` typography key is reserved: it is the project-wide base
 * style read by {@link applyTextDefaults}.
 *
 * @example
 * setTheme({ colors: { brand: "#ff6b35", accent: { 500: "oklch(70% 0.2 145)" } }, typography: { header: { fontSize: 96 } } });
 */
export function setTheme(input: ThemeInput | null = {}): void {
    const theme = input ?? {};
    PARSED.clear();
    THEME_COLOR_MAP.clear();
    TYPOGRAPHY_MAP.clear();
    flattenColors(theme.colors, '', THEME_COLOR_MAP);
    if (theme.typography) {
        for (const [name, preset] of Object.entries(theme.typography)) {
            // Stored opaquely; widened to the readable record shape at this boundary only.
            TYPOGRAPHY_MAP.set(name.toLowerCase(), preset as Record<string, unknown>);
        }
    }
}

/** Case-insensitive; `undefined` if none is registered. */
export function getTypographyPreset(name: string): Record<string, unknown> | undefined {
    return TYPOGRAPHY_MAP.get(name.toLowerCase());
}

function parseNamedColor(str: string): NormalizedColor | null {
    return THEME_COLOR_MAP.get(str) ?? CSS_COLOR_MAP.get(str) ?? null;
}

function parseHex(str: string): NormalizedColor | null {
    if (!str.startsWith('#')) return null;
    let hex = str.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    if (hex.length === 3 || hex.length === 4)
        hex = hex.split('').map(c => c + c).join('');
    const int = parseInt(hex, 16);
    if (hex.length === 6)
        return [(int >> 16 & 255) / 255, (int >> 8 & 255) / 255, (int & 255) / 255, 1];
    if (hex.length === 8)
        return [(int >>> 24) / 255, (int >> 16 & 255) / 255, (int >> 8 & 255) / 255, (int & 255) / 255];
    return null;
}

function parseRgb(str: string): NormalizedColor | null {
    const m = str.match(/^rgba?\s*\((.+)\)/);
    if (!m) return null;
    const args = parseArgs(m[1]);
    if (!args) return null;
    const [r, g, b] = args.tokens.map(t => readChannel(t, 1, 255));
    return finiteColor([r, g, b, args.alpha]);
}

/** Parses `hsl()` / `hsla()`. The hue takes `deg`, `grad`, `rad` or `turn` (a bare number is degrees). */
function parseHsl(str: string): NormalizedColor | null {
    const m = str.match(/^hsla?\s*\((.+)\)/);
    if (!m) return null;
    const args = parseArgs(m[1]);
    if (!args) return null;
    const h = readHue(args.tokens[0]);
    const s = parseFloat(args.tokens[1]) / 100;
    const l = parseFloat(args.tokens[2]) / 100;
    const k = (n: number) => (((n + h / 30) % 12) + 12) % 12;
    const chroma = s * Math.min(l, 1 - l);
    const f = (n: number) => l - chroma * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return finiteColor([f(0), f(8), f(4), args.alpha]);
}

/** Parses `lab(L a b)` (CIE L*a*b*, D50 white point). */
function parseLab(str: string): NormalizedColor | null {
    const m = str.match(/^lab\s*\((.+)\)/);
    if (!m) return null;
    const args = parseArgs(m[1]);
    if (!args) return null;
    const L = parseFloat(args.tokens[0]);
    const a = parseFloat(args.tokens[1]);
    const b = parseFloat(args.tokens[2]);
    return finiteColor(labToNormalized(L, a, b, args.alpha));
}

/** Parses `lch(L C H)` (CIE L*C*h°, polar form of Lab). */
function parseLch(str: string): NormalizedColor | null {
    const m = str.match(/^lch\s*\((.+)\)/);
    if (!m) return null;
    const args = parseArgs(m[1]);
    if (!args) return null;
    const L = parseFloat(args.tokens[0]);
    const C = parseFloat(args.tokens[1]);
    const rad = readHue(args.tokens[2]) * (Math.PI / 180);
    return finiteColor(labToNormalized(L, C * Math.cos(rad), C * Math.sin(rad), args.alpha));
}

function parseOklab(str: string): NormalizedColor | null {
    const m = str.match(/^oklab\s*\((.+)\)/);
    if (!m) return null;
    const args = parseArgs(m[1]);
    if (!args) return null;
    // L: 0–1 as number, or 0%–100% (100% = 1); a, b: 100% = 0.4 per CSS Color 4.
    const [L, a, b] = [readChannel(args.tokens[0], 1), readChannel(args.tokens[1], 0.4), readChannel(args.tokens[2], 0.4)];
    return finiteColor(oklabToNormalized(L, a, b, args.alpha));
}

function parseOklch(str: string): NormalizedColor | null {
    const m = str.match(/^oklch\s*\((.+)\)/);
    if (!m) return null;
    const args = parseArgs(m[1]);
    if (!args) return null;
    // L: 0–1 or percentage; C: 0–0.4 or percentage (100% = 0.4).
    const L = readChannel(args.tokens[0], 1);
    const C = readChannel(args.tokens[1], 0.4);
    const rad = readHue(args.tokens[2]) * (Math.PI / 180);
    return finiteColor(oklabToNormalized(L, C * Math.cos(rad), C * Math.sin(rad), args.alpha));
}

/** Converts CIE L*a*b* (D50) to a normalized sRGB color. */
function labToNormalized(L: number, a: number, b: number, alpha: number): NormalizedColor {
    const e = 0.008856, k = 903.3;
    const fy = (L + 16) / 116;
    const fx = a / 500 + fy;
    const fz = fy - b / 200;
    const X = (fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k) * 0.95047;
    const Y = L > k * e ? ((L + 16) / 116) ** 3 : L / k;
    const Z = (fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k) * 1.08883;
    const [lr, lg, lb] = xyzD65ToLinearSrgb(X, Y, Z);
    return linearToSrgb(lr, lg, lb, alpha);
}

/** Converts Oklab to a normalized sRGB color using the standard Björn Ottosson matrix. */
function oklabToNormalized(L: number, a: number, b: number, alpha: number): NormalizedColor {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
    return linearToSrgb(
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.6956065236 * s,
        alpha,
    );
}

/** Splits a Tailwind-style opacity suffix (`"white/10"`, percent 0-100) off a colour string. Only a slash outside parentheses counts, so `rgb(0 0 255 / 0.25)` is untouched. Returns the bare string and the opacity fraction. */
function splitOpacitySuffix(str: string): { color: string; opacity: number } {
    if (str.includes('(')) return { color: str, opacity: 1 };
    const m = str.match(/^(.*[^/])\/\s*([\d.]+)%?$/);
    if (!m) return { color: str, opacity: 1 };
    const pct = parseFloat(m[2]);
    if (!Number.isFinite(pct)) return { color: str, opacity: 1 };
    return { color: m[1].trim(), opacity: Math.max(0, Math.min(1, pct / 100)) };
}

/** Parses a CSS colour string into normalized `[R, G, B, A]`; warns and returns opaque black for unrecognised input. */
export function parseColor(cssStr: string): NormalizedColor {
    const known = PARSED.get(cssStr);
    if (known) return known;
    const { color: str, opacity } = splitOpacitySuffix(cssStr.trim().toLowerCase());
    const parsed =
        parseNamedColor(str) ??
        parseHex(str) ??
        parseRgb(str) ??
        parseHsl(str) ??
        parseLab(str) ??
        parseLch(str) ??
        parseOklab(str) ??
        parseOklch(str);
    if (!parsed) {
        console.warn(`[Motion Engine] Unsupported color format: "${cssStr}". Defaulting to black.`);
        return [0, 0, 0, 1];
    }
    // Clone before applying opacity: named/theme lookups return cached tuples.
    const color: NormalizedColor = opacity !== 1 ? [parsed[0], parsed[1], parsed[2], parsed[3] * opacity] : parsed;
    if (PARSED.size >= PARSED_MAX) PARSED.clear();
    PARSED.set(cssStr, color);
    return color;
}

const PARSED_MAX = 16384;
