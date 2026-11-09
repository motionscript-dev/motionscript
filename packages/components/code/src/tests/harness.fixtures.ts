import {
    ContextMap,
    Graphics2D,
    type Command,
    type MeasureContext2D,
    type Node,
    type RenderContext2D,
    type Size2D,
} from '@motionscript/sdk';
import { CanvasRenderContext2D, ManifestAssetCatalog, type TextState } from '@motionscript/core';
import { Code, listingOf, type CodeProps } from '../node';

/** The colour `render.ts` paints a line number in, restated: it is not exported. */
export const LINE_NUMBER_COLOR = [0.45, 0.5, 0.55, 1];

/**
 * The advance of `chars` characters in the monospaced face these tests pretend
 * to have: half an em a glyph, plus the letter spacing after each.
 */
export function advanceOf(chars: number, fontSize: number, letterSpacing = 0): number {
    return chars * (fontSize * 0.5 + letterSpacing);
}

/** What measuring text answers in these tests — a width and a height, as the real shaper does. */
export function measureMono(text: string, fontSize: number, _family?: string, _weight?: number, letterSpacing = 0): Size2D {
    return { width: advanceOf(text.length, fontSize, letterSpacing), height: fontSize };
}

/** A measurer that has only the one question to answer, counting how often it was asked. */
export class CountingMeasurer implements MeasureContext2D {
    calls = 0;
    readonly asked: string[] = [];

    measureText(text: string, fontSize: number, family: string, weight?: number, letterSpacing = 0): Size2D {
        this.calls++;
        this.asked.push(text);
        return measureMono(text, fontSize, family, weight, letterSpacing);
    }
}

/** One text op as it reached the backend, with the paint that followed it. */
export interface DrawnText {
    text: string;
    x: number;
    y: number;
    fontSize: number | 'autofit' | undefined;
    fontFamily: string | undefined;
    letterSpacing: number | undefined;
    lineHeight: number | undefined;
    textAlign: string | undefined;
    color: number[];
    opacity: number;
    /** Painted in the gutter colour: a line number, not a digit someone wrote. */
    gutter: boolean;
}

/** One rect op as it reached the backend, with the paint that followed it and how many texts were drawn before it. */
export interface DrawnRect {
    x: number;
    y: number;
    width: number;
    height: number;
    cornerRadius: unknown;
    color: number[];
    opacity: number;
    before: number;
}

/**
 * Keeps every text op a draw is handed, so a test asks what was drawn without a
 * GPU surface. Measures like {@link measureMono}.
 *
 * `transform()` returns `this` so the (x, y) on a recorded op is the one the
 * node computed, not one composed with a transform stack.
 */
export class Frame extends CanvasRenderContext2D {
    readonly texts: DrawnText[] = [];
    readonly rects: DrawnRect[] = [];
    readonly styleScopes: string[] = [];

    protected drawGraphics(graphics: Graphics2D): void {
        let pending: DrawnText | null = null;
        let band: DrawnRect | null = null;
        for (const op of graphics.ops()) {
            if (op.kind === 'rect') {
                const state = op.state as { x?: number; y?: number; width?: number; height?: number; cornerRadius?: unknown };
                band = {
                    x: Number(state.x ?? 0),
                    y: Number(state.y ?? 0),
                    width: Number(state.width ?? 0),
                    height: Number(state.height ?? 0),
                    cornerRadius: state.cornerRadius,
                    color: [],
                    opacity: 1,
                    before: this.texts.length,
                };
                this.rects.push(band);
            } else if (op.kind === 'fill' && band) {
                const paints = op.fills as Array<{ opacity?: number; color?: number[] }>;
                band.color = paints[0]?.color ?? [];
                band.opacity = Number(paints[0]?.opacity ?? 1);
                band = null;
            } else if (op.kind === 'text') {
                const state = op.state as Partial<TextState>;
                const drawn: DrawnText = {
                    text: String(state.text ?? ''),
                    x: Number(state.x ?? 0),
                    y: Number(state.y ?? 0),
                    fontSize: state.fontSize,
                    fontFamily: state.fontFamily,
                    letterSpacing: state.letterSpacing,
                    lineHeight: state.lineHeight,
                    textAlign: state.textAlign,
                    color: [],
                    opacity: 1,
                    gutter: false,
                };
                pending = drawn;
                this.texts.push(drawn);
            } else if (op.kind === 'fill' && pending) {
                const paints = op.fills as Array<{ opacity?: number; color?: number[] }>;
                pending.color = paints[0]?.color ?? [];
                pending.opacity = Number(paints[0]?.opacity ?? 1);
                pending.gutter = String(pending.color) === String(LINE_NUMBER_COLOR);
                pending = null;
            }
        }
    }

