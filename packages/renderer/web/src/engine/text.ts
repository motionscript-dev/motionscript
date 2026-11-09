// core's two text questions (measureText, layoutTextBlock) answered by ms-text,
// the same shaper the renderer draws with, on the main thread.

import { type FontStyle, type Size2D, type TextBlockLayout, type TextState, withTextDescriptor } from "@motionscript/core";
import { MsText } from "../../pkg/ms_renderer.js";
import type { WgpuStorageAdapter } from "./storage";

const SLANT: Record<string, number> = { normal: 0, italic: 1, oblique: 2 };
const ALIGN: Record<string, number> = { left: 0, right: 1, center: 2, justify: 3, start: 4, end: 5 };
const VALIGN: Record<string, number> = { top: 0, center: 1, bottom: 2 };

/** One ms-text engine per storage adapter, fed the same fonts its renderers get. */
const shapers = new WeakMap<WgpuStorageAdapter, MsText>();

export function shaperFor(storage: WgpuStorageAdapter): MsText {
    let ms = shapers.get(storage);
    if (!ms) {
        const shaper = (ms = new MsText());
        for (const f of storage.fonts) shaper.register_font(f.bytes, f.family);
        storage.onFont((f) => shaper.register_font(f.bytes, f.family));
        shapers.set(storage, shaper);
    }
    return ms;
}

export function measureText(ms: MsText, text: string, fontSize: number, fontFamily: string, fontWeight = 400, letterSpacing = 0, fontStyle?: FontStyle): Size2D {
    const [width, height] = ms.measure_text(text, fontSize, fontFamily, fontWeight, letterSpacing, SLANT[fontStyle ?? "normal"] ?? 0);
    return { width, height };
}

type Any = Record<string, any>;

/** layoutTextBlock: null for text on a path and for segments with a transform. */
export function layoutTextBlock(ms: MsText, state: Partial<TextState>): TextBlockLayout | null {
    const f = withTextDescriptor(state as never) as Any;
    if (f.path != null) return null;
    const autofit = f.fontSize === "autofit";
    const base = { text: String(f.text ?? ""), fontFamily: f.fontFamily, fontSize: autofit ? 100 : f.fontSize, fontWeight: f.fontWeight, fontStyle: f.fontStyle, letterSpacing: f.letterSpacing };
    const segments: Any[] = Array.isArray(f.segments) && f.segments.length ? f.segments : [base];
    if (segments.some((s) => (s.x ?? 0) !== 0 || (s.y ?? 0) !== 0 || (s.rotation ?? 0) !== 0 || (s.scale ?? 1) !== 1)) return null;
    const families: string[] = [];
    const runs: number[] = [];
    let text = "";
    for (const s of segments) {
        const family = s.fontFamily ?? base.fontFamily ?? "";
        let fi = families.indexOf(family);
        if (fi < 0) fi = families.push(family) - 1;
        const t = String(s.text ?? "");
        text += t;
        runs.push(t.length, s.fontSize ?? base.fontSize, s.fontWeight ?? base.fontWeight ?? 400, SLANT[s.fontStyle ?? base.fontStyle ?? "normal"] ?? 0, s.letterSpacing ?? base.letterSpacing ?? 0, fi);
    }
    const width = f.width ?? 0, height = f.height ?? 0;
    const flat = ms.text_block(
        text, new Float32Array(runs), families.join("\n"),
        autofit ? NaN : base.fontSize, f.minFontSize ?? 0, f.lineHeight ?? 0,
        ALIGN[f.textAlign ?? "center"] ?? 2, VALIGN[f.verticalAlign ?? "center"] ?? 1,
        !!f.wrap && width > 0, width, height,
    );
    if (!flat.length) return null;
    const lines: TextBlockLayout["lines"] = [];
    let k = 3;
    for (let i = 0; i < flat[2]; i++) {
        const [start, end, top, bottom, n] = flat.subarray(k, k + 5);
        lines.push({ start, end, top, bottom, carets: Array.from(flat.subarray(k + 5, k + 5 + n)) });
        k += 5 + n;
    }
    return { lines, width: flat[0], height: flat[1] };
}
