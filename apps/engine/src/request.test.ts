import { describe, expect, it } from 'vitest';
import { isEngineError } from '@motionscript/headless';
import { HttpError } from './errors.js';
import { parseFormatParam, parseFrameParam, parseNumber } from './request.js';

describe('parseFormatParam', () => {
    it('defaults to png', () => {
        expect(parseFormatParam(null)).toEqual({ format: 'png', mimeType: 'image/png' });
    });

    it('labels jpg and jpeg with the one registered media type', () => {
        expect(parseFormatParam('jpg')).toEqual({ format: 'jpeg', mimeType: 'image/jpeg' });
        expect(parseFormatParam('jpeg')).toEqual({ format: 'jpeg', mimeType: 'image/jpeg' });
    });

    it.each(['gif', 'webp', 'bmp'])('refuses %s instead of labelling PNG bytes with it', (raw) => {
        try {
            parseFormatParam(raw);
            expect.unreachable();
        } catch (error) {
            expect(isEngineError(error) && error.code).toBe('INVALID_OPTION');
        }
    });
});

describe('parseFrameParam', () => {
    it('reads the ends, a frame index and a time against the fps', () => {
        expect(parseFrameParam(null, 60)).toBe('last');
        expect(parseFrameParam('', 60)).toBe('last');
        expect(parseFrameParam('first', 60)).toBe('first');
        expect(parseFrameParam('last', 60)).toBe('last');
        expect(parseFrameParam('42', 60)).toBe(42);
        // The page's "at 1s" option.
        expect(parseFrameParam('1s', 60)).toBe(60);
        expect(parseFrameParam('2.5s', 30)).toBe(75);
    });

    it('refuses what is not a frame reference', () => {
        for (const raw of ['soon', '-1', '1x']) {
            expect(() => parseFrameParam(raw, 60), raw).toThrow(/Invalid frame selector/);
        }
    });
});

describe('parseNumber', () => {
    it('passes absence through and refuses a non-number with a 400', () => {
        expect(parseNumber(null)).toBeUndefined();
        expect(parseNumber('0.5')).toBe(0.5);
        expect(() => parseNumber('big')).toThrow(HttpError);
    });
});