    /** The code tokens, without the line numbers. */
    get tokens(): DrawnText[] {
        return this.texts.filter((t) => !t.gutter);
    }

    /** The line numbers, without the code. */
    get numbers(): DrawnText[] {
        return this.texts.filter((t) => t.gutter);
    }

    measureText(text: string, fontSize: number, fontFamily: string, fontWeight?: number, letterSpacing?: number): Size2D {
        return measureMono(text, fontSize, fontFamily, fontWeight, letterSpacing);
    }
    unmount(): void { }
    execute(callback: () => void): void { callback(); }
    screenshot(): undefined { return undefined; }
    transform(): RenderContext2D { return this; }
    beginBoolean(): void { }
    endBoolean(): void { }
    beginMask(): void { }
    applyMask(): void { }
    endMask(): void { }
    beginClip(): void { }
    endClip(): void { }
    beginCamera(): void { }
    endCamera(): void { }
}

const catalog = new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} });

/** Puts `node` in a live tree at `time`: measuring, drawing and animating are gated on it. */
export function attach<T extends Node>(node: T, time = 0): T {
    node.attach({ assets: catalog, context: ContextMap.EMPTY, time });
    return node;
}

export const SOURCE = 'function add(a, b) {\n  return a + b;\n}';

/** An attached `Code` in the grammar's own language. */
export function make(code = SOURCE, props: Partial<CodeProps> = {}): Code {
    return attach(new Code({ code, language: 'typescript', ...props } as never));
}

/** The source the listing shows, which is its token structure joined. */
export function sourceOf(node: Code): string {
    return listingOf(node).source;
}

/** The tokens of the structure the listing shows, line by line. */
export function tokensOf(node: Code): string[][] {
    return listingOf(node).lines.map((line) => line.tokens.map((t) => t.content));
}

/** Whether an edit is part-way through. */
export function inFlight(node: Code): boolean {
    return listingOf(node).edit !== null;
}

/** Runs the command a document's `remove` names: the node's own `remove` is the one that takes a child out. */
export function erase(node: Code, args: { data?: unknown; duration?: number; easing?: (t: number) => number }): Command<unknown> {
    return (node as unknown as { _command_remove(args: unknown): Command<unknown> })._command_remove(args);
}

/** The command's frame at `seconds` into it, from the start every time. */
export function at(command: Command<unknown>, seconds: number): void {
    const step = command._stepper();
    step.seek(0);
    step.seek(seconds);
}

/** Plays a command a frame at a time, which is what playback does with one. */
export function drive(command: Command<unknown>, steps: number, dt: number): void {
    const step = command._stepper();
    step.seek(0);
    for (let i = 0; i < steps; i++) step.advance(dt);
}

/** Measures `node` as its parent would, lays it out in a box and draws it into a fresh {@link Frame}. */
export function render(node: Code, box = { width: 800, height: 400 }): Frame {
    attach(node);
    const frame = new Frame();
    node.measure({ maxWidth: box.width, maxHeight: box.height }, frame);
    node.layout({ x: 0, y: 0, ...box }, frame);
    frame.execute(() => node.render(frame));
    return frame;
}

/**
 * The size `node` measures to under `constraints`: what a parent is told when it
 * asks, before any box has been handed down.
 */
export function measured(node: Code, constraints: { maxWidth?: number; maxHeight?: number } = {}, scope: MeasureContext2D = new Frame()): Size2D {
    attach(node);
    const { width, height } = node.measure(constraints as never, scope);
    return { width: width ?? 0, height: height ?? 0 };
}
