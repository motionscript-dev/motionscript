import { describe, it, expect } from "vitest";

import { AssetNotLoadedError } from "@/assets/errors";
import type { BuildError } from "@/runtime/asset-timeline";
import { node, openController, project, still, track } from "@/runtime/document.fixtures";
import { FakeRenderContext, FakeStorageAdapter, asStorage } from "@/runtime/runtime.fixtures";

/**
 * A frame that reaches for an asset no measuring pass ever declared.
 *
 * The asset timeline is built from what the precomp *saw*, and the tree that
 * draws is not only what the precomp saw: {@link PlaybackController.setNodeOverride}
 * writes straight onto live prop slots. A host previewing an edit can therefore put
 * a picture on a node no pass has named — which is exactly what choosing an
 * image fill in an inspector does, because the rebuild that would declare it is
 * held while the edit is open. Nothing opens a window, nothing loads the
 * picture, and the draw throws `AssetNotLoadedError`.
 *
 * Reporting that is honest and useless: the fault is curable, and the error says
 * which source to cure it with. So the controller loads it and paints again, and
 * the host hears about it only if the load fails too.
 */

const VIEWPORT = { width: 800, height: 600 };
const SRC = "late.png";

/**
 * A pass that throws the error a media fill throws when its decode is missing,
 * until told the load has happened.
 *
 * Standing in for the fill itself: what is under test is the controller's
 * response to that throw, and building a real image fill would drag a decoder
 * into a test about error handling.
 */
class ThrowingRenderContext extends FakeRenderContext {
    missing = true;

    override execute(draw: () => void): void {
        this.renderCount++;
        if (this.missing) throw new AssetNotLoadedError("image", SRC);
        draw();
    }
}

function makeController(storage: FakeStorageAdapter, rc: ThrowingRenderContext) {
    // The catalog knows the picture; only the measured pass does not. That is the
    // whole shape of the bug — the source is resolvable, it simply was never
    // declared, so nothing ever opened a window over it.
    const { controller } = openController(
        project([track("a", still(node("card", "rect", { width: 100, height: 60 })), { duration: 0.5 })], { viewport: VIEWPORT }),
        { storageAdapter: asStorage(storage), renderContext: rc },
    );
    return controller;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a frame that draws an asset nothing declared", () => {
    it("loads it and repaints instead of reporting it", async () => {
        const storage = new FakeStorageAdapter();
        const rc = new ThrowingRenderContext();
        const controller = makeController(storage, rc);
        const reported: unknown[] = [];
        controller.onRenderError = (errors) => reported.push(...errors);
        // Loading it is what makes it drawable, so the fake says so — otherwise
        // the repaint would find it missing again and this would be a test about
        // an asset that genuinely isn't there.
        const load = storage.loadAsset.bind(storage);
        storage.loadAsset = (key, record) => {
            if (key === SRC) rc.missing = false;
            return load(key, record);
        };

        await controller.seek(0);
        await flush();

        const rescue = storage.loadAssetCalls.find((call) => call.key === SRC);
        expect(rescue).toBeDefined();
        expect(rescue!.record).toMatchObject({ type: "image", src: SRC });
        expect(rc.renderCount).toBeGreaterThan(1);

        expect(reported).toEqual([]);
        expect(controller.buildErrors).toEqual([]);

        controller.dispose();
    });

    it("tries each source once, however many frames ask for it", async () => {
        const storage = new FakeStorageAdapter();
        const rc = new ThrowingRenderContext();
        const controller = makeController(storage, rc);

        await controller.seek(0);
        await flush();
        // Still missing, so every one of these throws again. A rescue per frame
        // would be a fetch loop under a scrub.
        await controller.seek(1);
        await controller.seek(2);
        await flush();

        expect(storage.loadAssetCalls.filter((call) => call.key === SRC)).toHaveLength(1);

        controller.dispose();
    });

    it("reports the original failure, against the track on screen, when the load cannot fix it either", async () => {
        const storage = new FakeStorageAdapter();
        storage.loadShouldReject = true;
        const rc = new ThrowingRenderContext();
        const controller = makeController(storage, rc);
        let reported: BuildError[] = [];
        controller.onRenderError = (errors) => { reported = errors; };

        await controller.seek(0);
        await flush();
        await flush();

        expect(reported.some((e) => e.message.includes(SRC))).toBe(true);
        expect(reported.some((e) => e.message.includes("Loading it directly also failed"))).toBe(true);
        expect(reported.every((e) => e.trackId === "a")).toBe(true);

        controller.dispose();
    });

    it("tries a source again after the draw-time errors are cleared, since they were about a document that is gone", async () => {
        const storage = new FakeStorageAdapter();
        const rc = new ThrowingRenderContext();
        const controller = makeController(storage, rc);

        await controller.seek(0);
        await flush();
        await controller.seek(1);
        await flush();
        expect(storage.loadAssetCalls.filter((call) => call.key === SRC)).toHaveLength(1);

        controller.clearRenderErrors();
        await controller.seek(2);
        await flush();

        expect(storage.loadAssetCalls.filter((call) => call.key === SRC)).toHaveLength(2);

        controller.dispose();
    });

    it("tries a source again after a new document is swapped in, which clears the same errors", async () => {
        const storage = new FakeStorageAdapter();
        const rc = new ThrowingRenderContext();
        const controller = makeController(storage, rc);

        await controller.seek(0);
        await flush();
        controller.setProject(project([track("a", still(node("card", "rect", { width: 80, height: 60 })), { duration: 0.5 })], { viewport: VIEWPORT }));
        await controller.whenReplaced();
        await flush();

        expect(storage.loadAssetCalls.filter((call) => call.key === SRC)).toHaveLength(2);

        controller.dispose();
    });
});
