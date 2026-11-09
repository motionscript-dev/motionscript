import { vi } from 'vitest';
import type prompts from 'prompts';

/**
 * A `prompts` that still answers from `prompts.inject`, and remembers every
 * question it was asked. That a prompt was not shown at all is as much part of
 * a command's behaviour as what it says when shown.
 *
 *     vi.mock('prompts', async (importOriginal) =>
 *         (await import('./prompts.fixtures.js')).spyingPrompts(await importOriginal<typeof import('prompts')>()));
 */
export function spyingPrompts(module: { default: typeof prompts }): { default: typeof prompts } {
    const real = module.default as typeof prompts & { _injected?: unknown[] };
    const spy = Object.assign(
        vi.fn((...args: Parameters<typeof prompts>) => real(...args)),
        real,
        {
            // `inject` appends to the real function's queue, so a test that does not
            // use every answer it injected would feed the next test's prompt.
            discardInjected(): void {
                real._injected = [];
            },
        },
    );
    return { default: spy as unknown as typeof prompts };
}

/** Drops the answers a test injected and did not use. */
export function discardInjectedAnswers(mocked: typeof prompts): void {
    (mocked as typeof prompts & { discardInjected(): void }).discardInjected();
}
