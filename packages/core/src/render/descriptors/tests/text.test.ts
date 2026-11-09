import { afterEach, describe, expect, it } from "vitest";

import { withTextDescriptor } from "@/render/descriptors/text";
import { setHostTextFamily } from "@/components/builtins/text/text-defaults";

/**
 * `fontFamily` is resolved here, and this is the last rung of its cascade.
 *
 * It used to fall back to `"Arial"`, which is the wrong shape of answer for a
 * renderer whose job is that the picture is the one that was asked for: a face
 * the *engine* picked produces text in a typeface nobody chose, at metrics
 * nobody measured, in a frame that looks finished, and hides a font that was
 * never declared and so never loaded.
 *
 * A face the *host* named is a different matter — see `hostTextFamily`. With no
 * host family declared the error stands, which is the default and what the tests
 * below run under unless they say otherwise.
 */
describe("withTextDescriptor", () => {
    afterEach(() => setHostTextFamily(""));

    it("keeps the family it was given", () => {
        expect(withTextDescriptor({ text: "hi", fontFamily: "Inter" }).fontFamily)
            .toBe("Inter");
    });

    it("throws when no layer supplied one", () => {
        expect(() => withTextDescriptor({ text: "hi" })).toThrow(/fontFamily/);
    });

    it("treats an empty family as absent", () => {
        // `""` reaches a font manager as a request for nothing and comes back as
        // whatever the platform felt like, which is the silent substitution this
        // exists to stop — so it is the same fault as omitting it.
        expect(() => withTextDescriptor({ text: "hi", fontFamily: "" }))
            .toThrow(/fontFamily/);
    });

    it("names the three places a family can come from", () => {
        // The message is the whole value of the error: "no font family" is not
        // actionable, and this is.
        expect(() => withTextDescriptor({ text: "hi" }))
            .toThrow(/DefaultTextStyle[\s\S]*typography/);
    });

    it("quotes the text so the failing node can be found", () => {
        expect(() => withTextDescriptor({ text: "Chapter One" }))
            .toThrow(/Chapter One/);
    });

    it("falls back to the host family when the host declared one", () => {
        setHostTextFamily("Inter");
        expect(withTextDescriptor({ text: "hi" }).fontFamily).toBe("Inter");
        expect(withTextDescriptor({ text: "hi", fontFamily: "" }).fontFamily).toBe("Inter");
    });

    it("still prefers a stated family over the host's", () => {
        setHostTextFamily("Inter");
        expect(withTextDescriptor({ text: "hi", fontFamily: "Georgia" }).fontFamily)
            .toBe("Georgia");
    });
});
