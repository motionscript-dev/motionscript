/**
 * `@motionscript/sdk/component` — what a component package needs beyond the
 * authoring barrel: number formatting, text defaults, the named shape outlines
 * and the orbit-camera lerps.
 *
 * A subpath, not part of `.`, because a scene author never reaches for it. The
 * curation is `@motionscript/core/component`'s, for the same reason
 * `index.ts` passes through `@motionscript/core/sdk`.
 */
export * from "@motionscript/core/component";
