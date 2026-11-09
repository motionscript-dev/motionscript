import { describe, expect, it } from "vitest";
import * as kit from "../engine";

// The first import of this file, so the barrel is the entry: a host loading
// `@motionscript/math/kit` before the root evaluates the kit in this order, and a
// node that reached the barrel back would run its decorators half-initialised.
describe("the kit barrel as the first module loaded", () => {
    it("loads with every node built from finished modules", () => {
        expect(kit.OUTLINE_TRIM).toContain("progressTo");
        expect(kit.Latex).toBeTypeOf("function");
        expect(kit.defaultLatexMorph).toBeTypeOf("function");
    });
});
