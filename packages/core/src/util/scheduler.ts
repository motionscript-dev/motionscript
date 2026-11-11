/** Event-loop yielding for work that must stay interruptible: a long synchronous loop cannot be cancelled since nothing can run to *ask* it to stop. `StateEvaluator`'s backward-seek replay yields periodically through {@link yieldToScheduler}, which lets a newer seek supersede one in flight. Core has no DOM, so every mechanism is feature-detected and works in a browser, Node and vitest. */

/** Monotonic-ish clock in milliseconds. `performance` is absent in some hosts. */
export function now(): number {
    return typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
}

type SchedulerWithYield = { yield?: () => Promise<void> };

/** `scheduler.yield()` when the host has it (Chrome 129+), else undefined. */
function nativeYield(): (() => Promise<void>) | undefined {
    const s = (globalThis as { scheduler?: SchedulerWithYield }).scheduler;
    return typeof s?.yield === "function" ? s.yield.bind(s) : undefined;
}

/** One shared `MessageChannel`: a channel per yield would allocate (and leak until GC) thousands of ports over one scrub. Callbacks queue FIFO and each posted message drains one, so resolution order matches call order. */
let channel: MessageChannel | null = null;
const queue: (() => void)[] = [];

function messageChannelYield(): Promise<void> | null {
    if (typeof MessageChannel !== "function") return null;
    if (!channel) {
        channel = new MessageChannel();
        channel.port1.onmessage = () => queue.shift()?.();
        // Node keeps the event loop alive for an open port, which would hang vitest on exit; browsers have no unref.
        (channel.port1 as unknown as { unref?: () => void }).unref?.();
        (channel.port2 as unknown as { unref?: () => void }).unref?.();
    }
    return new Promise<void>(resolve => {
        queue.push(resolve);
        channel!.port2.postMessage(null);
    });
}

/**
 * Yields to the event loop so pending input, timers and rendering run before the caller resumes. A **macrotask**, not a
 * microtask (`await Promise.resolve()` drains in the same task and starves what we yield for); not
 * `requestAnimationFrame` either, which caps at the display rate and stops in a background tab, stalling headless
 * export and tests. Preference: `scheduler.yield()` (continuation priority, so a sliced task isn't starved), then
 * `MessageChannel` (a true unclamped macrotask), then `setTimeout(0)` (clamps to ~4 ms once nested).
 */
export function yieldToScheduler(): Promise<void> {
    const native = nativeYield();
    if (native) return native();
    return messageChannelYield() ?? new Promise<void>(resolve => setTimeout(resolve, 0));
}

/** Drop the shared channel. Tests only — the next yield lazily rebuilds it. */
export function __resetSchedulerForTests(): void {
    channel?.port1.close();
    channel?.port2.close();
    channel = null;
    queue.length = 0;
}
