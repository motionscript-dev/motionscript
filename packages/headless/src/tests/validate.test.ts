import { describe, expect, it } from 'vitest';
import {
    parseBitrate,
    parseCodec,
    parseConcurrency,
    parseImageFormat,
    parseScale,
    parseSupersample,
    parseTimeout,
} from '../validate.js';
import type { EngineError } from '../errors.js';

const codeOf = (fn: () => unknown): string | undefined => {
    try {
        fn();
    } catch (err) {
        return (err as EngineError).code;
    }
    return undefined;
};

describe('parseBitrate', () => {
    it('reads the k / M suffixes a bitrate is normally written with', () => {
        expect(parseBitrate('12M')).toBe(12_000_000);
        expect(parseBitrate('40m')).toBe(40_000_000);
        expect(parseBitrate('12000k')).toBe(12_000_000);
        expect(parseBitrate('1.5M')).toBe(1_500_000);
        expect(parseBitrate('8000000')).toBe(8_000_000);
        expect(parseBitrate('12Mbps')).toBe(12_000_000);
        expect(parseBitrate(9_000_000)).toBe(9_000_000);
    });

    it('treats an absent value as "use the exporter default"', () => {
        expect(parseBitrate(undefined)).toBeUndefined();
        expect(parseBitrate('')).toBeUndefined();
    });

    it('rejects junk and non-positive values', () => {
        expect(codeOf(() => parseBitrate('fast'))).toBe('INVALID_OPTION');
        expect(codeOf(() => parseBitrate('0'))).toBe('INVALID_OPTION');
        expect(codeOf(() => parseBitrate(-1))).toBe('INVALID_OPTION');
    });
});

describe('parseCodec', () => {
    it('normalizes case and passes the known codecs', () => {
        expect(parseCodec('HEVC')).toBe('hevc');
        expect(parseCodec(' av1 ')).toBe('av1');
        expect(parseCodec(undefined)).toBeUndefined();
    });

    it('rejects an unknown codec at the edge instead of mid-render', () => {
        expect(codeOf(() => parseCodec('h264'))).toBe('INVALID_OPTION');
    });
});

describe('parseImageFormat', () => {
    it('defaults to png and keeps the caller jpg/jpeg spelling for the extension', () => {
        expect(parseImageFormat(undefined)).toEqual({ format: 'png', extension: 'png', mimeType: 'image/png' });
        expect(parseImageFormat('jpg')).toEqual({ format: 'jpeg', extension: 'jpg', mimeType: 'image/jpeg' });
        expect(parseImageFormat('.JPEG')).toEqual({ format: 'jpeg', extension: 'jpeg', mimeType: 'image/jpeg' });
    });

    it('rejects an unsupported format', () => {
        expect(codeOf(() => parseImageFormat('webp'))).toBe('INVALID_OPTION');
    });
});

describe('numeric options', () => {
    it('defaults scale to 1 and requires it to be positive', () => {
        expect(parseScale(undefined)).toBe(1);
        expect(parseScale('2')).toBe(2);
        expect(codeOf(() => parseScale(0))).toBe('INVALID_OPTION');
        expect(codeOf(() => parseScale(-1))).toBe('INVALID_OPTION');
    });

    it('bounds supersample to 1..4, where the cost is quadratic', () => {
        expect(parseSupersample(undefined)).toBeUndefined();
        expect(parseSupersample(2)).toBe(2);
        expect(codeOf(() => parseSupersample(5))).toBe('INVALID_OPTION');
        expect(codeOf(() => parseSupersample(1.5))).toBe('INVALID_OPTION');
    });

    it('requires a whole concurrency of at least one', () => {
        expect(parseConcurrency(undefined)).toBe(1);
        expect(parseConcurrency(4)).toBe(4);
        expect(codeOf(() => parseConcurrency(0))).toBe('INVALID_OPTION');
        expect(codeOf(() => parseConcurrency(2.5))).toBe('INVALID_OPTION');
    });

    it('keeps 0 as an explicit "no timeout" rather than falling back', () => {
        expect(parseTimeout(undefined, 1000)).toBe(1000);
        expect(parseTimeout(0, 1000)).toBe(0);
        expect(codeOf(() => parseTimeout(-5, 1000))).toBe('INVALID_OPTION');
    });
});

