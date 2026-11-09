import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { clipTimeToFrame, DEFAULT_FPS, DEFAULT_VIEWPORT, isProjectDocument } from "@motionscript/core";

import type {
    BuildError,
    Engine,
    NodeBox,
    NodeHandle,
    Node3DFrame,
    NodeOverride,
    NodeState,
    NodeTextLayout,
    PlaybackController,
    AssetTimelineResult,
    ProjectDocument,
    ReparentPlacement,
    VisualDocument,
    Session,
    Size2D,
    TrackSpan,
    TreeState,
    Vector2,
    Vector3,
} from "@motionscript/core";

import { createPlayheadStore, type PlayheadStore } from "./playhead";

/**
 * How far background discovery has got. Only the tracks on frame 0 are
 * discovered before the player mounts; the rest stream in behind it (see
 * `AssetTimeline.runAsync`). The timeline's length never waits on it — every track
 * declares its own.
 */
export interface PrecompProgress {
    /** Tracks discovered so far. */
    discoveredTracks: number;
    /** Tracks in the project. */
    totalTracks: number;
    /** True once every track has been discovered. */
    complete: boolean;
}

/**
 * Sessions this hook has disposed. React can replay a child's effects with the
 * `session` it last rendered after this hook's cleanup has run — a suspended
 * boundary being revealed, StrictMode's dev replay — so a stage asks here
 * before binding to the one it was handed.
 */
const disposedSessions = new WeakSet<Session>();

/** @internal Whether `session` was disposed by a player. Not exported from the package. */
export function isSessionDisposed(session: Session): boolean {
    return disposedSessions.has(session);
}

const INITIAL_PRECOMP: PrecompProgress = { discoveredTracks: 0, totalTracks: 0, complete: false };
const NO_ERRORS: BuildError[] = [];

function precompProgressOf(result: AssetTimelineResult): PrecompProgress {
    return {
        discoveredTracks: result.tracks.filter(track => track.discovered).length,
        totalTracks: result.tracks.length,
        complete: result.complete,
    };
}

function samePrecomp(a: PrecompProgress, b: PrecompProgress): boolean {
    return a.discoveredTracks === b.discoveredTracks && a.totalTracks === b.totalTracks && a.complete === b.complete;
}

function sameErrors(a: readonly BuildError[], b: readonly BuildError[]): boolean {
    return a.length === b.length && a.every((error, i) => {
        const other = b[i];
        return error.trackId === other.trackId && error.message === other.message
            && error.nodeId === other.nodeId && error.prop === other.prop && error.stack === other.stack;
    });
}

/** A state updater that keeps the held errors when the report says the same thing. */
function errorsFrom(reported: readonly BuildError[]): (held: BuildError[]) => BuildError[] {
    const next = reported.length === 0 ? NO_ERRORS : reported.slice();
    return held => (sameErrors(held, next) ? held : next);
}

