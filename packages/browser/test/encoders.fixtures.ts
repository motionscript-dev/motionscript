import { beforeAll, beforeEach } from "vitest";
import { canEncodeAudio, canEncodeVideo } from "mediabunny";

/**
 * H.264 is not part of Chromium: it depends on the build's proprietary-codec
 * support, and a headless run may have no AVC encoder at all. A suite that
 * encodes AVC on purpose (the exporter's own default, which the join of
 * segments and a video's decode levels have to be tested against) cannot be
 * pointed at another codec without proving nothing about the real path.
 *
 * So where AVC is missing the suite says so instead of passing: every test in it
 * is skipped with the reason, and a warning naming it is printed on every run.
 * Setting `REQUIRE_ENCODERS=1` makes the missing encoder a failure instead, for a
 * run that has to prove these suites ran (a CI job once its browser is known to
 * encode). Nothing else turns it on: not `CI`, so a machine with no encoder can
 * never go red from this by itself.
 *
 * The same goes for the AAC encoder, which the audio track of an export is
 * written with. `canEncodeAvc` and `canEncodeAac` are resolved at module scope,
 * with top-level await, which the browser runner supports.
 */
export const canEncodeAvc = await canEncodeVideo("avc", { width: 640, height: 360, bitrate: 1_000_000 });
/** AAC is the track an export's audio is written as, and a Chromium without proprietary codecs lacks its encoder too. */
export const canEncodeAac = await canEncodeAudio("aac");

export type EncoderOutcome = "run" | "skip" | "fail";

/** What a suite needing an encoder does: run it, skip it with a reason, or fail because the run demanded it. */
export function encoderOutcome(available: boolean, requireEncoders: string | undefined): EncoderOutcome {
    if (available) return "run";
    return requireEncoders === "1" ? "fail" : "skip";
}

const requireEncoders = import.meta.env.REQUIRE_ENCODERS;

/** Register in the `describe` that needs AVC (or at the top of a file whose every suite does). */
export function requireAvc(suite: string): void {
    requireEncoder(suite, "an H.264 (avc) encoder", canEncodeAvc);
}

/** Register in the `describe` that needs the AAC encoder. */
export function requireAac(suite: string): void {
    requireEncoder(suite, "an AAC encoder", canEncodeAac);
}

function requireEncoder(suite: string, what: string, available: boolean): void {
    const reason = `${suite} needs ${what} and this Chromium has none`;
    const outcome = encoderOutcome(available, requireEncoders);
    let warned = false;

    beforeAll(() => {
        if (outcome === "fail") {
            throw new Error(`${reason}, and REQUIRE_ENCODERS=1 asks for it: run against a Chromium that has it, or ${suite} goes untested.`);
        }
    });

    beforeEach((context) => {
        if (outcome === "run") return;
        if (!warned) {
            warned = true;
            console.warn(`[skipped] ${reason}; every test in it is skipped. Set REQUIRE_ENCODERS=1 to fail instead.`);
        }
        context.skip(reason);
    });
}
