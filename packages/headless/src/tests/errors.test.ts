import { describe, expect, it } from 'vitest';
import { EngineError, isEngineError } from '../errors.js';

describe('isEngineError', () => {
    it('narrows only engine errors', () => {
        expect(isEngineError(new EngineError('CLOSED', 'x'))).toBe(true);
        expect(isEngineError(new Error('x'))).toBe(false);
        expect(isEngineError('x')).toBe(false);
    });
});
