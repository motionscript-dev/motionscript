import { afterEach, describe, expect, it, vi } from 'vitest';
import { deprecate, deprecationMessage, resetDeprecationWarnings, warnDeprecated } from '@/util/deprecate';

const NOTICE = { name: 'oldSum', use: 'sum(a, b)', removeIn: '1.0.0' };

describe('deprecate', () => {
    afterEach(() => {
        resetDeprecationWarnings();
        vi.restoreAllMocks();
    });

    it('keeps the function working, this and arguments included', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const oldSum = deprecate(function (this: { base: number }, a: number, b: number) {
            return this.base + a + b;
        }, NOTICE);
        expect(oldSum.call({ base: 1 }, 2, 3)).toBe(6);
        expect(oldSum.name).toBe('oldSum');
    });

    it('warns once per name, naming the replacement and the release', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const oldSum = deprecate((a: number, b: number) => a + b, NOTICE);
        oldSum(1, 2);
        oldSum(3, 4);
        warnDeprecated(NOTICE);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(deprecationMessage(NOTICE));
        expect(deprecationMessage(NOTICE)).toBe('[motionscript] oldSum is deprecated and will be removed in 1.0.0; use sum(a, b) instead.');
    });

    it('stays quiet in production', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('NODE_ENV', 'production');
        try {
            deprecate(() => 1, NOTICE)();
        } finally {
            vi.unstubAllEnvs();
        }
        expect(warn).not.toHaveBeenCalled();
    });
});
