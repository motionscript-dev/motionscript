import { act, createElement, StrictMode, Suspense, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Engine, ProjectDocument, Session, Size2D } from "@motionscript/core";
import { MotionStage } from "../stage";
import { useMotionPlayer } from "../use-motion-player";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A render context that fails the way the real one does once disposed. */
class FakeSurface {
    disposed = false;
    readonly mounts: { width: number; height: number }[] = [];
    pixelRatio = 1;
    view: unknown = null;
    frame: unknown = null;
    clipToFrame = true;
    frameBackground = "black";

    mount(canvas: HTMLCanvasElement) {
        if (this.disposed) throw new Error("mounted a disposed surface");
        this.mounts.push({ width: canvas.width, height: canvas.height });
    }
}

function fakeEngine() {
    const surfaces: FakeSurface[] = [];
    const engine = {
        viewport: { width: 1920, height: 1080 },
        fps: 30,
        open({ viewport }: { viewport: Size2D }) {
            const surface = new FakeSurface();
            surfaces.push(surface);
            const controller = {
                isPlaying: false,
                totalDuration: 10,
                buildErrors: [],
                precomp: { tracks: [], complete: true },
                onTime() { /* no clock */ },
                play() { /* no clock */ },
                pause() { /* no clock */ },
                seek: () => Promise.resolve(),
                setMuted() { /* silent */ },
                repaint() {
                    if (surface.disposed) throw new Error("repainted a disposed session");
                },
                whenReplaced: () => Promise.resolve(),
            };
            return {
                viewport,
                controller,
                surface,
                dispose() {
                    surface.disposed = true;
                },
                replace() { /* unused */ },
            } as unknown as Session;
        },
    } as unknown as Engine;
    return { engine, surfaces };
}

const DOCUMENT = { kind: "composition", nodes: {}, commands: [] } as unknown as ProjectDocument;

describe("MotionStage", () => {
    let container: HTMLElement;
    let root: Root;
    let fake: ReturnType<typeof fakeEngine>;

    function Harness({ viewport }: { viewport: Size2D }): ReactElement {
        const player = useMotionPlayer({ engine: fake.engine, document: DOCUMENT, viewport });
        return createElement(MotionStage, { player });
    }

    async function render(viewport: Size2D) {
        await act(async () => root.render(createElement(Harness, { viewport })));
    }

    beforeEach(() => {
        fake = fakeEngine();
        container = document.createElement("div");
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
    });

    // The player's viewport moves a commit before its session does, and that
    // commit's cleanup has already disposed the old session.
    it("binds the new session, not the disposed one, when the viewport changes", async () => {
        await render({ width: 640, height: 360 });
        await render({ width: 360, height: 640 });

        expect(fake.surfaces).toHaveLength(2);
        expect(fake.surfaces[0]!.mounts).toEqual([{ width: 640, height: 360 }]);
        expect(fake.surfaces[1]!.mounts).toEqual([{ width: 360, height: 640 }]);
    });

    // A sibling suspending after the session opened hides the boundary, which
    // disposes the session; revealing it replays the stage's effects with that
    // disposed session before the player has opened a new one.
    it("never mounts a disposed session when a suspended boundary is revealed", async () => {
        let release!: () => void;
        const pending = new Promise<void>(resolve => (release = resolve));
        let suspend = false;
        let settled = false;
        void pending.then(() => (settled = true));
        function Suspender(): null {
            if (suspend && !settled) throw pending;
            return null;
        }
        const tree = () =>
            createElement(
                StrictMode,
                null,
                createElement(
                    Suspense,
                    { fallback: null },
                    createElement(Harness, { viewport: { width: 640, height: 360 } }),
                    createElement(Suspender),
                ),
            );

        await act(async () => root.render(tree()));
        suspend = true;
        await act(async () => root.render(tree()));
        await act(async () => {
            release();
            await pending;
        });

        expect(fake.surfaces.filter(surface => !surface.disposed)).toHaveLength(1);
        expect(fake.surfaces.filter(surface => !surface.disposed)[0]!.mounts.length).toBeGreaterThan(0);
    });
});
