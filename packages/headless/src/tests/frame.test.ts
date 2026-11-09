import { describe, expect, it } from 'vitest';
import { parseFrameSelector, toFrameSpec } from '../frame.js';
import { EngineError } from '../errors.js';

describe('parseFrameSelector', () => {
    it('accepts the timeline ends, case-insensitively', () => {
        expect(parseFrameSelector('first')).toEqual({ kind: 'first' });
        expect(parseFrameSelector('LAST')).toEqual({ kind: 'last' });
    });

    it('reads a numeric selector as a frame index, never as seconds', () => {
        expect(parseFrameSelector(42)).toEqual({ kind: 'frame', frame: 42 });
        expect(parseFrameSelector(0)).toEqual({ kind: 'frame', frame: 0 });
    });

    it('rejects a fractional number rather than reinterpreting it as a time', () => {
        // The unit must not change silently: `duration * 0.5` is a bug, not a request in seconds.
        expect(() => parseFrameSelector(2.5)).toThrow(EngineError);
        expect(() => parseFrameSelector(2.5)).toThrow(/whole frame index/);
    });

    it('splits text on the integer/decimal boundary, the way a CLI flag reads', () => {
        expect(parseFrameSelector('42')).toEqual({ kind: 'frame', frame: 42 });
        expect(parseFrameSelector('2.5')).toEqual({ kind: 'time', seconds: 2.5 });
        expect(parseFrameSelector('2.5s')).toEqual({ kind: 'time', seconds: 2.5 });
        expect(parseFrameSelector('3s')).toEqual({ kind: 'time', seconds: 3 });
    });

    it('accepts an explicit unit object', () => {
        expect(parseFrameSelector({ frame: 7 })).toEqual({ kind: 'frame', frame: 7 });
        expect(parseFrameSelector({ seconds: 1.25 })).toEqual({ kind: 'time', seconds: 1.25 });
    });

    it('rejects malformed and negative selectors with INVALID_OPTION', () => {
        for (const bad of ['', '   ', 'middle', '-1', -3, {}, null as never, 'xs']) {
            let code: string | undefined;
            try {
                parseFrameSelector(bad as never);
            } catch (err) {
                code = (err as EngineError).code;
            }
            expect(code, `expected ${JSON.stringify(bad)} to be rejected`).toBe('INVALID_OPTION');
        }
    });
});

describe('toFrameSpec', () => {
    it('converts a time to the nearest frame at the project rate', () => {
        expect(toFrameSpec({ kind: 'time', seconds: 2.5 }, 60)).toEqual({ kind: 'frame', frame: 150 });
        expect(toFrameSpec({ kind: 'time', seconds: 1 / 3 }, 30)).toEqual({ kind: 'frame', frame: 10 });
    });

    it('reads a time on a frame boundary as that frame at every common rate', () => {
        for (const fps of [24, 25, 30, 60]) {
            for (let frame = 0; frame < fps * 10; frame++) {
                const seconds = frame * (1 / fps);
                expect(toFrameSpec({ kind: 'time', seconds }, fps)).toEqual({ kind: 'frame', frame });
            }
        }
    });

    it('passes frame and end selectors through untouched', () => {
        expect(toFrameSpec({ kind: 'frame', frame: 9 }, 60)).toEqual({ kind: 'frame', frame: 9 });
        expect(toFrameSpec({ kind: 'last' }, 60)).toEqual({ kind: 'last' });
    });
});

describe('parseFrameSelector edge cases', () => {
    const codeOf = (selector: unknown): string | undefined => {
        try {
            parseFrameSelector(selector as never);
        } catch (err) {
            return (err as EngineError).code;
        }
        return undefined;
    };

    it('refuses an explicit frame that is fractional or negative, and a time that is negative or not finite', () => {
        for (const bad of [{ frame: 1.5 }, { frame: -1 }, { frame: Number.NaN }, { seconds: -1 }, { seconds: Number.NaN }, { seconds: Infinity }]) {
            expect(codeOf(bad), JSON.stringify(bad)).toBe('INVALID_OPTION');
        }
    });

    it('refuses a number that is not a whole index, naming how to ask for a time', () => {
        for (const bad of [Number.NaN, Infinity, -0.5]) expect(codeOf(bad), String(bad)).toBe('INVALID_OPTION');
        expect(() => parseFrameSelector(0.5)).toThrow('pass { seconds: 0.5 } (or "0.5s") for a time');
    });

    it('reads 0s as the time zero, and any case of s or of the ends', () => {
        expect(parseFrameSelector('0s')).toEqual({ kind: 'time', seconds: 0 });
        expect(parseFrameSelector('2.5S')).toEqual({ kind: 'time', seconds: 2.5 });
        expect(parseFrameSelector(' First ')).toEqual({ kind: 'first' });
    });

    it('refuses Infinity as text, and a time written with a minus sign', () => {
        expect(codeOf('Infinity')).toBe('INVALID_OPTION');
        expect(codeOf('-1s')).toBe('INVALID_OPTION');
    });

    it('says what it refused, and what it would have taken', () => {
        expect(() => parseFrameSelector('soon')).toThrow(
            'Invalid frame selector: "soon" (expected a frame number, a time like "2.5s", "first" or "last").',
        );
    });

    it.todo('refuses a bare "s", and numerals Number() reads that no one writes for a frame ("0x10", "1e3"), instead of reading them as 0 seconds, frame 16 and frame 1000');
});

describe('toFrameSpec at a time that is not on a frame', () => {
    it('rounds to the nearest frame', () => {
        expect(toFrameSpec({ kind: 'time', seconds: 0 }, 30)).toEqual({ kind: 'frame', frame: 0 });
        expect(toFrameSpec({ kind: 'time', seconds: 0.49 / 30 }, 30)).toEqual({ kind: 'frame', frame: 0 });
        expect(toFrameSpec({ kind: 'time', seconds: 0.51 / 30 }, 30)).toEqual({ kind: 'frame', frame: 1 });
    });
});

