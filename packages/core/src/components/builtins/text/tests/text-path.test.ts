import { describe, it, expect } from 'vitest';
import { Text } from "@/components/builtins/text/text";
import { PathBuilder } from '@/render/descriptors/path-builder';
import { PathCommand } from '@/render/descriptors/path';
import { textState, type TextValues } from '@/components/builtins/text/text-layout';

describe('Text – path property (text-on-path)', () => {
    it('defaults path to null', () => {
        const t = new Text({ text: 'hello' });
        expect(t.path).toBeNull();
    });

    it('accepts an SVG path string', () => {
        const d = 'M 0 0 L 100 0';
        const t = new Text({ text: 'hello', path: d });
        expect(t.path).toBe(d);
    });

    it('accepts a PathCommand[] unchanged', () => {
        const cmds: PathCommand[] = [
            { type: 'M', x: 0, y: 0 },
            { type: 'L', x: 100, y: 0 },
        ];
        const t = new Text({ text: 'hello', path: cmds });
        expect(t.path).toBe(cmds);
    });

    it('coerces a PathBuilder to its commands', () => {
        const pb = new PathBuilder().moveTo(0, 0).lineTo(100, 0);
        const t = new Text({ text: 'hello', path: pb });
        expect(t.path).toEqual(pb.toCommands());
        // Stored value is the command array, not the builder instance.
        expect(t.path).not.toBe(pb);
    });

    it('updates path via set()', () => {
        const t = new Text({ text: 'hi', path: 'M 0 0 L 10 0' });
        t.set({ path: 'M 0 0 L 20 0' });
        expect(t.path).toBe('M 0 0 L 20 0');
    });
});

describe('Text – path and runs are mutually exclusive', () => {
    // What the renderer would receive, with one run over the first "cat".
    const renderState = (t: Text) =>
        textState(t as unknown as TextValues, { text: t.text, wraps: false, glyphPath: t.path, runs: t.runs }, undefined);
    const RUNS = [{ start: 2, end: 5, fontSize: 30 }];

    it('skips run segments when a path is set', () => {
        const state = renderState(new Text({ text: 'a cat and a cat', path: 'M 0 0 L 100 0', runs: RUNS }));
        expect(state.path).toBe('M 0 0 L 100 0');
        expect(state.segments).toBeUndefined();
    });

    it('still builds segments when no path is set', () => {
        const state = renderState(new Text({ text: 'a cat and a cat', runs: RUNS }));
        expect(state.path).toBeNull();
        expect(state.segments).toBeDefined();
    });
});