export interface MotionPlayerOptions {
    /**
     * The engine this player opens its session on.
     *
     * Nullable on purpose: building one is asynchronous
     * (`await createBrowserEngine(...)`), so a host gets it from {@link useEngine}
     * and it is `null` for the first render or two. The player no-ops until it
     * arrives, which is what keeps the hook out of a conditional.
     *
     * **Create it once, and share it.** It holds the renderer and the exporter, so
     * a fresh one per render rebuilds the WebGL surface behind every player on
     * it. Identity-compared: a different engine is a different renderer, and so
     * a full rebuild.
     */
    engine: Engine | null | undefined;
    /**
     * What to play. Nothing opens until there is one.
     *
     * A **project** document is the whole answer: it carries its own viewport,
     * fps, theme and tracks. A **scene** document (still or composition) is one
     * clip and carries none of that, so `viewport` and `fps` must come from here
     * or from the engine.
     *
     * Content-diffed, with identity as the fast path: a new document is reconciled
     * onto the running session, each track's built tree patched in place and
     * rebuilt only when its change cannot be patched. Treat documents as
     * immutable — an edit made in place to one the player already holds is not
     * seen.
     *
     * A new document keeps the player's place: the playhead stays where it was
     * (clamped when the timeline got shorter), and playback carries on if it was
     * running. Seek or pause yourself when a swap means "start over".
     */
    document?: ProjectDocument | VisualDocument;
    /** Overrides the engine's, for a source that carries none. */
    viewport?: Size2D;
    /** Overrides the engine's, for a source that carries none. */
    fps?: number;
    /** Initial playback rate. Change it later with {@link Player.setSpeed}. */
    speed?: number;
    /** Initial mute state. Change it later with {@link Player.setMuted}. */
    muted?: boolean;
    /** Initial loop state. Change it later with {@link Player.setLoop}. */
    loop?: boolean;
    /**
     * Called **synchronously**, on the same task as the draw, each time a frame
     * has been painted — whether by the clock, a seek, or a document swap.
     *
     * Not the playhead, which reports where the *clock* is. A seek is
     * asynchronous, so between the two there is a window in which the number has
     * moved and the canvas has not. Reach for this to keep an overlay — a
     * selection box, a caret, a handle — in step with the pixels, and keep the
     * listener cheap: it runs on the render loop, before the browser has had a
     * chance to composite.
     *
     * Read through a ref, so changing it costs nothing.
     */
    onFramePainted?: (frame: number) => void;
}

/**
 * One document, its transport, and the session driving it. No DOM.
 *
 * Hand it to a {@link MotionStage} to put pixels on screen. Two calls to
 * {@link useMotionPlayer} produce two of these with nothing shared but the
 * engine — separate playheads, clocks, audio devices and transports.
 */
export interface Player {
    /** The live session, or `null` before the engine and a document arrive. */
    readonly session: Session | null;
    /** The playhead, read with `usePlayhead(player)`. Stable for the hook's life. */
    readonly playhead: PlayheadStore;
    /** Resolved from the document, else the engine, else 1920×1080. */
    readonly viewport: Size2D;
    /** Resolved from the document, else the engine, else 60. */
    readonly fps: number;

    readonly isPlaying: boolean;
    readonly speed: number;
    readonly muted: boolean;
    readonly loop: boolean;
    /** True while a seek or a document swap is in flight. */
    readonly loading: boolean;
    /** The project's length, known from the document before any track is discovered. */
    readonly duration: number;
    /** {@link duration} in frames, floored at 1. */
    readonly totalFrames: number;
    readonly errors: BuildError[];
    readonly precomp: PrecompProgress;

    play(): void;
    pause(): void;
    toggle(): void;
    /** Seek while paused. Clamped to the timeline. */
    seek(frame: number): void;
    /** Seek relative to where the playhead is now. */
    step(delta: number): void;
    /** Seek without interrupting playback. */
    seekWhilePlaying(frame: number): void;
    setSpeed(speed: number): void;
    setMuted(muted: boolean): void;
    setLoop(loop: boolean): void;

    screenshot(): Promise<string | undefined>;
    /** Re-layout and repaint the current frame — no re-evaluation. */
    repaint(): void;

    getTreeState(): TreeState | null;
    getNodeProps(nodeId: string): NodeState | null;
    /** The node's props before any command has acted on it: the same at every frame, and answered while it is off screen. */
    getNodeInitialProps(nodeId: string): NodeState["properties"] | null;
    /** Where each track sits on the timeline, in document order. */
    getTrackSpans(): readonly TrackSpan[];
    /**
     * Resolves once the paint a document swap scheduled has landed. The swap
     * does not paint before its assets have loaded, so await this before
     * screenshotting or reading the tree.
     */
    whenReplaced(): Promise<void>;

    // ---- Direct manipulation ----------------------------------------------
    // Points are in viewport space — origin at the viewport centre, y-up, in
    // this player's `viewport` pixels.

