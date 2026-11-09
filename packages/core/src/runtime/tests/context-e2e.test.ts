import { describe, it, expect } from "vitest";
import type { Node } from "@/components/trees/node/node";
import type { Text } from "@/components/builtins/text/text";
import { ThemeToken } from "@/runtime/builtin-context";
import { comp, evaluatorFor, node, project, still, track } from "@/runtime/document.fixtures";
import { nodeAt } from "@/runtime/node-picking";
import type { StateEvaluator } from "@/runtime/state-evaluator";

/** The node at a structural path in the track on screen. */
function at<T extends Node>(ev: StateEvaluator, path: string): T {
    return nodeAt(ev.currentCanvas!, path) as T;
}

describe("context — through the evaluator", () => {
    it("a tween from an inherited default snapshots the inherited value, not the raw default", () => {
        const clip = comp(
            [node("style", "default-text-style", { fontSize: 32 }), node("txt", "text", { text: "hi" }, "style")],
            [{ target: "txt", args: { fontSize: 64 }, duration: 0.5 }],
        );
        const ev = evaluatorFor(project([track("a", clip)]));
        const txt = () => at<Text>(ev, "0.0");

        // Frame 0: the inherited default (32) must be the tween's `from`, NOT the
        // Text property default (16).
        ev.stateAt(0);
        expect(txt().fontSize).toBe(32);

        // Mid-tween, the value is interpolating *from 32* (not 16) toward 64 —
        // i.e. strictly above the inherited start and below the target.
        ev.stateAt(2);
        expect(txt().fontSize).toBeGreaterThan(32);
        expect(txt().fontSize).toBeLessThan(64);

        // Last frame: the tween has settled at its target (0.5s @ 10fps → 5 frames).
        ev.stateAt(5);
        expect(txt().fontSize).toBeCloseTo(64, 5);

        // Seek back to 0 — the inherited start comes back with it.
        ev.stateAt(0);
        expect(txt().fontSize).toBe(32);
    });

    it("a provider in the document reaches its descendants", () => {
        const doc = still(
            node("provider", "theme-provider", { theme: { brand: "#abc" } }),
            node("leaf", "rect", { width: 10, height: 10 }, "provider"),
        );
        const ev = evaluatorFor(project([track("a", doc)]));
        ev.stateAt(0);
        expect(at(ev, "0.0").useContext(ThemeToken)).toEqual({ brand: "#abc" });
    });
});
