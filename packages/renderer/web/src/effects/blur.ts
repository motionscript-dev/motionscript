import { Effects, type BlurEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<BlurEffect>({
    type: "blur",
    surface: "filter",
    params: {},
    uses: ["radius"],
    // A zero-sigma blur is the identity.
    prepare: (e) => (e.radius > 0 ? {} : null),
    extras(e) {
        // Sigma is half the authored radius.
        const sigma = e.radius / 2;
        return { blur: [sigma, sigma, 0], reach: 3 * sigma };
    },
    cases: () => [Effects.blur(8).list[0], Effects.blur(24).list[0], Effects.blur(2).list[0]],
});