describe('absent values', () => {
    it('treats null and undefined alike, and an empty string as absent for the parsers that say so', () => {
        for (const absent of [undefined, null, '']) {
            expect(parseCodec(absent), `parseCodec(${JSON.stringify(absent)})`).toBeUndefined();
            expect(parseBitrate(absent), `parseBitrate(${JSON.stringify(absent)})`).toBeUndefined();
            expect(parseSupersample(absent), `parseSupersample(${JSON.stringify(absent)})`).toBeUndefined();
            expect(parseImageFormat(absent), `parseImageFormat(${JSON.stringify(absent)})`).toEqual({ format: 'png', extension: 'png', mimeType: 'image/png' });
        }
        expect(parseScale(undefined)).toBe(1);
        expect(parseScale(null)).toBe(1);
        expect(parseTimeout(undefined, 7)).toBe(7);
        expect(parseTimeout(null, 7)).toBe(7);
    });

    it('does not treat an empty string as absent for scale', () => {
        expect(codeOf(() => parseScale(''))).toBe('INVALID_OPTION');
    });

    // `''` is absent for the other four parsers, and for a timeout it is a limit of 0, which means none.
    it('reads an empty timeout as 0, which is "no limit"', () => {
        expect(parseTimeout('', 1000)).toBe(0);
    });

    it.todo('treats an empty string as absent for scale and timeout, as the other parsers do');
});

describe('parseBitrate', () => {
    it('reads a unit that follows a space, and the `bps` and `bit/s` spellings', () => {
        expect(parseBitrate('12 kbps')).toBe(12_000);
        expect(parseBitrate('12 bit/s')).toBe(12);
        expect(parseBitrate('.5M')).toBe(500_000);
        expect(parseBitrate(' 2m ')).toBe(2_000_000);
    });

    it('does not read exponent notation, and refuses what rounds to nothing', () => {
        expect(codeOf(() => parseBitrate('1e6'))).toBe('INVALID_OPTION');
        expect(codeOf(() => parseBitrate('0.4'))).toBe('INVALID_OPTION');
        expect(codeOf(() => parseBitrate(Number.NaN))).toBe('INVALID_OPTION');
        expect(codeOf(() => parseBitrate(Infinity))).toBe('INVALID_OPTION');
    });

    it('names the value it refused', () => {
        expect(() => parseBitrate('fast')).toThrow(/Invalid bitrate: fast/);
    });
});

describe('parseCodec and parseImageFormat messages', () => {
    it('name the value, and the values that would have been accepted', () => {
        expect(() => parseCodec('h264')).toThrow('Invalid codec: h264. Expected one of: avc, hevc, av1, vp9.');
        expect(() => parseImageFormat('webp')).toThrow('Unsupported image format: webp (supported: png, jpg, jpeg).');
    });

    it('accepts every codec and every format it lists, in any case', () => {
        for (const codec of ['avc', 'hevc', 'av1', 'vp9']) expect(parseCodec(codec.toUpperCase())).toBe(codec);
        expect(parseImageFormat('PNG').format).toBe('png');
        expect(parseImageFormat(' jpeg ').extension).toBe('jpeg');
    });
});

describe('parseScale', () => {
    it('names the label it was given in the message', () => {
        expect(() => parseScale(0, 'zoom')).toThrow('Invalid zoom: 0. Expected a number greater than 0.');
        expect(() => parseScale(0)).toThrow('Invalid scale: 0.');
    });

    it('refuses what is not a finite number above zero', () => {
        for (const bad of ['abc', Infinity, Number.NaN, -0.5, '-1']) {
            expect(codeOf(() => parseScale(bad)), `parseScale(${String(bad)})`).toBe('INVALID_OPTION');
        }
        expect(parseScale('0.5')).toBe(0.5);
    });
});

describe('parseSupersample', () => {
    it('takes the whole numbers from 1 to 4, as a number or as text, and refuses 0 and the rest', () => {
        for (const ok of [1, 2, 3, 4, '2']) expect(parseSupersample(ok)).toBe(Number(ok));
        for (const bad of [0, 5, -1, 2.5, 'two']) {
            expect(codeOf(() => parseSupersample(bad)), `parseSupersample(${String(bad)})`).toBe('INVALID_OPTION');
        }
    });
});

describe('parseTimeout', () => {
    it('reads a number or a numeral, and refuses what is negative or not a number', () => {
        expect(parseTimeout('250', 1000)).toBe(250);
        expect(parseTimeout(30_000, 1000)).toBe(30_000);
        for (const bad of ['soon', -1, Number.NaN, Infinity]) {
            expect(codeOf(() => parseTimeout(bad, 1000)), `parseTimeout(${String(bad)})`).toBe('INVALID_OPTION');
        }
        expect(() => parseTimeout('soon', 1000)).toThrow(/Invalid timeout: soon/);
    });
});

