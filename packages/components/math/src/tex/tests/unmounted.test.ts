import { describe, expect, it } from "vitest";
import { ContextMap, type Command } from "@motionscript/sdk";
import { ManifestAssetCatalog } from "@motionscript/core";

import { Latex } from "../node";

/** Run `command` to its end from a seek to its start. */
function finish(command: Command<unknown>): void {
    const stepper = command._stepper();
    stepper.seek(0);
    stepper.seek(command.duration);
}

describe("a Latex command on a node that is not in the tree", () => {
    it("keeps its duration and writes nothing", () => {
        const node = new Latex({ latex: "x", fontSize: 32 } as never);
        const morph = node.to({ data: { latex: "y" }, duration: 2 }) as Command<unknown>;
        const named = node.morphTo({ data: { latex: "z" }, duration: 3 }) as Command<unknown>;
        expect(morph.duration).toBe(2);
        expect(named.duration).toBe(3);
        finish(morph);
        finish(named);
        expect(node.latex).toBe("x");
        expect(node.fontSize).toBe(32);
    });

    it("morphs once the node is attached", () => {
        const node = new Latex({ latex: "x", fontSize: 32 } as never);
        node.attach({
            assets: new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} }),
            context: ContextMap.EMPTY,
            time: 0,
        });
        finish(node.to({ data: { latex: "y" }, duration: 1 }) as Command<unknown>);
        expect(node.latex).toBe("y");
    });
});
