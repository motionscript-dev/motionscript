import type { Fill } from "@/attributes/shape/fill/chain";
import type { Shadow } from "@/attributes/shape/shadow/shadow";
import type { Stroke } from "@/attributes/shape/stroke/stroke";
import { textOps } from "@/attributes/text/ops";
import type { FontStyle, TextAlign, TextStyle } from "@/attributes/text/types";
import { TextStyleToken } from "@/runtime/builtin-context";
import { provides, type Provided, type Values } from "@/components/factory/api";
import type { Inherit } from "@/components/factory/type-def";
import { Types } from "@/components/factory/types";

/**
 * The face text is set in, each field taken, when the author leaves it unset,
 * from the cascade: the theme's `default` typography, under the nearest
 * provider's style, under the node's own `variant` preset.
 */

function cascade(use: Parameters<Inherit>[0], given: Readonly<Record<string, unknown>>): TextStyle {
    const variant = given.variant as string | undefined;
    return textOps.mergeStyle(
        textOps.mergeStyle(textOps.preset("default"), use(TextStyleToken)),
        variant ? textOps.preset(variant) : undefined,
    );
}

/** What `key` inherits. `autofit: false` refuses an inherited `'autofit'` size, for a node that can't fit to its box. */
export function inherit(key: keyof TextStyle, options: { readonly autofit?: boolean } = {}): Inherit {
    return (use, given) => {
        const value = cascade(use, given)[key];
        return key === "fontSize" && value === "autofit" && options.autofit === false ? undefined : value;
    };
}

export const state = {
    // No default: a face nobody chose is one never declared and never loaded, so the renderer says so.
    fontFamily: Types.custom<string>(undefined as unknown as string, { inherit: inherit("fontFamily") }),
    fontSize: Types.custom<number | "autofit">(48, {
        lerp: (a, b, t) => textOps.lerpFontSize(a, b, t) as number | "autofit",
        inherit: inherit("fontSize"),
    }),
    fontWeight: Types.number(400, { inherit: inherit("fontWeight") }),
    fontStyle: Types.custom<FontStyle>("normal", { inherit: inherit("fontStyle") }),
    letterSpacing: Types.number(0, { inherit: inherit("letterSpacing") }),
    lineHeight: Types.number(1.2, { inherit: inherit("lineHeight") }),
    textAlign: Types.custom<TextAlign>("center", { inherit: inherit("textAlign") }),
    verticalAlign: Types.oneOf(["top", "center", "bottom"], { default: "center" }),
    textDecoration: Types.oneOf(["none", "underline", "line-through"]),
    textCase: Types.oneOf(["none", "upper", "lower", "title"]),
    minFontSize: Types.number(12),
    variant: Types.custom<string | undefined>(undefined),
    fill: Types.fill(undefined, { inherit: inherit("fill") }),
    stroke: Types.stroke(undefined, { inherit: inherit("stroke") }),
    shadow: Types.shadow(undefined, { inherit: inherit("shadow") }),
};

/** The style a provider sets: each field left unset is inherited from above. */
export const provided = {
    fontFamily: Types.custom<string | undefined>(undefined),
    fontSize: Types.custom<number | "autofit" | undefined>(undefined),
    fontWeight: Types.custom<number | undefined>(undefined),
    fontStyle: Types.custom<FontStyle | undefined>(undefined),
    letterSpacing: Types.custom<number | undefined>(undefined),
    lineHeight: Types.custom<number | undefined>(undefined),
    textAlign: Types.custom<TextAlign | undefined>(undefined),
    fill: Types.custom<Fill | undefined>(undefined),
    stroke: Types.custom<Stroke | undefined>(undefined),
    shadow: Types.custom<Shadow | undefined>(undefined),
};

/** The subtree's style: the inherited one with this provider's fields laid over it. */
export function provide(s: Values<typeof provided>, inherited: <T>(context: { readonly id: symbol; readonly defaultValue: T }) => T): readonly Provided[] {
    return [provides(TextStyleToken, textOps.mergeStyle(inherited(TextStyleToken), s as TextStyle))];
}

/** This provider's own fields, as the default for text drawn under it. */
export function current(s: Values<typeof provided>): TextStyle {
    return textOps.mergeStyle({}, s as TextStyle);
}
