import type { ExportLane, LaneEnvironment, LaneReport, LaneSession, SegmentSpec } from "./lane";
import type { ExportChunk } from "./plan";
import { openSegmentSession } from "./session";

/** A lane that renders in this realm, with its renderer, registry and warm caches. */
export function localLane(env: LaneEnvironment = {}): ExportLane {
    return { open: (spec) => openSegmentSession(spec, env) };
}

type ToLane =
    | { t: "open"; id: number; spec: SegmentSpec }
    | { t: "render"; id: number; session: number; chunk: ExportChunk }
    | { t: "abort"; id: number }
    | { t: "close"; id: number };

type FromLane =
    | { t: "opened"; id: number }
    | { t: "report"; id: number; report: LaneReport }
    | { t: "done"; id: number; bytes: Uint8Array }
    | { t: "error"; id: number; message: string; name: string };

/** The error a lane sent back, keeping its name so a host can tell a cancel from a failure. */
function laneError(message: string, name: string): Error {
    const error = new Error(message);
    error.name = name;
    return error;
}

export interface MessagePortLaneOptions {
    /** Settles when the realm behind the port is gone, failing whatever it was doing. */
    lost?: Promise<unknown>;
}

/**
 * A lane on the far side of `port`, which {@link serveExportLane} answers. The
 * finished segment comes back as a transferred buffer, never a copy.
 */
export function messagePortLane(port: MessagePort, options: MessagePortLaneOptions = {}): ExportLane {
    let next = 1;
    let gone: Error | null = null;
    const pending = new Map<number, { resolve: (msg: FromLane) => void; reject: (error: Error) => void; onReport?: (r: LaneReport) => void }>();

    port.addEventListener("message", (event: MessageEvent<FromLane>) => {
        const msg = event.data;
        const entry = pending.get(msg.id);
        if (!entry) return;
        if (msg.t === "report") {
            entry.onReport?.(msg.report);
            return;
        }
        pending.delete(msg.id);
        if (msg.t === "error") entry.reject(laneError(msg.message, msg.name));
        else entry.resolve(msg);
    });
    port.start();

    const fail = (reason: string) => {
        gone ??= new Error(reason);
        for (const entry of pending.values()) entry.reject(gone);
        pending.clear();
    };
    port.addEventListener("close", () => fail("The export lane closed."));
    void options.lost?.then(() => fail("The export lane was lost."), () => fail("The export lane was lost."));

    const call = (msg: ToLane, signal: AbortSignal, onReport?: (r: LaneReport) => void) =>
        new Promise<FromLane>((resolve, reject) => {
            if (gone) return reject(gone);
            if (signal.aborted) return reject(signal.reason);
            const onAbort = () => {
                pending.delete(msg.id);
                port.postMessage({ t: "abort", id: msg.id } satisfies ToLane);
                reject(signal.reason);
            };
            signal.addEventListener("abort", onAbort, { once: true });
            pending.set(msg.id, {
                resolve: (m) => { signal.removeEventListener("abort", onAbort); resolve(m); },
                reject: (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
                onReport,
            });
            port.postMessage(msg);
        });

    return {
        async open(spec, signal) {
            const session = next++;
            await call({ t: "open", id: session, spec }, signal);
            return {
                async render(chunk, onReport, renderSignal) {
                    const reply = await call({ t: "render", id: next++, session, chunk }, renderSignal, onReport);
                    return (reply as Extract<FromLane, { t: "done" }>).bytes;
                },
                close() {
                    if (!gone) port.postMessage({ t: "close", id: session } satisfies ToLane);
                },
            } satisfies LaneSession;
        },
    };
}

/**
 * Answer a {@link messagePortLane} from this realm. `resolve` supplies what the
 * realm renders with, given the spec (its `host` field carries anything the
 * coordinator's host wanted this side to know). Returns a function that stops
 * serving and closes every open session.
 */
export function serveExportLane(
    port: MessagePort,
    resolve: (spec: SegmentSpec) => LaneEnvironment | Promise<LaneEnvironment>,
): () => void {
    const sessions = new Map<number, Promise<LaneSession>>();
    const renders = new Map<number, AbortController>();
    const reply = (msg: FromLane, transfer: Transferable[] = []) => port.postMessage(msg, transfer);
    const replyError = (id: number, error: unknown) => reply({
        t: "error", id,
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : "Error",
    });

    const onMessage = async (event: MessageEvent<ToLane>) => {
        const msg = event.data;
        switch (msg.t) {
            case "open": {
                const opening = Promise.resolve(resolve(msg.spec)).then((env) => openSegmentSession(msg.spec, env));
                sessions.set(msg.id, opening);
                try {
                    await opening;
                    reply({ t: "opened", id: msg.id });
                } catch (error) {
                    sessions.delete(msg.id);
                    replyError(msg.id, error);
                }
                return;
            }
            case "render": {
                const controller = new AbortController();
                renders.set(msg.id, controller);
                try {
                    const session = await sessions.get(msg.session);
                    if (!session) throw new Error(`No open export session ${msg.session}.`);
                    const bytes = await session.render(msg.chunk, (report) => reply({ t: "report", id: msg.id, report }), controller.signal);
                    const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
                    reply({ t: "done", id: msg.id, bytes: whole }, [whole.buffer]);
                } catch (error) {
                    if (!controller.signal.aborted) replyError(msg.id, error);
                } finally {
                    renders.delete(msg.id);
                }
                return;
            }
            case "abort":
                renders.get(msg.id)?.abort(new DOMException("Export cancelled.", "AbortError"));
                return;
            case "close": {
                const session = sessions.get(msg.id);
                sessions.delete(msg.id);
                void session?.then((s) => s.close(), () => {});
                return;
            }
        }
    };

    port.addEventListener("message", onMessage);
    port.start();
    return () => {
        port.removeEventListener("message", onMessage);
        for (const controller of renders.values()) controller.abort(new DOMException("Export cancelled.", "AbortError"));
        for (const session of sessions.values()) void session.then((s) => s.close(), () => {});
        sessions.clear();
    };
}
