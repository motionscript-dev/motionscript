import { describe, expect, it } from 'vitest';
import type { Command } from '@motionscript/sdk';
import { Code, listingOf } from '../node';
import { attach } from './harness.fixtures';

/**
 * Play a command a frame at a time, which is what playback does with one.
 */
function drive(command: Command<unknown>, steps: number, dt: number) {
    const step = command._stepper();
    step.seek(0);
    for (let i = 0; i < steps; i++) step.advance(dt);
}

const SOURCE = 'function add(a: number, b: number) {\n  return a + b;\n}';
const source = (code: Code) => listingOf(code).source;

describe('inserting a row in the middle of a line', () => {
    it('inserts at line 2 col 3, splitting the row where the new text ends in a break', () => {
        const code = attach(new Code({ code: SOURCE, language: 'typescript' }));
        const edit = code.insert({ data: { position: [2, 3], code: 'if (a < 0) return b;\n  ' }, duration: 1 });
        drive(edit, 200, 0.01);
        expect(source(code)).toBe('function add(a: number, b: number) {\n  if (a < 0) return b;\n  return a + b;\n}');
    });

    it('does nothing for a listing that is not in a tree: an edit is animated, and nothing animates unmounted', () => {
        const code = new Code({ code: SOURCE, language: 'typescript' });
        drive(code.insert({ data: { position: [2, 3], code: 'x' }, duration: 1 }), 200, 0.01);
        expect(source(code)).toBe(SOURCE);
    });
});
