import { afterEach, describe, expect, it } from 'vitest';
import { setTheme } from '@/attributes/shape/fill/color/parser';
import { textOps } from '@/attributes/text/ops';
import { RichText, Text } from "@/components/builtins/text/text";
import { attached } from '@/components/trees/node/node.fixtures';
import { richRuns, type RichValues } from '@/components/builtins/text/text-layout';
import type { MeasureContext2D } from '@/render/measure-context';

const scope = {
    measureText: (text: string, fontSize: number) => ({ width: text.length * fontSize * 0.5, height: fontSize }),
} as unknown as MeasureContext2D;

/** Plays a `to({ fontSize })` through a stepper at `t` (0 to 1) of its duration. */
function fontSizeAt(node: Text, target: number | 'autofit', t: number): unknown {
    const step = (node as any)._prepareStep({ fontSize: target }, 1);
    step.seek(t);
    return node.fontSize;
}

describe('textOps.lerpFontSize', () => {
    it('interpolates two numbers', () => {
        expect(textOps.lerpFontSize(10, 20, 0.5)).toBe(15);
    });

    it('steps an autofit size at the midpoint rather than computing with it', () => {
        expect(textOps.lerpFontSize('autofit', 20, 0.25)).toBe('autofit');
        expect(textOps.lerpFontSize('autofit', 20, 0.5)).toBe(20);
        expect(textOps.lerpFontSize(20, 'autofit', 0.25)).toBe(20);
        expect(textOps.lerpFontSize(20, 'autofit', 0.75)).toBe('autofit');
    });
});

describe('Text – tweening fontSize across autofit', () => {
    it('never writes a non-number string while tweening from autofit to a number', () => {
        for (const t of [0, 0.25, 0.49, 0.5, 0.75, 1]) {
            const text = attached(new Text({ text: 'hi', fontSize: 'autofit' }));
            const size = fontSizeAt(text, 20, t);
            expect(size, `t = ${t}`).toBe(t < 0.5 ? 'autofit' : 20);
        }
    });

    it('ends on autofit when tweened to it from a number', () => {
        const text = attached(new Text({ text: 'hi', fontSize: 20 }));
        expect(fontSizeAt(text, 'autofit', 0.25)).toBe(20);
        expect(fontSizeAt(text, 'autofit', 1)).toBe('autofit');
    });

    it('still tweens two numbers linearly', () => {
        const text = attached(new Text({ text: 'hi', fontSize: 10 }));
        expect(fontSizeAt(text, 30, 0.5)).toBe(20);
    });
});

describe('RichText – an inherited autofit', () => {
    afterEach(() => setTheme());

    it('keeps its own size when the cascade states autofit', () => {
        setTheme({ typography: { default: { fontSize: 'autofit' } } });
        const rich = attached(new RichText({ spans: [{ text: 'hello' }] }));
        expect(rich.fontSize).toBe(48);
        // The spans it sets, as its render reads them.
        expect(richRuns(rich as unknown as RichValues)[0].fontSize).toBe(48);
        const size = rich.measure({ maxWidth: 500, maxHeight: 500 }, scope);
        expect(Number.isFinite(size.height)).toBe(true);
    });

    it('still takes a numeric cascade size', () => {
        setTheme({ typography: { default: { fontSize: 30 } } });
        expect(attached(new RichText({ spans: [{ text: 'hello' }] })).fontSize).toBe(30);
    });

    it('leaves Text free to autofit from the same cascade', () => {
        setTheme({ typography: { default: { fontSize: 'autofit' } } });
        expect(attached(new Text({ text: 'hello' })).fontSize).toBe('autofit');
    });
});
