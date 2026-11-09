import { Effects, type PosterizeEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<PosterizeEffect>({
    type: "posterize",
    surface: "shader",
    params: { levels: "param" },
    prepare: (e) => (e.levels < 2 ? null : {}),
    cases: () => [Effects.posterize().list[0], Effects.posterize(2).list[0], Effects.posterize(7).list[0]],
});
