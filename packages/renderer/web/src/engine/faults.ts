// Page-wide GPU faults. Every surface shares one device (gpu.rs), so a lost
// device, a WebGPU error or a panic is news for all of them: each live
// surface queues the issue for its own takeRenderIssues(), and a lost device
// is replaced and every surface remounted on the new one.

import type { RenderIssue } from "@motionscript/core";
import { set_panic_listener } from "../../pkg/ms_renderer.js";
import { forgetDevice, prewarmDevice } from "../backend-wgpu";

/** What a host hears through {@link onWgpuEvent}. */
export type WgpuEvent =
    | { type: "device-lost"; reason: string; message: string }
    | { type: "device-restored" }
    | { type: "gpu-error"; error: "validation" | "out-of-memory" | "internal"; message: string }
    | { type: "crashed"; message: string };

/** A live surface, as faults reach it. */
export interface FaultTarget {
    queueIssue(issue: RenderIssue): void;
    /** Drop the dead backend and mount the canvas again on a new device. */
    remount(): void;
    /** The renderer can no longer draw: draw nothing more. */
    halt(): void;
}

/** Recoveries allowed in {@link RECOVERY_WINDOW_MS} before a device that keeps dying is given up on. */
const MAX_RECOVERIES = 3;
const RECOVERY_WINDOW_MS = 60_000;
/** WebGPU errors reported per page before the rest are only counted (a broken frame repeats every frame). */
const MAX_GPU_ERRORS = 32;

const listeners = new Set<(event: WgpuEvent) => void>();
const targets = new Set<FaultTarget>();
const watched = new WeakSet<object>();
const recoveries: number[] = [];
let gpuErrors = 0;
let crashed: string | null = null;
let panicHooked = false;

/** Calls `listener` on every GPU fault on the page; returns the unsubscribe. */
export function onWgpuEvent(listener: (event: WgpuEvent) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** The panic message once the renderer's WASM has panicked; it draws nothing after. */
export function crashMessage(): string | null {
    return crashed;
}

export function addFaultTarget(target: FaultTarget): () => void {
    hookPanics();
    targets.add(target);
    if (crashed !== null) {
        target.queueIssue(crashIssue(crashed));
        target.halt();
    }
    return () => targets.delete(target);
}

/** Watches a device the renderer drew with, once: its errors and its loss. */
export function watchDevice(device: unknown): void {
    const d = device as GPUDeviceLike | null;
    if (!d || watched.has(d)) return;
    watched.add(d);
    d.addEventListener?.("uncapturederror", (e: Event) => reportGpuError((e as Event & { error: { message: string; constructor: { name: string } } }).error));
    d.lost.then((info) => deviceLost(info.reason ?? "unknown", info.message ?? ""));
}

interface GPUDeviceLike {
    lost: Promise<{ reason?: string; message?: string }>;
    addEventListener?(type: string, listener: (e: Event) => void): void;
}

function emit(event: WgpuEvent): void {
    for (const l of [...listeners]) {
        try {
            l(event);
        } catch (e) {
            console.error("[wgpu] a fault listener threw:", e);
        }
    }
}

function broadcast(issue: RenderIssue): void {
    for (const t of targets) t.queueIssue(issue);
}

function reportGpuError(error: { message: string; constructor: { name: string } }): void {
    if (++gpuErrors > MAX_GPU_ERRORS) return;
    const name = error?.constructor?.name ?? "";
    const kind = name === "GPUOutOfMemoryError" ? "out-of-memory" : name === "GPUInternalError" ? "internal" : "validation";
    const message = `WebGPU ${kind} error: ${error?.message ?? String(error)}`;
    broadcast({ kind: "gpu", feature: `gpu:${kind}`, message });
    emit({ type: "gpu-error", error: kind, message });
}

function deviceLost(reason: string, detail: string): void {
    if (crashed !== null) return;
    forgetDevice();
    const now = performance.now();
    while (recoveries.length && now - recoveries[0] > RECOVERY_WINDOW_MS) recoveries.shift();
    const message = `The GPU device was lost (${reason}${detail ? `: ${detail}` : ""}); the renderer is drawing on a new one.`;
    emit({ type: "device-lost", reason, message });
    if (recoveries.length >= MAX_RECOVERIES) {
        crash(`The GPU device was lost ${MAX_RECOVERIES + 1} times within a minute; the renderer stopped asking for a new one.`);
        return;
    }
    recoveries.push(now);
    broadcast({ kind: "device-lost", message });
    for (const t of [...targets]) t.remount();
    prewarmDevice().then(() => emit({ type: "device-restored" }), (e) => crash(`No GPU device after a loss: ${String((e as Error)?.message ?? e)}`));
}

function crashIssue(message: string): RenderIssue {
    return { kind: "crashed", message };
}

/**
 * Marks the renderer dead at once, so nothing calls into it again, and tells
 * the surfaces and the host after: a panic arrives from inside a WASM call,
 * which must not be re-entered.
 */
function crash(message: string): void {
    if (crashed !== null) return;
    crashed = message;
    queueMicrotask(() => {
        broadcast(crashIssue(message));
        for (const t of [...targets]) t.halt();
        emit({ type: "crashed", message });
    });
}

function hookPanics(): void {
    if (panicHooked) return;
    panicHooked = true;
    set_panic_listener((message: string) => crash(`The renderer panicked and draws nothing more on this page (reload to recover): ${message}`));
}
