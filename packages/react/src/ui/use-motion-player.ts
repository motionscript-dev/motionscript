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

/** Background asset discovery: only frame-0 tracks are discovered before mount, the rest stream in. The timeline's length never waits on it. */
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
 * `session` it last rendered after this hook's cleanup ran (a suspended
 * boundary revealed, StrictMode), so a stage asks here before binding.
 */
const disposedSessions = new WeakSet<Session>();

/** @internal Not exported from the package. */
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
     * The engine this player opens its session on. Nullable because building one
     * is async ({@link useEngine}): the player no-ops until it arrives.
     *
     * Create it once and share it: it holds the renderer and the exporter, so a
     * fresh one per render rebuilds the renderer behind every player on it.
     * Compared by identity; a different engine is a full rebuild.
     */
    engine: Engine | null | undefined;
    /**
     * What to play; nothing opens until there is one. A project document carries
     * its own viewport, fps, theme and tracks; a scene document (still or
     * composition) carries none, so `viewport` and `fps` come from here or the
     * engine.
     *
     * Content-diffed, identity first: a new document is reconciled onto the
     * running session, each track patched in place and rebuilt only when it
     * cannot be. Treat documents as immutable: an in-place edit is not seen.
     *
     * A new document keeps the player's place (the playhead is clamped to a
     * shorter timeline, playback carries on). Seek or pause yourself when a swap
     * means "start over".
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
     * Called synchronously, on the same task as the draw, each time a frame has
     * been painted (clock, seek or document swap).
     *
     * Not the playhead, which reports where the clock is: a seek is async, so the
     * number can move before the canvas does. Use it to keep an overlay in step
     * with the pixels, and keep it cheap: it runs on the render loop. Read through
     * a ref, so changing it costs nothing.
     */
    onFramePainted?: (frame: number) => void;
}

/** A document's transport and its session, with no DOM. Two calls to {@link useMotionPlayer} share only the engine. */
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
    /** Pauses, then seeks. Clamped to the timeline. */
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

    // Points below are in viewport space: origin at the viewport centre, y-up, in
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

    // Document, then options, then engine. Resolved during render, before any
    // session exists, so a stage can size its canvas on the first pass.
    const projectDoc = document && isProjectDocument(document) ? document : undefined;
    const resolvedViewport = projectDoc?.viewport ?? options.viewport ?? engine?.viewport ?? DEFAULT_VIEWPORT;
    const fps = projectDoc?.fps ?? options.fps ?? engine?.fps ?? DEFAULT_FPS;

    // Held by size: a host that rebuilds its document per edit would otherwise
    // hand every consumer a new `Player`.
    const [viewport, setViewport] = useState(resolvedViewport);
    if (viewport.width !== resolvedViewport.width || viewport.height !== resolvedViewport.height) {
        setViewport(resolvedViewport);
    }
    const hasDocument = document !== undefined;

    const [session, setSession] = useState<Session | null>(null);
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
     * What the transport was told to do, ahead of the next render. State shows
     * only the last value a batch settled on, so it can disagree with the
     * controller inside one batch (`seek` then `play`).
     */
    const playingRef = useRef(false);

    useEffect(() => {
        onFramePaintedRef.current = onFramePainted;
        loopRef.current = loop;
        fpsRef.current = fps;
        speedRef.current = speed;
        playingRef.current = isPlaying;
    });

    // An edit keeps the transport and errors (the reconcile effect re-reads both,
    // so an unfixed error never blinks out); only losing the document stops it,
    // during render so nothing draws against a timeline that is gone.
    const [prevDocument, setPrevDocument] = useState(document);
    if (document !== prevDocument) {
        setPrevDocument(document);
        if (document === undefined) {
            setIsPlaying(false);
            setDuration(0);
            if (errors.length > 0) setErrors(NO_ERRORS);
        }
    }

    /** Pulls duration, errors and progress off the controller, keeping what did not change: a fresh array or object is a new `Player` on every edit. */
    const sync = useCallback((pc: PlaybackController) => {
        setDuration(pc.totalDuration);
        setErrors(errorsFrom(pc.buildErrors));
        const progress = precompProgressOf(pc.precomp);
        setPrecomp(held => (samePrecomp(held, progress) ? held : progress));
    }, []);

    /** One instance, so the transport, the reconcile effect and a session's first paint share one seek discipline. */
    const [seekTo] = useState(() => (frame: number): Promise<boolean> => {
        const pc = controllerRef.current;
        if (!pc) return Promise.resolve(false);
        const last = Math.max(0, Math.round(pc.totalDuration * fpsRef.current) - 1);
        const clamped = Math.min(Math.max(0, Math.round(frame)), last);
        playhead.set(clamped);
        // A superseded seek still resolves (its generation guard bailed in the
        // controller) but never painted, so only the newest may clear `loading`:
        // consumers pace scrubbing off that edge.
        const token = ++seekTokenRef.current;
        setLoading(true);
        return pc.seek(clamped).then(() => {
            const newest = token === seekTokenRef.current;
            if (newest) setLoading(false);
            return newest;
        });
    });

    useEffect(() => {
        if (!engine || !document) return;

        // `target` is omitted: the session opens unmounted and a `MotionStage`
        // binds a canvas afterwards, so this hook owns no DOM.
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

            // Asks the controller: a swap can change the length after this
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
            disposedSessions.add(opened);
            opened.dispose();
        };
        // `document` is deliberately absent (only whether there is one): the effect
        // below reconciles a new one onto the live session. Everything listed
        // needs a rebuild: a different engine is a different renderer, and a live
        // surface cannot change size or rate (`Session.replace` refuses both).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine, hasDocument, viewport.width, viewport.height, fps, sync]);

    // Reconcile a changed document onto the running session. Skipped on the pass
    // that opened it, which already holds this document.
    useEffect(() => {
        if (documentRef.current === document) return;
        documentRef.current = document;
        const live = sessionRef.current;
        if (!live || !document) return;
        const pc = live.controller;
        live.replace(document);
        sync(pc);
        // No seek: `replace` paints the current frame once its assets load, and a
        // running clock keeps ticking.
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

    // Parks a new session on the frame the playhead holds, so a rebuild keeps its
    // place. The seek pauses the clock the effect above just started, so a player
    // that was playing resumes once the park lands (assets loaded, so the first
    // ticks draw rather than catch up), unless a newer seek or a pause moved the
    // transport meanwhile.
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

    // Built once: every action reads the controller through a ref, so a re-render
    // never invalidates a handler a child holds.
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
            // Both drive the controller as well as state: in one batch a `seek` and
            // a `play` cancel out in state, so the `isPlaying` effect never re-runs
            // though the seek already paused the clock.
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
