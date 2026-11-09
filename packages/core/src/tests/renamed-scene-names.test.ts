import { describe, expect, it } from "vitest";

import { integrateSpeedToClipTime, sourceTimeAtClipElapsed } from "../attributes/audio/ramp";
import { Sound } from "../attributes/audio/sound";
import { ClipTimeline } from "../document/timeline";
import type { VisualDocument } from "../document/types";
import type { NodeEffect } from "../attributes/shape/effects/union";
import {
    integrateSpeedToSceneTime,
    SceneTimeline,
    sourceTimeAtSceneElapsed,
    type SceneDocument,
    type SceneEffect,
} from "../renamed-scene-names";

/** Assignable both ways, or the typecheck fails. */
const same = <A, B>(_check: [A] extends [B] ? ([B] extends [A] ? true : never) : never): void => {};

describe("the scene-named aliases kept until 1.0", () => {
    it("are the renamed values themselves", () => {
        expect(SceneTimeline).toBe(ClipTimeline);
        expect(integrateSpeedToSceneTime).toBe(integrateSpeedToClipTime);
        expect(sourceTimeAtSceneElapsed).toBe(sourceTimeAtClipElapsed);
        const sound = new Sound({ src: "a.mp3", trimEnd: 4 });
        expect(sound.sceneDurationFor(4)).toBe(sound.clipDurationFor(4));
    });

    it("are the renamed types themselves, on the root and the SDK", () => {
        same<SceneDocument, VisualDocument>(true);
        same<SceneEffect, NodeEffect>(true);
        same<import("../sdk/index").SceneDocument, VisualDocument>(true);
        same<import("../sdk/index").SceneEffect, NodeEffect>(true);
    });
});
