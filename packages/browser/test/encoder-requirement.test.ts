import { describe, expect, it } from "vitest";
import { encoderOutcome } from "./encoders.fixtures";

/**
 * The decision `encoders.fixtures.ts` makes for every suite that needs an H.264
 * or AAC encoder: with the encoder it runs, without it it skips with a reason,
 * and it fails only when the run set `REQUIRE_ENCODERS=1`. The fixture reads
 * nothing else, so a CI environment alone cannot turn a skip into a failure.
 */

describe("encoderOutcome", () => {
    it("runs the suite whenever the encoder is there, whatever the run demands", () => {
        for (const demand of [undefined, "", "0", "1", "true"]) {
            expect(encoderOutcome(true, demand)).toBe("run");
        }
    });

    it("skips the suite when the encoder is missing and nothing demands it", () => {
        for (const demand of [undefined, "", "0", "false", "true", "yes", " 1", "1 "]) {
            expect(encoderOutcome(false, demand), `REQUIRE_ENCODERS=${JSON.stringify(demand)}`).toBe("skip");
        }
    });

    it("fails the suite when the encoder is missing and the run sets REQUIRE_ENCODERS=1", () => {
        expect(encoderOutcome(false, "1")).toBe("fail");
    });
});