    getNodeBox(path: string): NodeBox | null;
    getNodePropsAt(path: string): NodeState["properties"] | null;
    getNodeBoxes(): NodeBox[];
    projectNode3D(
        path: string,
        parentPoints: readonly Vector3[],
        localPoints: readonly Vector3[],
    ): Node3DFrame | null;
    /**
     * Where `point` lands on the plane the node at `path` is positioned in, in
     * that plane's own y-up frame. Two answers differ by the `x`/`y` change that
     * moves the node between them — which a screen delta no longer is once the
     * node sits in a 2.5D space.
     */
    parentPlanePoint(path: string, point: Vector2): Vector2 | null;
    /**
     * Where `point` lands in the coordinates the node at `path` positions its
     * children in (a graph's units), or `null` when those are pixels: the
     * `x`/`y` to give a node dropped or pasted there.
     */
    childPlanePoint(path: string, point: Vector2): Vector2 | null;
    /**
     * What keeps the node at `path` looking as it does once it moves under the
     * node at `parentPath`: `offsets` (`x`/`y` values it takes under its parent
     * now) as the ones that put it at the same place there, and the turn to add
     * and the factor to scale by. `null` when that parent arranges its children
     * itself.
     */
    reparentPlacement(path: string, parentPath: string, offsets: readonly Vector2[]): ReparentPlacement | null;
    /** The points an editor may drag on the node at `path` (an arrow's ends), in viewport space. */
    nodeHandles(path: string): NodeHandle[] | null;
    /** The value of `prop` that puts its handle under `point`, or `null`. */
    handleValue(path: string, prop: string, point: Vector2): Vector2 | null;
    getTextLayout(path: string): NodeTextLayout | null;
    /** `tolerance` is grab-slop in scene units. */
    pickNode(point: Vector2, tolerance?: number): NodeBox | null;
    /** Layer transient props over a node without rebuilding its track. */
    setNodeOverride(path: string, props: NodeOverride): void;
    clearNodeOverrides(path?: string): void;
}

/**
 * Opens a session on `engine` and gives you the transport for it.
 *
 * ```tsx
 * const player = useMotionPlayer({ engine, document: doc, loop: true });
 * <MotionStage player={player} />
 * ```
 */
