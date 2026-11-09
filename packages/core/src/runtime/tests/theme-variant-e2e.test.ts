import { describe, it, expect, afterEach } from "vitest";
import { setTheme } from "@/attributes/shape/fill/color/parser";
import type { NodeSpec } from "@/document/types";
import type { Text } from "@/components/builtins/text/text";
import { evaluatorFor, node, project, still, track } from "@/runtime/document.fixtures";
import { nodeAt } from "@/runtime/node-picking";
import { textOps } from "@/attributes/text/ops";
import type { TextStyle } from "@/attributes/text/types";
import { setHostTextFamily } from "@/components/builtins/text/text-defaults";
import { withTextDescriptor } from "@/render/descriptors/text";

/** The Text at `path` once `nodes` are on screen. */
function textAt(path: string, ...nodes: NodeSpec[]): Text {
    const ev = evaluatorFor(project([track("a", still(...nodes))]));
    ev.stateAt(0);
    return nodeAt(ev.currentCanvas!, path) as Text;
}

const title = (props: Record<string, unknown> = {}, parentId: string | null = null) =>
    node("txt", "text", { text: "hi", ...props }, parentId);

const style = (props: Record<string, unknown>) => node("style", "default-text-style", props);

describe("Text variant — typography preset precedence", () => {
    afterEach(() => setTheme());

    it("a variant supplies a style prop the author didn't set", () => {
        setTheme({ typography: { header: { fontSize: 96, fontWeight: 700 } } });
        const txt = textAt("0", title({ variant: "header" }));
        expect(txt.fontSize).toBe(96);
        expect(txt.fontWeight).toBe(700);
    });

    it("an explicit author prop wins over the variant", () => {
        setTheme({ typography: { header: { fontSize: 96, fontWeight: 700 } } });
        const txt = textAt("0", title({ variant: "header", fontSize: 40 }));
        expect(txt.fontSize).toBe(40);  // explicit wins
        expect(txt.fontWeight).toBe(700); // variant still supplies the rest
    });

    it("a variant wins over an inherited <DefaultTextStyle>", () => {
        setTheme({ typography: { header: { fontSize: 96 } } });
        const txt = textAt("0.0", style({ fontSize: 32 }), title({ variant: "header" }, "style"));
        expect(txt.fontSize).toBe(96); // variant beats the inherited 32
    });

    it("a key the variant doesn't set falls through to <DefaultTextStyle>", () => {
        setTheme({ typography: { header: { fontWeight: 700 } } });
        const txt = textAt("0.0", style({ fontSize: 32 }), title({ variant: "header" }, "style"));
        expect(txt.fontWeight).toBe(700); // from variant
        expect(txt.fontSize).toBe(32);    // falls through to DefaultTextStyle
    });

    it("an unknown variant is a no-op (node keeps its own defaults)", () => {
        setTheme({ typography: { header: { fontSize: 96 } } });
        const txt = textAt("0", title({ variant: "nope" }));
        expect(txt.fontSize).toBe(48); // the Text property default
    });

    it("a `default` typography preset applies with no variant or <DefaultTextStyle>", () => {
        setTheme({ typography: { default: { fontSize: 40, fontFamily: "Zilla Slab" } } });
        const txt = textAt("0", title());
        expect(txt.fontSize).toBe(40);
        expect(txt.fontFamily).toBe("Zilla Slab");
    });

    it("an explicit variant wins over the `default` preset", () => {
        setTheme({
            typography: {
                default: { fontSize: 40 },
                header: { fontSize: 96 },
            },
        });
        const txt = textAt("0", title({ variant: "header" }));
        expect(txt.fontSize).toBe(96);
    });

    it("an inherited <DefaultTextStyle> wins over the `default` preset", () => {
        setTheme({ typography: { default: { fontSize: 40 } } });
        const txt = textAt("0.0", style({ fontSize: 32 }), title({}, "style"));
        expect(txt.fontSize).toBe(32);
    });

    it("a key the `default` preset doesn't set falls through to the node's own default", () => {
        setTheme({ typography: { default: { fontFamily: "Zilla Slab" } } });
        const txt = textAt("0", title());
        expect(txt.fontFamily).toBe("Zilla Slab");
        expect(txt.fontSize).toBe(48); // the Text property default
    });
});

/**
 * A component's captions are on the author's ladder, not beside it.
 *
 * A chart axis, a legend and a diagram label are built from the *component's*
 * theme, which states a size and a weight and has no business naming a face —
 * so they are spread through `textOps.styleProps`, which is the seam these
 * tests are really about. It used to write `fontFamily: hostTextFamily()` into
 * the props, and `applyTextDefaults` skips every key the props already carry,
 * so that snapshot outranked the whole cascade below: with no host family
 * declared a chart arrived at the renderer holding `""` and stopped the canvas,
 * and with one declared it quietly ignored the document's own typography.
 */
describe("component text — textOps.styleProps on the same ladder", () => {
    afterEach(() => {
        setTheme();
        setHostTextFamily("");
    });

    /** What a chart axis states about its markers: type scale, no face. */
    const AXIS_LABEL: TextStyle = { fontSize: 24, fontWeight: 700, textAlign: "center" };

    const marker = (parentId: string | null = null) =>
        node("txt", "text", { text: "1", ...textOps.styleProps(AXIS_LABEL), }, parentId);

    it("takes the theme's `default` face while keeping the component's own type scale", () => {
        setTheme({ typography: { default: { fontFamily: "Zilla Slab", fontSize: 40 } } });
        const txt = textAt("0", marker());
        expect(txt.fontFamily).toBe("Zilla Slab"); // the document's, not the component's
        expect(txt.fontSize).toBe(24);             // the component still states this
        expect(txt.fontWeight).toBe(700);
    });

    it("inherits an enclosing <DefaultTextStyle> face", () => {
        const txt = textAt("0.0", style({ fontFamily: "Zilla Slab" }), marker("style"));
        expect(txt.fontFamily).toBe("Zilla Slab");
    });

    it("does not let the host family outrank the theme", () => {
        setHostTextFamily("Inter");
        setTheme({ typography: { default: { fontFamily: "Zilla Slab" } } });
        expect(textAt("0", marker()).fontFamily).toBe("Zilla Slab");
    });

    it("reaches the renderer as the host family when nothing else names one", () => {
        setHostTextFamily("Inter");
        // Unset on the node — `requireFontFamily` is the rung that answers.
        expect(textAt("0", marker()).fontFamily).toBeUndefined();
        expect(withTextDescriptor({ text: "1" }).fontFamily).toBe("Inter");
    });
});
