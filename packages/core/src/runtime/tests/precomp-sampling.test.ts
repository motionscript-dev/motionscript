import { describe, expect, it } from "vitest";

import { ManifestAssetCatalog } from "@/assets/catalog";
import { Fills } from "@/attributes/shape/fill/chain";
import { documentDuration, type CompositionDocument } from "@/document/types";
import { comp, node, precompFor, probeRegistry, project, runtimeScope, track } from "@/runtime/document.fixtures";
import type { TrackAssets } from "@/runtime/asset-timeline";
import { walkedAssetRecords } from "@/runtime/asset-walk.fixtures";

const FPS = 10;
const VIEWPORT = { width: 200, height: 200 };

const catalog = () => new ManifestAssetCatalog({
    image: { "pic.png": { src: "pic.png", width: 64, height: 64, sizeBytes: 4096 } },
    video: {},
    audio: {},
    font: {},
});

/**
 * A rect whose fill tweens from a colour to an image over `[1s, 2s]`, on a
 * three-second clip — frames 10 to 20 at 10fps.
 *
 * Frame 10 is the tween's start, where the fill still holds only the colour;
 * `lerpFillArray` cross-fades a non-lerpable pair, so both are painted from the
 * frame after it onward.
 */
function crossFadeDoc(): CompositionDocument {
    return {
        kind: "composition",
        duration: 3,
        nodes: [{ id: "card", type: "rect", parentId: null, layerOrder: 0, props: { width: 100, height: 100, fill: "#ff0000" } }],
        commands: [
            {
                id: "swap-fill",
                type: "to",
                targetId: "card",
                at: 1,
                duration: 1,
                args: { fill: Fills.image("pic.png") },
            },
        ],
    };
}

/** The mirror of {@link crossFadeDoc}: the image is there from the start and is tweened away over `[1s, 2s]`. */
function fadeOutDoc(): CompositionDocument {
    return {
        kind: "composition",
        duration: 3,
        nodes: [{ id: "card", type: "rect", parentId: null, layerOrder: 0, props: { width: 100, height: 100, fill: Fills.image("pic.png") } }],
        commands: [
            {
                id: "swap-fill",
                type: "to",
                targetId: "card",
                at: 1,
                duration: 1,
                args: { fill: "#ff0000" },
            },
        ],
    };
}

/** A picture that is removed from the clip part-way through, rather than faded. */
function removedDoc(): CompositionDocument {
    return {
        kind: "composition",
        duration: 3,
        nodes: [{
            id: "card", type: "rect", parentId: null, layerOrder: 0, endAt: 1,
            props: { width: 100, height: 100, fill: Fills.image("pic.png") },
        }],
        commands: [],
    };
}

type Measured = Pick<TrackAssets, "frameCount" | "assetRecords">;

function measure(doc: CompositionDocument): Measured {
    return precompFor(project([track("a", doc)], { viewport: VIEWPORT }), { assets: catalog() }).run().tracks[0];
}

const scope = () => runtimeScope({ fps: FPS, viewport: VIEWPORT, assets: catalog() });

/** Every frame put into its state and asked for its assets. */
const walked = (doc: CompositionDocument) => walkedAssetRecords(doc, documentDuration(doc), scope());

const windows = (records: TrackAssets["assetRecords"]) =>
    Object.fromEntries([...records].map(([key, r]) => [key, [r.startFrame, r.endFrame]]));

describe("AssetTimeline – asset windows against the frame walk", () => {
    it("costs a hold the same however long it is held", () => {
        const declares = (seconds: number) => {
            const { registry, log } = probeRegistry();
            precompFor(project([track("a", comp([node("p", "probe")], [seconds]))]), { registry }).run();
            return log.declares;
        };
        expect(declares(10)).toBe(declares(1));
    });

    it.each([
        ["a cross-faded image, from the frame after the tween starts", crossFadeDoc, { "pic.png": [11, 29] }],
        ["an image faded out, until the fill has finished becoming a colour", fadeOutDoc, { "pic.png": [0, 19] }],
        ["a removed node's image, until the node actually goes", removedDoc, { "pic.png": [0, 9] }],
    ] as const)("declares %s — exactly what the walk declares", (_name, doc, expected) => {
        const measured = measure(doc());
        expect(measured.frameCount).toBe(30);
        expect(windows(measured.assetRecords)).toEqual(windows(walked(doc())));
        expect(windows(measured.assetRecords)).toEqual(expected);
    });
});
