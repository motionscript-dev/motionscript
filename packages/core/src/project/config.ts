import { Color } from "@/attributes/shape/fill/color/parser";
import type { TextStyle } from "@/attributes/text/types";

/** A color token: a resolvable {@link Color}, or a nested group flattened to dash-joined names (`{ brand: { 500: … } }` → `brand-500`). */
export type ColorToken = Color | ColorGroup;
export interface ColorGroup { [key: string]: ColorToken; }

/** Named color tokens, possibly nested, referenced by flattened name in any `fill`/`stroke` string. */
export type ColorTokens = Record<string, ColorToken>;

/** A named text-style preset for a `Text`/`RichText` `variant`: each field it sets supplies that style key unless the author set it. Same shape as `<DefaultTextStyle>` defaults. */
export type TypographyPreset = TextStyle;

/** Typography presets keyed by variant name. `default` is reserved: applied to every `Text`/`RichText` as a project-wide base for any key a more specific source (explicit prop, `variant`, `<DefaultTextStyle>`) doesn't set. Declared explicitly (not folded into the index signature) so editors autocomplete it. */
export type Typography = { default?: TypographyPreset } & Record<string, TypographyPreset>;

/** The visual design tokens — color tokens and typography presets. */
export interface Theme {
    /** Named color tokens (possibly grouped) for `fill`/`stroke` strings. */
    colors?: ColorTokens;
    /** Named text-style presets selected via a `Text`/`RichText` `variant`. */
    typography?: Typography;
}
