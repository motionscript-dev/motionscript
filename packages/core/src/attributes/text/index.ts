/**
 * The text attribute.
 *
 * One value — {@link textOps} — carries every operation on text and its style:
 * the string's typing lerp, the typography-preset lookup, the style merge both
 * text-default channels are built on, a whole style's resolve/lerp pair, and span
 * flattening. The free functions this used to export (`lerpText`,
 * `resolveTextStyleLeaf`, `lerpTextStyle`, `textStyleProps`,
 * `themeDefaultTextStyle`, `variantTextStyle`) are those methods now, and
 * `lerpPadding` was a second copy of `insetsOps.lerp`.
 */
export { textOps, TEXT_STYLE_KEYS, TEXT_SHAPING_KEYS, EMPTY_TEXT_STYLE } from "./ops";
export type * from "./types";