export function useMotionPlayer(options: MotionPlayerOptions): Player {
    const { engine, document, onFramePainted } = options;

    // Read straight off the document where it says so, else the caller's, else
    // the engine's. All plain JSON, so this resolves during render, before any
    // session exists — which is what lets a stage size its canvas on the first
    // pass rather than after a mount.
    const projectDoc = document && isProjectDocument(document) ? document : undefined;
    const resolvedViewport = projectDoc?.viewport ?? options.viewport ?? engine?.viewport ?? DEFAULT_VIEWPORT;
    const fps = projectDoc?.fps ?? options.fps ?? engine?.fps ?? DEFAULT_FPS;

    // Held by size: a host that rebuilds its document per edit rebuilds this
    // object with it, and a new one would hand every consumer a new `Player`.
    const [viewport, setViewport] = useState(resolvedViewport);
    if (viewport.width !== resolvedViewport.width || viewport.height !== resolvedViewport.height) {
        setViewport(resolvedViewport);
    }
    const hasDocument = document !== undefined;

    const [session, setSession] = useState<Session | null>(null);
    /** Created once; stable for the hook's life, so `usePlayhead` never resubscribes. */
    const [playhead] = useState(createPlayheadStore);

    const [isPlaying, setIsPlaying] = useState(false);
    const [speed, setSpeedState] = useState(options.speed ?? 1);
    const [muted, setMutedState] = useState(options.muted ?? false);
    const [loop, setLoopState] = useState(options.loop ?? false);
    const [loading, setLoading] = useState(true);
    const [duration, setDuration] = useState(0);
    const [errors, setErrors] = useState<BuildError[]>(NO_ERRORS);
    const [precomp, setPrecomp] = useState<PrecompProgress>(INITIAL_PRECOMP);

    const totalFrames = Math.max(1, Math.round(duration * fps));

    // Stable across renders so the action callbacks below never need rebuilding.
    const controllerRef = useRef<PlaybackController | null>(null);
    const sessionRef = useRef<Session | null>(null);
    const documentRef = useRef(document);
    const onFramePaintedRef = useRef(onFramePainted);
    /** Monotonic seek id; only the latest may clear the loading flag. */
    const seekTokenRef = useRef(0);
    /** Read by the tick handler, which is installed once and must see the latest. */
    const loopRef = useRef(loop);
    const fpsRef = useRef(fps);
    const speedRef = useRef(speed);
    /**
     * What the transport has been told to do, ahead of the next render. State
     * only shows the last value a batch settled on, and the controller is
     * driven by the calls that were made, so the two can disagree inside one
     * batch (`seek` then `play`).
     */
    const playingRef = useRef(false);

    useEffect(() => {
        onFramePaintedRef.current = onFramePainted;
        loopRef.current = loop;
        fpsRef.current = fps;
        speedRef.current = speed;
        playingRef.current = isPlaying;
    });

    // An edit keeps the transport and its errors — the reconcile effect below
    // re-reads both off the session, so an error the edit did not fix never
    // blinks out for a commit. Only losing the document stops it, during render
    // so nothing draws against a timeline that is gone.
    const [prevDocument, setPrevDocument] = useState(document);
    if (document !== prevDocument) {
        setPrevDocument(document);
        if (document === undefined) {
            setIsPlaying(false);
            setDuration(0);
            if (errors.length > 0) setErrors(NO_ERRORS);
        }
    }

    /**
     * Pull what the controller now knows: timeline length, errors, progress.
     * Runs on every swap, so it keeps whatever did not change — a fresh array or
     * object here is a new `Player` for every consumer on every edit.
     */
    const sync = useCallback((pc: PlaybackController) => {
        setDuration(pc.totalDuration);
        setErrors(errorsFrom(pc.buildErrors));
        const progress = precompProgressOf(pc.precomp);
        setPrecomp(held => (samePrecomp(held, progress) ? held : progress));
    }, []);

    /**
     * Move the playhead and repaint, with the loading flag the UI paces off.
     *
     * Created once so every caller — the transport, the reconcile effect and
     * the first paint after a session opens — shares one seek discipline.
     */
    const [seekTo] = useState(() => (frame: number): Promise<boolean> => {
        const pc = controllerRef.current;
        if (!pc) return Promise.resolve(false);
        const last = Math.max(0, Math.round(pc.totalDuration * fpsRef.current) - 1);
        const clamped = Math.min(Math.max(0, Math.round(frame)), last);
        playhead.set(clamped);
        // Only the newest seek may report "settled". A superseded seek still
        // resolves — its generation guard bailed inside the controller — but it
        // never painted, so clearing the loading flag from it would tell the UI
        // a frame is ready while the newest is still in flight. Consumers pace
        // scrubbing off that edge.
        const token = ++seekTokenRef.current;
        setLoading(true);
        // Resolves `true` when this was still the newest seek as it landed.
        return pc.seek(clamped).then(() => {
            const newest = token === seekTokenRef.current;
            if (newest) setLoading(false);
            return newest;
        });
    });

    useEffect(() => {
        if (!engine || !document) return;

        // `target` is omitted: the session opens unmounted, and a `MotionStage`
        // binds a canvas to it afterwards. That is what lets this hook own the
        // session without owning any DOM.
        const opened = engine.open({
            document,
            viewport,
            fps,
            // A track landing can surface a build error it threw.
            onPrecompProgress: () => sync(opened.controller),
        });

        const pc = opened.controller;
        pc.onRenderError = errs => setErrors(errorsFrom(errs));
        pc.onFramePainted = frame => onFramePaintedRef.current?.(frame);

        pc.onTime((t: number) => {
            const frame = Math.floor(clipTimeToFrame(t, fpsRef.current));
            playhead.set(frame);

            // A document swap can change the timeline's length, so ask the
            // controller rather than trusting a duration captured when this
            // listener was installed.
            const last = Math.round(pc.totalDuration * fpsRef.current) - 1;
            if (frame < last) return;
            if (loopRef.current) pc.seekWhilePlaying(0);
            else {
                playingRef.current = false;
                setIsPlaying(false);
            }
        });

        controllerRef.current = pc;
        sessionRef.current = opened;
        documentRef.current = document;
        setSession(opened);
        sync(pc);
        setLoading(true);

        return () => {
            controllerRef.current = null;
            sessionRef.current = null;
            setSession(null);
            // Disposes the controller and the render context together — the
            // session owns both.
            disposedSessions.add(opened);
            opened.dispose();
        };
        // `document` is deliberately absent — only whether there is one: a new
        // document is reconciled onto the live session by the effect below
        // rather than rebuilt into a new one. What remains genuinely does need a
        // rebuild — a different engine is a different renderer, and a live
        // surface cannot change its size or rate (`Session.replace` refuses both).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine, hasDocument, viewport.width, viewport.height, fps, sync]);

    // Reconcile a changed document onto the session already running. Skipped on
    // the pass that opens it, which was opened with this very document —
    // replacing it there would rediscover a timeline just discovered.
    useEffect(() => {
        if (documentRef.current === document) return;
        documentRef.current = document;
        const live = sessionRef.current;
        if (!live || !document) return;
        const pc = live.controller;
        live.replace(document);
        sync(pc);
        // No seek: `replace` already paints the current frame once its assets
        // load, clamped to the new length, and a running clock keeps ticking.
        const last = Math.max(0, Math.round(pc.totalDuration * fpsRef.current) - 1);
        playhead.set(Math.min(playhead.getSnapshot(), last));
        const token = ++seekTokenRef.current;
        setLoading(true);
        void pc.whenReplaced().then(() => {
            if (token === seekTokenRef.current) setLoading(false);
        });
    }, [document, sync, playhead]);

    useEffect(() => {
        const pc = controllerRef.current;
        if (!pc) return;
        if (isPlaying) pc.play(speed);
        else pc.pause();
    }, [session, isPlaying, speed]);

    useEffect(() => {
        controllerRef.current?.setMuted(muted);
    }, [session, muted]);

    // The one seek that isn't user-driven: park the new session on the frame
    // the playhead already holds, so a rebuild keeps its place.
    //
    // A seek pauses the clock, and the clock effect above has already started
    // this session, so a player that was playing resumes once the park lands
    // (with its assets loaded, so the first ticks draw rather than catch up). It
    // does not if the transport moved meanwhile: a newer seek, or a pause.
    useEffect(() => {
        const pc = controllerRef.current;
        if (!pc) return;
        const wasPlaying = playingRef.current;
        const parked = seekTo(playhead.getSnapshot());
        if (!wasPlaying) return;
        void parked.then(newest => {
            if (!newest || controllerRef.current !== pc || !playingRef.current || pc.isPlaying) return;
            pc.play(speedRef.current);
        });
    }, [session, playhead, seekTo]);

    // Built once and stable for the hook's life: every one reads the controller
    // through a ref, so a re-render never invalidates a handler a child holds —
    // which is what lets a transport subscribe its listeners a single time.
    const [actions] = useState<Omit<Player, keyof PlayerState>>(() => {
        // Scrubbing is a pause: a seek that left the clock running would be
        // overwritten by the next tick.
        const seek = (frame: number) => {
            playingRef.current = false;
            setIsPlaying(false);
            void seekTo(frame);
        };

        return {
            playhead,
            // Both drive the controller as well as the state. In one batch a
            // `seek` and a `play` cancel out in state (`true`, `false`, `true`
            // while playing), so the effect on `isPlaying` never re-runs, yet the
            // seek has already paused the clock; the state is the settled
            // answer and the controller is what was actually asked.
            play: () => {
                playingRef.current = true;
                setIsPlaying(true);
                const pc = controllerRef.current;
                if (pc && !pc.isPlaying) pc.play(speedRef.current);
            },
            pause: () => {
                playingRef.current = false;
                setIsPlaying(false);
                controllerRef.current?.pause();
            },
            toggle: () =>
                setIsPlaying(playing => {
                    // Restarting from the end is what a play button means there.
                    const pc = controllerRef.current;
                    if (!playing && pc) {
                        const last = Math.round(pc.totalDuration * fpsRef.current) - 1;
                        if (playhead.getSnapshot() >= last) void pc.seek(0);
                    }
                    return !playing;
                }),
            seek,
            step: (delta: number) => seek(playhead.getSnapshot() + delta),
            seekWhilePlaying: (frame: number) => controllerRef.current?.seekWhilePlaying(frame),
            setSpeed: (next: number) => setSpeedState(next),
            setMuted: (next: boolean) => setMutedState(next),
            setLoop: (next: boolean) => setLoopState(next),

            screenshot: async () => controllerRef.current?.screenshot() ?? undefined,
            repaint: () => controllerRef.current?.repaint(),

            getTreeState: () => controllerRef.current?.getTreeState() ?? null,
            getNodeProps: (nodeId: string) => controllerRef.current?.getNodeState(nodeId) ?? null,
            getNodeInitialProps: (nodeId: string) => controllerRef.current?.getNodeInitialProps(nodeId) ?? null,
            getTrackSpans: () => controllerRef.current?.spans ?? [],
            whenReplaced: async () => {
                await controllerRef.current?.whenReplaced();
            },

            getNodeBox: (path: string) => controllerRef.current?.getNodeBox(path) ?? null,
            getNodePropsAt: (path: string) => controllerRef.current?.getNodePropsAt(path) ?? null,
            getNodeBoxes: () => controllerRef.current?.getNodeBoxes() ?? [],
            projectNode3D: (path, parentPoints, localPoints) =>
                controllerRef.current?.projectNode3D(path, parentPoints, localPoints) ?? null,
            parentPlanePoint: (path: string, point: Vector2) =>
                controllerRef.current?.parentPlanePoint(path, point) ?? null,
            childPlanePoint: (path: string, point: Vector2) =>
                controllerRef.current?.childPlanePoint(path, point) ?? null,
            reparentPlacement: (path: string, parentPath: string, offsets: readonly Vector2[]) =>
                controllerRef.current?.reparentPlacement(path, parentPath, offsets) ?? null,
            nodeHandles: (path: string) => controllerRef.current?.nodeHandles(path) ?? null,
            handleValue: (path: string, prop: string, point: Vector2) =>
                controllerRef.current?.handleValue(path, prop, point) ?? null,
            getTextLayout: (path: string) => controllerRef.current?.getTextLayout(path) ?? null,
            pickNode: (point: Vector2, tolerance?: number) =>
                controllerRef.current?.pickNode(point, tolerance) ?? null,
            setNodeOverride: (path: string, props: NodeOverride) =>
                controllerRef.current?.setNodeOverride(path, props),
            clearNodeOverrides: (path?: string) => controllerRef.current?.clearNodeOverrides(path),
        };
    });

    return useMemo(
        () => ({
            ...actions,
            session,
            viewport,
            fps,
            isPlaying,
            speed,
            muted,
            loop,
            loading,
            duration,
            totalFrames,
            errors,
            precomp,
        }),
        [
            actions,
            session,
            viewport,
            fps,
            isPlaying,
            speed,
            muted,
            loop,
            loading,
            duration,
            totalFrames,
            errors,
            precomp,
        ],
    );
}

/** The fields the memo above supplies; everything else on `Player` is an action. */
type PlayerState = Pick<
    Player,
    | "session"
    | "viewport"
    | "fps"
    | "isPlaying"
    | "speed"
    | "muted"
    | "loop"
    | "loading"
    | "duration"
    | "totalFrames"
    | "errors"
    | "precomp"
>;
