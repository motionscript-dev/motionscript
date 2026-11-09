import { Color } from "@/attributes/shape/fill/color/parser";
import type { TextStyle } from "@/attributes/text/types";

/** A color token: a resolvable {@link Color}, or a nested group of them. Groups
 *  flatten to dash-joined names — `{ brand: { 500: … } }` → `brand-500`. */
export type ColorToken = Color | ColorGroup;
export interface ColorGroup { [key: string]: ColorToken; }

/** Named color tokens, possibly nested into groups. Referenced by their
 *  (flattened) name in any `fill`/`stroke` string. */
export type ColorTokens = Record<string, ColorToken>;

/** A named text-style preset referenced by a `Text`/`RichText` `variant` prop.
 *  Each field it sets supplies that style key to a variant'd node (unless the
 *  author set it explicitly). Same shape as the `<DefaultTextStyle>` defaults. */
export type TypographyPreset = TextStyle;

/** Named typography presets, keyed by variant name (e.g. `header`, `body`).
 *  The `default` key is reserved: if present, it's applied to every `Text`/
 *  `RichText` as a project-wide base style — no `variant` prop or
 *  `<DefaultTextStyle>` wrapper needed — for any style key a more specific
 *  source (explicit prop, `variant`, inherited `<DefaultTextStyle>`) doesn't
 *  set. Declared as an explicit property (rather than folded into the index
 *  signature) so editors offer it in autocomplete. */
export type Typography = { default?: TypographyPreset } & Record<string, TypographyPreset>;

/** The visual design tokens — color tokens and typography presets. */
export interface Theme {
    /** Named color tokens (possibly grouped) for `fill`/`stroke` strings. */
    colors?: ColorTokens;
    /** Named text-style presets selected via a `Text`/`RichText` `variant`. */
    typography?: Typography;
}
