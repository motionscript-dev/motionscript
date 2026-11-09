import { describe, it, expect } from 'vitest';
import { ContextMap, type Command, type Node } from '@motionscript/sdk';
import { ManifestAssetCatalog } from '@motionscript/core';
import { Code, defineCode } from '../node';
import { defaultCodeDiff, defaultCodePhases } from '../engine';

function attach<T extends Node>(node: T): T {
    node.attach({
        assets: new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} }),
        context: ContextMap.EMPTY,
        time: 0,
    });
    return node;
}

const SOURCE = 'function add(a, b) {\n  return a + b;\n}';

function drive(command: Command<unknown>, steps: number, dt: number): void {
    const step = command._stepper();
    step.seek(0);
    for (let i = 0; i < steps; i++) step.advance(dt);
}

describe('pluggable diffStrategy / phaseStrategy', () => {
    it('calls a custom diffStrategy (not the default) when one is provided', () => {
        let calls = 0;
        const Custom = defineCode({
            diffStrategy: (from, to) => {
                calls++;
                return defaultCodeDiff(from, to);
            },
        });
        const node = attach(new Custom({ code: SOURCE, language: 'typescript' }));
        drive(node.append({ data: { code: '\nx();' }, duration: 1 }), 120, 0.01);
        expect(calls).toBeGreaterThan(0);
    });

    it('calls a custom phaseStrategy (not the default) when one is provided', () => {
        let calls = 0;
        const Custom = defineCode({
            phaseStrategy: (hasRemoved, hasAdded) => {
                calls++;
                return defaultCodePhases(hasRemoved, hasAdded);
            },
        });
        const node = attach(new Custom({ code: SOURCE, language: 'typescript' }));
        drive(node.append({ data: { code: '\nx();' }, duration: 1 }), 120, 0.01);
        expect(calls).toBeGreaterThan(0);
    });

    it('falls back to the default strategies when none are provided', () => {
        // No throw, no missing behavior: the defaults are exercised by every
        // other test in this package already; this pins that `Code` is a
        // supported, working shape without either.
        const node = attach(new Code({ code: SOURCE, language: 'typescript' }));
        expect(() => drive(node.append({ data: { code: '\nx();' }, duration: 1 }), 120, 0.01)).not.toThrow();
    });
});
