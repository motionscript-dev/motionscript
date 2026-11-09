import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clipFrameToTime, DEFAULT_FPS, DEFAULT_VIEWPORT, type Engine, type ProjectDocument, type Session } from "@motionscript/core";
import { useMotionPlayer, type MotionPlayerOptions, type Player } from "../use-motion-player";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A controller with the one behaviour the hook's transport depends on: `seek`
 * pauses the clock before its first await, exactly as the real one does.
 */
class FakeController {
    playing = false;
    speed = 1;
    frame = 0;
    totalDuration = 10;
    buildErrors = [];
    precomp = { tracks: [], complete: true };
    onRenderError: unknown = null;
    onFramePainted: unknown = null;
    readonly log: string[] = [];

    get isPlaying() {
        return this.playing;
    }
    readonly timeListeners: ((time: number) => void)[] = [];
    onTime(listener: (time: number) => void) {
        this.timeListeners.push(listener);
    }
    play(speed = 1) {
        this.playing = true;
        this.speed = speed;
        this.log.push("play");
    }
    pause() {
        this.playing = false;
        this.log.push("pause");
    }
    seek(frame: number) {
        this.playing = false;
        this.frame = frame;
        this.log.push(`seek ${frame}`);
        return Promise.resolve();
    }
    seekWhilePlaying(frame: number) {
        this.frame = frame;
        this.log.push(`seekWhilePlaying ${frame}`);
    }
    setMuted() { /* unused */ }
    whenReplaced() {
        return Promise.resolve();
    }
}

interface FakeEngine {
    engine: Engine;
    controllers: FakeController[];
}

function fakeEngine(): FakeEngine {
    const controllers: FakeController[] = [];
    const engine = {
        viewport: { width: 1920, height: 1080 },
        fps: 30,
        open() {
            const controller = new FakeController();
            controllers.push(controller);
            return { controller, dispose() { /* nothing to free */ }, replace() { /* unused */ } } as unknown as Session;
        },
    } as unknown as Engine;
    return { engine, controllers };
}

const DOCUMENT = { kind: "project", name: "p", fps: 30, viewport: { width: 640, height: 360 }, tracks: [] } as unknown as ProjectDocument;
const RESIZED = { ...DOCUMENT, viewport: { width: 800, height: 450 } } as ProjectDocument;

describe("useMotionPlayer transport", () => {
    let container: HTMLElement;
    let root: Root;
    let player: Player;
    let fake: FakeEngine;

    function Harness(props: MotionPlayerOptions): ReactElement | null {
        player = useMotionPlayer(props);
        return null;
    }

    async function render(options: Partial<MotionPlayerOptions>) {
        await act(async () => {
            root.render(createElement(Harness, { engine: fake.engine, document: DOCUMENT, ...options }));
        });
    }

    const live = () => fake.controllers[fake.controllers.length - 1];

    beforeEach(() => {
        fake = fakeEngine();
        container = document.createElement("div");
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
    });

    it("plays after a seek in the same batch, from a paused player", async () => {
        await render({});
        await act(async () => {
            player.seek(30);
            player.play();
        });
        expect(player.isPlaying).toBe(true);
        expect(live().playing).toBe(true);
    });

    it("plays after a seek in the same batch, while already playing", async () => {
        await render({});
        await act(async () => player.play());
        expect(live().playing).toBe(true);

        await act(async () => {
            player.seek(30);
            player.play();
        });
        expect(player.isPlaying).toBe(true);
        expect(live().playing).toBe(true);
    });

    it("plays at the player's speed when it resumes after a seek", async () => {
        await render({ speed: 2 });
        await act(async () => player.play());
        await act(async () => {
            player.seek(30);
            player.play();
        });
        expect(live().playing).toBe(true);
        expect(live().speed).toBe(2);
    });

    it("stays paused after play then pause in one batch", async () => {
        await render({});
        await act(async () => {
            player.play();
            player.pause();
        });
        expect(player.isPlaying).toBe(false);
        expect(live().playing).toBe(false);
    });

    it("keeps playing, on the same frame, when a rebuild lands while playing", async () => {
        await render({});
        await act(async () => player.play());
        await act(async () => player.seekWhilePlaying(45));
        player.playhead.set(45);

        await render({ document: RESIZED });

        expect(fake.controllers).toHaveLength(2);
        expect(player.isPlaying).toBe(true);
        expect(live().frame).toBe(45);
        expect(live().playing).toBe(true);
    });

    it("stays paused through a rebuild when it was paused", async () => {
        await render({});
        await act(async () => player.seek(45));

        await render({ document: RESIZED });

        expect(fake.controllers).toHaveLength(2);
        expect(live().frame).toBe(45);
        expect(live().playing).toBe(false);
        expect(player.isPlaying).toBe(false);
    });

    it("does not resume a rebuilt session the user paused while it was loading", async () => {
        await render({});
        await act(async () => player.play());

        await act(async () => {
            root.render(createElement(Harness, { engine: fake.engine, document: RESIZED }));
            player.pause();
        });

        expect(player.isPlaying).toBe(false);
        expect(live().playing).toBe(false);
    });

    it.each([24, 25, 30, 60])("reads the frame the clock reports, for every frame at %i fps", async (fps) => {
        await render({ document: { ...DOCUMENT, fps } as ProjectDocument });
        const listener = live().timeListeners[0];
        // The fake's ten seconds; a frame time is `frame * (1 / fps)`, which floored
        // as `frame / fps * fps` reads a frame early for some of these.
        for (let frame = 0; frame < fps * 10 - 1; frame++) {
            act(() => listener(clipFrameToTime(frame, fps)));
            expect(player.playhead.getSnapshot()).toBe(frame);
        }
    });

    it("takes its viewport and frame rate from the engine's defaults when nothing else says", async () => {
        await render({ engine: undefined, document: undefined });
        expect(player.viewport).toEqual(DEFAULT_VIEWPORT);
        expect(player.fps).toBe(DEFAULT_FPS);
    });
});
